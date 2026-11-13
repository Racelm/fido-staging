import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { signOut } from '@/app/actions/auth'
import ClientUpload from './ClientUpload'
import MessageForm from './MessageForm'
import ReviewBadge from '@/app/documents/ReviewBadge'
import { firstRel } from '@/lib/rel'
import { periodLabel, reminderMessage } from '@/lib/reminders'
import FolderGrid from '@/components/FolderGrid'
import { findFolder, folderOf, summarizeFolders } from '@/lib/document-folders'

export default async function ClientPage({
  searchParams,
}: {
  searchParams: Promise<{ dossier?: string }>
}) {
  const openFolder = findFolder((await searchParams).dossier)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role, organization_id, organizations(name)')
    .eq('id', user.id)
    .single()
  if (!profile || profile.role !== 'client') redirect('/')

  const { data: client } = await supabase
    .from('clients')
    .select('id, company_name, contact_name, email, organization_id')
    .eq('profile_id', user.id)
    .is('deleted_at', null)
    .single()

  if (!client) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <div className="auth-brand">
            <span className="logo">F</span>Fido
          </div>
          <h1>Espace en préparation</h1>
          <p className="auth-copy">
            Votre compte est bien créé mais l’espace client n’est pas encore rattaché.
            Contactez votre cabinet.
          </p>
          <form action={signOut}>
            <button className="auth-submit" type="submit">Se déconnecter</button>
          </form>
        </section>
      </main>
    )
  }

  type RequestRow = {
    id: string
    title: string
    description: string | null
    status: string
    due_date: string | null
    created_at: string
    is_recurring?: boolean
    period?: string | null
    reminder_stage?: number
  }
  const requestsQuery = (cols: string) =>
    supabase
      .from('document_requests')
      .select(cols)
      .eq('client_id', client.id)
      .order('created_at', { ascending: false })
      .limit(20)

  const [reqRes, { data: documents }, { data: messages }] = await Promise.all([
    requestsQuery('id,title,description,status,due_date,created_at,is_recurring,period,reminder_stage'),
    supabase
      .from('documents')
      .select('id,name,mime_type,size_bytes,category,version,review_status,review_note,created_at')
      .eq('client_id', client.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase
      .from('messages')
      .select('id,body,created_at,sender_id')
      .eq('client_id', client.id)
      .order('created_at', { ascending: true })
      .limit(50),
  ])

  // Si la migration 011 (relances) n'est pas encore appliquée, ces colonnes
  // n'existent pas : on recharge sans elles pour que l'espace client
  // (demandes, dossiers) reste utilisable.
  let requests = reqRes.data as unknown as RequestRow[] | null
  if (reqRes.error) {
    const fallback = await requestsQuery('id,title,description,status,due_date,created_at')
    requests = fallback.data as unknown as RequestRow[] | null
  }

  const pending = requests?.filter((r) => r.status === 'pending').length || 0
  const folders = summarizeFolders(documents || [])
  const folderDocs = openFolder
    ? (documents || []).filter((d) => folderOf(d.category) === openFolder.key)
    : []

  // Rappels actifs : demandes mensuelles en attente déjà relancées par Tiwizi
  const cabinetName = firstRel(profile.organizations)?.name || 'Votre cabinet'
  const reminders = (requests || [])
    .filter((r) => r.is_recurring && r.status === 'pending' && (r.reminder_stage ?? 0) > 0 && r.period && r.due_date)
    .map((r) => ({
      id: r.id,
      late: (r.reminder_stage ?? 0) >= 4,
      ...reminderMessage(r.reminder_stage ?? 0, {
        cabinetName,
        periodLabel: periodLabel(r.period as string),
        dueDate: r.due_date as string,
      }),
    }))

  return (
    <div className="shell narrow">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <span className="sidebar-logo">F</span>
            <span>Fido</span>
          </div>
        </div>
        <nav className="nav">
          <a className="active" href="#top">
            <span className="nav-icon">⌂</span>
            <span>Mon espace</span>
          </a>
          <a href="#demandes">
            <span className="nav-icon">✓</span>
            <span>Mes demandes</span>
            {pending > 0 && <span className="nav-badge">{pending}</span>}
          </a>
          <a href="#documents">
            <span className="nav-icon">▣</span>
            <span>Mes documents</span>
          </a>
          <a href="#messages">
            <span className="nav-icon">✉</span>
            <span>Messages</span>
          </a>
          <a href="/client/profile" data-testid="nav-own-profile">
            <span className="nav-icon">◉</span>
            <span>Mes informations</span>
          </a>
        </nav>
        <div className="sidebar-user">
          <div className="sidebar-user-avatar">
            {(profile.full_name || client.contact_name || 'C').charAt(0).toUpperCase()}
          </div>
          <div className="sidebar-user-info">
            <strong>{profile.full_name || client.contact_name || 'Client'}</strong>
            <span>{client.company_name}</span>
          </div>
          <form action={signOut}>
            <button type="submit" title="Déconnexion">↩</button>
          </form>
        </div>
      </aside>

      <main className="main" id="top">
        <header className="topbar">
          <div>
            <div className="eyebrow">Espace client · {client.company_name}</div>
            <h1>Bonjour {(profile.full_name || client.contact_name || '').split(' ')[0] || 'et bienvenue'} 👋</h1>
            <p className="welcome">Déposez vos documents et suivez les échanges avec votre cabinet.</p>
          </div>
          <div />
          <div />
        </header>

        {reminders.map((r) => (
          <a
            key={r.id}
            href="#demandes"
            data-testid="client-reminder-banner"
            className="card card-padded"
            style={{
              display: 'block',
              marginBottom: 16,
              textDecoration: 'none',
              color: 'inherit',
              borderLeft: `4px solid ${r.late ? '#e17055' : '#6c5ce7'}`,
            }}
          >
            <div className="eyebrow">Rappel de {cabinetName}</div>
            <strong style={{ display: 'block', fontSize: 16, margin: '4px 0' }}>{r.title}</strong>
            <span className="muted">{r.body}</span>
            <span style={{ display: 'block', marginTop: 8, fontWeight: 600 }}>Déposer mes documents →</span>
          </a>
        ))}

        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <article className="kpi k-violet">
            <div className="kpi-icon">◷</div>
            <div>
              <div className="kpi-value">{pending}</div>
              <div className="kpi-label">Demandes en attente</div>
            </div>
          </article>
          <article className="kpi k-green">
            <div className="kpi-icon">▣</div>
            <div>
              <div className="kpi-value">{documents?.length || 0}</div>
              <div className="kpi-label">Documents envoyés</div>
            </div>
          </article>
          <article className="kpi k-blue">
            <div className="kpi-icon">✉</div>
            <div>
              <div className="kpi-value">{messages?.length || 0}</div>
              <div className="kpi-label">Messages</div>
            </div>
          </article>
        </div>

        <section id="demandes" className="card">
          <div className="section-head">
            <div>
              <h2 className="section-title">Demandes de votre cabinet</h2>
              <p className="section-sub">Déposez les documents demandés avant leur échéance</p>
            </div>
          </div>
          {requests?.length ? (
            requests.map((r) => (
              <div className="mini-row" key={r.id} style={{ padding: '14px 22px' }}>
                <div className="mini-row-top">
                  <strong>{r.title}</strong>
                  <span
                    className={`pill ${
                      r.status === 'pending' ? 'pill-orange' : r.status === 'received' ? 'pill-blue' : 'pill-green'
                    }`}
                  >
                    {r.status === 'pending' ? 'À envoyer' : r.status === 'received' ? 'Reçu' : 'Traité'}
                  </span>
                </div>
                <div className="mini-row-sub">
                  {r.description || 'Document demandé par votre cabinet.'}
                  {r.due_date ? ` · Échéance ${new Date(r.due_date).toLocaleDateString('fr-FR')}` : ''}
                </div>
                {r.status === 'pending' && (
                  <div style={{ marginTop: 10 }}>
                    <ClientUpload
                      clientId={client.id}
                      organizationId={client.organization_id}
                      requestId={r.id}
                    />
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="empty-state">
              <strong>Aucune demande</strong>
              <span>Votre cabinet n’a pas encore demandé de document.</span>
            </div>
          )}
        </section>

        <section id="documents" className="card" style={{ marginTop: 16 }}>
          <div className="section-head">
            <div>
              {openFolder ? (
                <>
                  <a href="/client#documents" className="folder-back">← Tous mes dossiers</a>
                  <h2 className="section-title" style={{ marginTop: 6 }}>
                    {openFolder.icon} {openFolder.label}
                  </h2>
                  <p className="section-sub">{folderDocs.length} fichier(s)</p>
                </>
              ) : (
                <>
                  <h2 className="section-title">Mes dossiers</h2>
                  <p className="section-sub">Ouvrez un dossier pour voir ou ajouter des documents</p>
                </>
              )}
            </div>
          </div>
          {openFolder ? (
            <>
              <div style={{ padding: '0 22px 16px' }}>
                <ClientUpload
                  key={openFolder.key}
                  clientId={client.id}
                  organizationId={client.organization_id}
                  defaultCategory={openFolder.categories[0]}
                />
              </div>
              {folderDocs.length ? (
                folderDocs.map((d) => (
              <div className="client-row" key={d.id}>
                <div className="client-avatar">▣</div>
                <div className="client-info" style={{ flex: 1 }}>
                  <strong>{d.name}</strong>
                  <span>
                    v{d.version ?? 1} · {new Date(d.created_at).toLocaleDateString('fr-FR')}
                    {d.size_bytes ? ` · ${Math.round(d.size_bytes / 1024)} Ko` : ''}
                  </span>
                  {d.review_status === 'rejected' && d.review_note && (
                    <span
                      style={{
                        marginTop: 6,
                        display: 'block',
                        padding: '6px 10px',
                        background: 'var(--red-50)',
                        color: 'var(--red-600)',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      data-testid={`reject-note-${d.id}`}
                    >
                      ⚠︎ Votre cabinet demande une correction : {d.review_note}
                    </span>
                  )}
                </div>
                <ReviewBadge status={d.review_status as string} size="sm" />
              </div>
                ))
              ) : (
                <div className="empty-state">
                  <strong>Dossier vide</strong>
                  <span>Les fichiers que vous déposez ici apparaîtront dans ce dossier.</span>
                </div>
              )}
            </>
          ) : (
            <FolderGrid folders={folders} baseHref="/client" />
          )}
        </section>

        <section id="messages" className="card card-padded" style={{ marginTop: 16 }}>
          <h2 className="section-title">Messages avec votre cabinet</h2>
          <p className="muted" style={{ margin: '4px 0 14px' }}>Posez vos questions, obtenez des réponses.</p>
          <div style={{ display: 'grid', gap: 10, maxHeight: 320, overflowY: 'auto' }}>
            {messages?.length ? (
              messages.map((m) => (
                <div
                  key={m.id}
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    background: m.sender_id === user.id ? 'var(--violet-50)' : 'var(--surface-2)',
                    alignSelf: m.sender_id === user.id ? 'flex-end' : 'flex-start',
                  }}
                >
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
                    {m.sender_id === user.id ? 'Vous' : 'Cabinet'} ·{' '}
                    {new Date(m.created_at).toLocaleString('fr-FR')}
                  </div>
                  <div>{m.body}</div>
                </div>
              ))
            ) : (
              <span className="muted">Aucun message pour le moment.</span>
            )}
          </div>
          <div style={{ marginTop: 12 }}>
            <MessageForm clientId={client.id} />
          </div>
        </section>
      </main>
    </div>
  )
}
