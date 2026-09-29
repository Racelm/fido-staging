import { firstRel } from '@/lib/rel'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { signOut } from '@/app/actions/auth'

export default async function DashboardPage() {
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

  // Utilisateur sans cabinet (rare — invitation client sans profil rattaché) => login
  if (!profile) redirect('/login')

  // Clients redirigés vers leur espace
  if (profile.role === 'client') redirect('/client')

  const orgId = profile.organization_id
  const [{ count: clientsCount }, { count: pendingCount }, { count: docsCount }, { data: recentRequests }, { data: recentDocs }] =
    await Promise.all([
      supabase.from('clients').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).is('deleted_at', null),
      supabase
        .from('document_requests')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('status', 'pending'),
      supabase.from('documents').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).is('deleted_at', null),
      supabase
        .from('document_requests')
        .select('id,title,status,due_date,clients(company_name)')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(5),
      supabase
        .from('documents')
        .select('id,name,created_at,clients(company_name)')
        .eq('organization_id', orgId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(5),
    ])

  return (
    <main className="app" data-testid="dashboard">
      <aside className="sidebar">
        <div className="brand">
          Fido<span>.</span>
        </div>
        <nav className="nav">
          <Link className="active" href="/" data-testid="nav-dashboard">⌂ &nbsp; Tableau de bord</Link>
          <Link href="/clients" data-testid="nav-clients">♙ &nbsp; Clients</Link>
          <Link href="/documents" data-testid="nav-documents">▣ &nbsp; Documents</Link>
          <Link href="/requests" data-testid="nav-requests">✓ &nbsp; À traiter</Link>
          <Link href="/deadlines" data-testid="nav-deadlines">◷ &nbsp; Échéances</Link>
          <Link href="/messages" data-testid="nav-messages">✉ &nbsp; Messages</Link>
          <Link href="/notifications" data-testid="nav-notifications">● &nbsp; Notifications</Link>
          <Link href="/settings" data-testid="nav-settings">⚙ &nbsp; Paramètres</Link>
        </nav>
      </aside>

      <section className="main">
        <header className="topbar">
          <div>
            <div className="eyebrow">{firstRel(profile.organizations)?.name}</div>
            <h1 className="title">Tableau de bord</h1>
            <p className="muted">Vue synthétique de votre activité fiduciaire.</p>
          </div>
          <div className="user">
            <span>{profile.full_name || user.email}</span>
            <div className="avatar">{(profile.full_name || user.email || 'U').charAt(0).toUpperCase()}</div>
            <form action={signOut}>
              <button className="secondary" type="submit" data-testid="signout-btn">Déconnexion</button>
            </form>
          </div>
        </header>

        <div className="grid" data-testid="dashboard-kpis">
          <div className="card">
            <div className="kpi-label">Clients actifs</div>
            <div className="kpi" data-testid="kpi-clients">{clientsCount ?? 0}</div>
          </div>
          <div className="card">
            <div className="kpi-label">Demandes ouvertes</div>
            <div className="kpi" data-testid="kpi-pending">{pendingCount ?? 0}</div>
          </div>
          <div className="card">
            <div className="kpi-label">Documents reçus</div>
            <div className="kpi" data-testid="kpi-documents">{docsCount ?? 0}</div>
          </div>
          <div className="card">
            <div className="kpi-label">Rôle</div>
            <div className="kpi" style={{ fontSize: '1.4rem' }}>{profile.role === 'owner' ? 'Propriétaire' : 'Collaborateur'}</div>
          </div>
        </div>

        <section className="content-grid section">
          <section className="card">
            <div className="section-header">
              <div>
                <div className="section-title">Demandes récentes</div>
                <p className="muted">Les 5 dernières demandes envoyées à vos clients.</p>
              </div>
              <Link className="secondary" href="/requests">Voir tout</Link>
            </div>
            {recentRequests?.length ? recentRequests.map((r) => (
              <div className="request-card" key={r.id}>
                <div>
                  <strong>{r.title}</strong>
                  <p className="muted">{firstRel(r.clients)?.company_name || 'Client'}</p>
                </div>
                <span className={`status ${r.status === 'pending' ? 'status-invited' : ''}`}>
                  {r.status === 'pending' ? 'En attente' : r.status === 'received' ? 'Reçu' : 'Traité'}
                </span>
              </div>
            )) : (
              <div className="empty-state">
                <strong>Aucune demande</strong>
                <span>Créez votre première demande depuis un client.</span>
              </div>
            )}
          </section>

          <section className="card">
            <div className="section-header">
              <div>
                <div className="section-title">Derniers documents</div>
                <p className="muted">Fichiers reçus récemment.</p>
              </div>
              <Link className="secondary" href="/documents">Voir tout</Link>
            </div>
            {recentDocs?.length ? recentDocs.map((d) => (
              <div className="client-row" key={d.id}>
                <div className="client-avatar">▣</div>
                <div className="client-info">
                  <strong>{d.name}</strong>
                  <span>{firstRel(d.clients)?.company_name || 'Client'} · {new Date(d.created_at).toLocaleDateString('fr-FR')}</span>
                </div>
              </div>
            )) : (
              <div className="empty-state">
                <strong>Aucun document</strong>
                <span>Les fichiers apparaîtront ici dès qu’un client aura téléversé.</span>
              </div>
            )}
          </section>
        </section>
      </section>
    </main>
  )
}
