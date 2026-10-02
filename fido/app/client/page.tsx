import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { signOut } from '@/app/actions/auth'
import ClientUpload from './ClientUpload'
import MessageForm from './MessageForm'

export default async function ClientPage() {
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

  const [{ data: requests }, { data: documents }, { data: messages }] = await Promise.all([
    supabase
      .from('document_requests')
      .select('id,title,description,status,due_date,created_at')
      .eq('client_id', client.id)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('documents')
      .select('id,name,mime_type,size_bytes,version,created_at')
      .eq('client_id', client.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('messages')
      .select('id,body,created_at,sender_id')
      .eq('client_id', client.id)
      .order('created_at', { ascending: true })
      .limit(50),
  ])

  const pending = requests?.filter((r) => r.status === 'pending').length || 0

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
              <h2 className="section-title">Mes documents envoyés</h2>
              <p className="section-sub">{documents?.length || 0} fichier(s)</p>
            </div>
          </div>
          {documents?.length ? (
            documents.map((d) => (
              <div className="client-row" key={d.id}>
                <div className="client-avatar">▣</div>
                <div className="client-info" style={{ flex: 1 }}>
                  <strong>{d.name}</strong>
                  <span>
                    v{d.version ?? 1} · {new Date(d.created_at).toLocaleDateString('fr-FR')}
                    {d.size_bytes ? ` · ${Math.round(d.size_bytes / 1024)} Ko` : ''}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state">
              <strong>Aucun document</strong>
              <span>Les fichiers que vous envoyez apparaîtront ici.</span>
            </div>
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
