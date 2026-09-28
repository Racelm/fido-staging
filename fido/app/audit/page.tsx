import { firstRel } from '@/lib/rel'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

const ACTION_LABELS: Record<string, string> = {
  'document.upload': 'Document téléversé',
  'document.download': 'Document téléchargé',
  'client.create': 'Client créé',
  'client.archive': 'Client archivé',
  'request.create': 'Demande créée',
  'invitation.create': 'Invitation générée',
  'notification.document_received': 'Notification (document reçu)',
}

export default async function AuditPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role, organization_id, organizations(name)')
    .eq('id', user.id)
    .maybeSingle()

  // Journal réservé aux propriétaires du cabinet.
  if (!profile || profile.role !== 'owner') redirect('/')

  const { data: events } = await supabase
    .from('audit_events')
    .select('id, action, entity_type, entity_id, meta, created_at, actor_id, profiles(full_name)')
    .eq('organization_id', profile.organization_id)
    .order('created_at', { ascending: false })
    .limit(200)

  return (
    <main className="app" data-testid="audit-page">
      <aside className="sidebar">
        <div className="brand">
          Fido<span>.</span>
        </div>
        <nav className="nav">
          <Link href="/">⌂ &nbsp; Tableau de bord</Link>
          <Link href="/clients">♙ &nbsp; Clients</Link>
          <Link href="/documents">▣ &nbsp; Documents</Link>
          <Link href="/requests">✓ &nbsp; À traiter</Link>
          <Link href="/messages">✉ &nbsp; Messages</Link>
          <Link href="/notifications">● &nbsp; Notifications</Link>
          <Link className="active" href="/audit">◉ &nbsp; Journal d’audit</Link>
          <Link href="/settings">⚙ &nbsp; Paramètres</Link>
        </nav>
      </aside>
      <section className="main">
        <header className="topbar">
          <div>
            <div className="eyebrow">{firstRel(profile.organizations)?.name}</div>
            <h1 className="title">Journal d’audit</h1>
            <p className="muted">
              Traçabilité des accès et actions (loi 09-08). 200 événements les plus récents.
            </p>
          </div>
          <div className="user">
            <span>{profile.full_name || 'Propriétaire'}</span>
            <div className="avatar">{(profile.full_name || 'O').charAt(0).toUpperCase()}</div>
          </div>
        </header>

        <section className="card">
          {events?.length ? (
            <table className="audit-table" data-testid="audit-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Action</th>
                  <th>Entité</th>
                  <th>Acteur</th>
                  <th>Détails</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td>{new Date(e.created_at).toLocaleString('fr-FR')}</td>
                    <td>{ACTION_LABELS[e.action] || e.action}</td>
                    <td>
                      {e.entity_type}
                      <br />
                      <small className="muted">{e.entity_id}</small>
                    </td>
                    <td>{firstRel(e.profiles)?.full_name || e.actor_id || '—'}</td>
                    <td>
                      <code style={{ fontSize: 12 }}>
                        {JSON.stringify(e.meta || {}, null, 0).slice(0, 140)}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-state">
              <strong>Aucun événement</strong>
              <span>Le journal se remplira au fil de l’activité.</span>
            </div>
          )}
        </section>
      </section>
    </main>
  )
}
