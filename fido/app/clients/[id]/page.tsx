import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppShell, { NAV_ICONS } from '@/components/AppShell'
import InviteButton from './InviteButton'
import RequestForm from './RequestForm'
import MessageForm from '@/app/client/MessageForm'
import DownloadButton from '@/app/documents/DownloadButton'

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
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
  if (!profile || !['owner', 'staff'].includes(profile.role)) redirect('/')

  const { data: client } = await supabase
    .from('clients')
    .select(
      'id, company_name, contact_name, email, phone, status, ice, if_number, rc_number, cnss_number, tva_period, created_at'
    )
    .eq('id', id)
    .eq('organization_id', profile.organization_id)
    .is('deleted_at', null)
    .single()
  if (!client) notFound()

  const [reqRes, docRes, msgRes, invRes] = await Promise.all([
    supabase
      .from('document_requests')
      .select('id,title,status,due_date,created_at')
      .eq('client_id', id)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('documents')
      .select('id,name,category,version,size_bytes,created_at')
      .eq('client_id', id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('messages')
      .select('id,body,created_at,sender_id')
      .eq('client_id', id)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('client_invitations')
      .select('expires_at,accepted_at')
      .eq('client_id', id)
      .is('accepted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  const requests = reqRes.data || []
  const documents = docRes.data || []
  const messages = msgRes.data || []
  const invitation = invRes.data

  const statusPill =
    client.status === 'active'
      ? { label: 'Actif', cls: 'pill-green' }
      : client.status === 'invited'
        ? { label: 'Invité', cls: 'pill-orange' }
        : { label: 'Inactif', cls: 'pill-gray' }

  return (
    <AppShell
      active="/clients"
      profile={profile}
      title={client.company_name}
      welcome="Espace de collaboration sécurisé"
    >
      <Link href="/clients" className="btn-ghost" style={{ marginBottom: 12 }}>
        ← Retour aux dossiers clients
      </Link>

      <section className="card card-padded">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20 }}>
          <div>
            <h2 className="section-title">{client.company_name}</h2>
            <p className="muted" style={{ margin: '2px 0 0' }}>
              Créé le {new Date(client.created_at).toLocaleDateString('fr-FR')}
            </p>
          </div>
          <span className={`pill ${statusPill.cls}`}>{statusPill.label}</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginTop: 20 }}>
          <div><div className="muted" style={{ fontSize: 12 }}>Contact</div><div style={{ fontWeight: 600 }}>{client.contact_name || '—'}</div></div>
          <div><div className="muted" style={{ fontSize: 12 }}>E-mail</div><div style={{ fontWeight: 600 }}>{client.email || '—'}</div></div>
          <div><div className="muted" style={{ fontSize: 12 }}>Téléphone</div><div style={{ fontWeight: 600 }}>{client.phone || '—'}</div></div>
          <div><div className="muted" style={{ fontSize: 12 }}>Période TVA</div><div style={{ fontWeight: 600 }}>{client.tva_period || '—'}</div></div>
          <div><div className="muted" style={{ fontSize: 12 }}>ICE</div><div style={{ fontWeight: 600 }}>{client.ice || '—'}</div></div>
          <div><div className="muted" style={{ fontSize: 12 }}>IF</div><div style={{ fontWeight: 600 }}>{client.if_number || '—'}</div></div>
          <div><div className="muted" style={{ fontSize: 12 }}>RC</div><div style={{ fontWeight: 600 }}>{client.rc_number || '—'}</div></div>
          <div><div className="muted" style={{ fontSize: 12 }}>CNSS</div><div style={{ fontWeight: 600 }}>{client.cnss_number || '—'}</div></div>
        </div>

        <div style={{ marginTop: 20 }}>
          <InviteButton
            clientId={client.id}
            existingInvitation={invitation ? { expiresAt: invitation.expires_at } : null}
          />
        </div>
      </section>

      <div className="content-grid" style={{ marginTop: 16 }}>
        <section className="card card-padded">
          <h2 className="section-title">Nouvelle demande</h2>
          <p className="muted" style={{ margin: '4px 0 12px' }}>Demandez un document précis au client.</p>
          <RequestForm clientId={client.id} />
        </section>
        <section className="card">
          <div className="section-head">
            <div>
              <h2 className="section-title">Demandes récentes</h2>
              <p className="section-sub">{requests.length} entrée(s)</p>
            </div>
          </div>
          {requests.length ? requests.map(r => (
            <div className="mini-row" key={r.id} style={{ padding: '12px 22px' }}>
              <div className="mini-row-top">
                <strong>{r.title}</strong>
                <span className={`pill ${r.status === 'pending' ? 'pill-orange' : r.status === 'received' ? 'pill-blue' : 'pill-green'}`}>
                  {r.status === 'pending' ? 'En attente' : r.status === 'received' ? 'Reçu' : 'Traité'}
                </span>
              </div>
              <div className="mini-row-sub">{r.due_date ? `Échéance : ${new Date(r.due_date).toLocaleDateString('fr-FR')}` : 'Sans échéance'}</div>
            </div>
          )) : (
            <div className="empty-state"><strong>Aucune demande</strong><span>Créez-en une à gauche.</span></div>
          )}
        </section>
      </div>

      <div className="content-grid" style={{ marginTop: 16 }}>
        <section className="card">
          <div className="section-head">
            <div>
              <h2 className="section-title">Documents récents</h2>
              <p className="section-sub">{documents.length} fichier(s)</p>
            </div>
          </div>
          {documents.length ? documents.map(d => (
            <div className="mini-row" key={d.id} style={{ padding: '12px 22px' }}>
              <div className="mini-row-top">
                <strong>{d.name}</strong>
                <DownloadButton documentId={d.id} />
              </div>
              <div className="mini-row-sub">
                v{d.version ?? 1} · {d.size_bytes ? `${Math.round(d.size_bytes / 1024)} Ko` : '—'} · {new Date(d.created_at).toLocaleDateString('fr-FR')}
              </div>
            </div>
          )) : (
            <div className="empty-state"><strong>Aucun document</strong><span>Rien reçu pour l’instant.</span></div>
          )}
        </section>
        <section className="card card-padded">
          <h2 className="section-title">Conversation</h2>
          <p className="muted" style={{ margin: '4px 0 12px' }}>Dernière activité sur ce dossier.</p>
          <div style={{ display: 'grid', gap: 10, maxHeight: 320, overflowY: 'auto' }}>
            {messages.length ? messages.map(m => (
              <div key={m.id} style={{ padding: 12, borderRadius: 12, background: m.sender_id === user.id ? 'var(--violet-50)' : 'var(--surface-2)' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
                  {m.sender_id === user.id ? 'Vous' : 'Client'} · {new Date(m.created_at).toLocaleString('fr-FR')}
                </div>
                <div>{m.body}</div>
              </div>
            )) : <span className="muted">Aucun message échangé.</span>}
          </div>
          <div style={{ marginTop: 12 }}>
            <MessageForm clientId={client.id} />
          </div>
        </section>
      </div>
    </AppShell>
  )
}
