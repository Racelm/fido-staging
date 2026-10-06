import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { signOut } from '@/app/actions/auth'
import EditOwnProfileForm from './EditOwnProfileForm'

export default async function ClientProfilePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', user.id)
    .single()
  if (!profile || profile.role !== 'client') redirect('/')

  const { data: client } = await supabase
    .from('clients')
    .select(
      'id, company_name, contact_name, email, phone, address, website, ice, if_number, rc_number, cnss_number'
    )
    .eq('profile_id', user.id)
    .is('deleted_at', null)
    .single()

  if (!client) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <div className="auth-brand"><span className="logo">F</span>Fido</div>
          <h1>Espace en préparation</h1>
          <p className="auth-copy">
            Votre compte n’est pas encore rattaché à un dossier client. Contactez votre cabinet.
          </p>
          <form action={signOut}>
            <button className="auth-submit" type="submit">Se déconnecter</button>
          </form>
        </section>
      </main>
    )
  }

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
          <Link href="/client">
            <span className="nav-icon">⌂</span>
            <span>Mon espace</span>
          </Link>
          <Link href="/client/profile" className="active">
            <span className="nav-icon">◉</span>
            <span>Mes informations</span>
          </Link>
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

      <main className="main">
        <header className="topbar">
          <div>
            <div className="eyebrow">Mon profil · {client.company_name}</div>
            <h1>Mes informations</h1>
            <p className="welcome">
              Mettez à jour vos coordonnées. Votre cabinet est notifié automatiquement.
            </p>
          </div>
          <div />
          <div />
        </header>

        <section
          className="card card-padded"
          style={{ maxWidth: 720 }}
          data-testid="own-profile-section"
        >
          <EditOwnProfileForm client={client} />
        </section>
      </main>
    </div>
  )
}
