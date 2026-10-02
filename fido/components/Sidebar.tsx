import Link from 'next/link'
import { signOut } from '@/app/actions/auth'

export type NavItem = {
  href: string
  label: string
  icon: React.ReactNode
  badge?: number
}

type Props = {
  active: string // href match
  profile: {
    full_name: string | null
    role: string
    organizations?: { name: string | null } | { name: string | null }[] | null
  }
  items: NavItem[]
}

/**
 * Barre latérale "Workspace OS" façon Fido.
 * Server component (reçoit `profile` + nav items du parent).
 */
export default function Sidebar({ active, profile, items }: Props) {
  const initials = (profile.full_name || 'F').slice(0, 2).toUpperCase()
  const roleLabel = profile.role === 'owner' ? 'Propriétaire' : profile.role === 'staff' ? 'Collaborateur' : 'Client'

  return (
    <aside className="sidebar" data-testid="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <span className="sidebar-logo">F</span>
          <span>Fido</span>
          <span className="sidebar-chevron">▾</span>
        </div>
        <button className="sidebar-burger" type="button" aria-label="Menu">
          ☰
        </button>
      </div>

      <nav className="nav" data-testid="sidebar-nav">
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className={active === it.href || active.startsWith(it.href + '/') ? 'active' : ''}
            data-testid={`nav-${it.href.replace(/^\//, '') || 'dashboard'}`}
          >
            <span className="nav-icon" aria-hidden>{it.icon}</span>
            <span>{it.label}</span>
            {typeof it.badge === 'number' && it.badge > 0 && (
              <span className="nav-badge">{it.badge}</span>
            )}
          </Link>
        ))}
      </nav>

      <div className="sidebar-promo">
        <div className="sidebar-promo-title">
          <span style={{ fontSize: 16 }}>✦</span> Fido Pro
        </div>
        <div className="sidebar-promo-sub">
          Audit, versioning, rappels e-mail : votre cabinet est équipé.
        </div>
        <Link href="/settings" style={{ display: 'block' }}>
          <button type="button">Gérer mon offre</button>
        </Link>
      </div>

      <div className="sidebar-user">
        <div className="sidebar-user-avatar">{initials}</div>
        <div className="sidebar-user-info">
          <strong>{profile.full_name || 'Utilisateur'}</strong>
          <span>{roleLabel}</span>
        </div>
        <form action={signOut}>
          <button type="submit" title="Déconnexion" data-testid="signout-btn">↩</button>
        </form>
      </div>
    </aside>
  )
}
