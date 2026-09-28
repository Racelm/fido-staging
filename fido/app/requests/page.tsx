import { firstRel } from '@/lib/rel'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function RequestsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name,role,organization_id,organizations(name)')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile || !['owner', 'staff'].includes(profile.role)) redirect('/')

  const { data: requests } = await supabase
    .from('document_requests')
    .select('id,title,status,due_date,created_at,clients(id,company_name)')
    .eq('organization_id', profile.organization_id)
    .order('created_at', { ascending: false })
    .limit(100)

  return (
    <main className="app" data-testid="requests-page">
      <aside className="sidebar">
        <div className="brand">
          Fido<span>.</span>
        </div>
        <nav className="nav">
          <Link href="/">⌂ &nbsp; Tableau de bord</Link>
          <Link href="/clients">♙ &nbsp; Clients</Link>
          <Link href="/documents">▣ &nbsp; Documents</Link>
          <Link className="active" href="/requests">✓ &nbsp; À traiter</Link>
          <Link href="/messages">✉ &nbsp; Messages</Link>
          <Link href="/settings">⚙ &nbsp; Paramètres</Link>
        </nav>
      </aside>
      <section className="main">
        <header className="topbar">
          <div>
            <div className="eyebrow">{firstRel(profile.organizations)?.name}</div>
            <h1 className="title">À traiter</h1>
            <p className="muted">Une vue unique des demandes documentaires en cours.</p>
          </div>
          <div className="user">
            <span>{profile.full_name || 'Utilisateur'}</span>
            <div className="avatar">
              {(profile.full_name || 'U').charAt(0).toUpperCase()}
            </div>
          </div>
        </header>
        <section className="card">
          <div className="section-header">
            <div>
              <div className="section-title">Demandes</div>
              <p className="muted">{requests?.length || 0} demande(s)</p>
            </div>
          </div>
          {requests?.length ? (
            <div className="request-list" data-testid="request-list">
              {requests.map((r) => (
                <Link
                  className="request-card request-link"
                  href={`/clients/${firstRel(r.clients)?.id}`}
                  key={r.id}
                >
                  <div>
                    <strong>{r.title}</strong>
                    <p className="muted">{firstRel(r.clients)?.company_name || 'Client'}</p>
                  </div>
                  <div className="request-actions">
                    <span className={`status ${r.status === 'pending' ? 'status-invited' : ''}`}>
                      {r.status === 'pending'
                        ? 'En attente'
                        : r.status === 'received'
                          ? 'Reçu'
                          : 'Traité'}
                    </span>
                    <span className="muted">
                      {r.due_date
                        ? new Date(r.due_date).toLocaleDateString('fr-FR')
                        : 'Sans échéance'}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <strong>Tout est à jour</strong>
              <span>Aucune demande documentaire en cours.</span>
            </div>
          )}
        </section>
      </section>
    </main>
  )
}
