import { firstRel } from '@/lib/rel'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import ClientForm from './ClientForm'

export default async function ClientsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role, organization_id, organizations(name)')
    .eq('id', user.id)
    .single()

  if (!profile || !['owner', 'staff'].includes(profile.role)) return null

  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, contact_name, email, phone, status, created_at')
    .eq('organization_id', profile.organization_id)
    .order('created_at', { ascending: false })

  return (
    <main className="app">
      <aside className="sidebar">
        <div className="brand">Fido<span>.</span></div>
        <nav className="nav">
          <Link href="/">⌂ &nbsp; Tableau de bord</Link>
          <Link className="active" href="/clients">♙ &nbsp; Clients</Link>
          <Link href="/documents">▣ &nbsp; Documents</Link>
          <Link href="/messages">✉ &nbsp; Messages</Link>
          <Link href="/settings">⚙ &nbsp; Paramètres</Link>
        </nav>
      </aside>

      <section className="main">
        <header className="topbar">
          <div>
            <div className="eyebrow">{firstRel(profile.organizations)?.name}</div>
            <h1 className="title">Clients</h1>
          </div>
          <div className="user">
            <span>{profile.full_name || 'Utilisateur'}</span>
            <div className="avatar">{(profile.full_name || 'U').charAt(0).toUpperCase()}</div>
          </div>
        </header>

        <div className="content-grid">
          <section className="card">
            <div className="section-title">Ajouter un client</div>
            <p className="auth-copy">Créez l’espace du client. L’invitation pourra être ajoutée ensuite.</p>
            <ClientForm />
          </section>

          <section className="card">
            <div className="section-header">
              <div>
                <div className="section-title">Vos clients</div>
                <p className="muted">{clients?.length || 0} client(s)</p>
              </div>
            </div>
            <div className="client-list">
              {clients?.length ? clients.map((client) => (
                <Link className="client-row" href={`/clients/${client.id}`} key={client.id}>
                  <div className="client-avatar">{client.company_name.charAt(0).toUpperCase()}</div>
                  <div className="client-info">
                    <strong>{client.company_name}</strong>
                    <span>{client.contact_name || client.email || 'Aucun contact renseigné'}</span>
                  </div>
                  <span className={`status status-${client.status}`}>{client.status === 'active' ? 'Actif' : client.status === 'invited' ? 'Invité' : 'Inactif'}</span>
                </Link>
              )) : (
                <div className="empty-state">
                  <div className="empty-icon">♙</div>
                  <strong>Aucun client pour le moment</strong>
                  <span>Ajoutez votre premier client avec le formulaire.</span>
                </div>
              )}
            </div>
          </section>
        </div>
      </section>
    </main>
  )
}
