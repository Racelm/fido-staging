import Link from 'next/link'
import Sidebar, { type NavItem } from './Sidebar'

export const NAV_ICONS = {
  dashboard: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  clients: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v15l-3-2-3 2-3-2-3 2-3-2Z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </svg>
  ),
  requests: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="m8 12 3 3 5-5" />
    </svg>
  ),
  documents: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M8 13h8M8 17h5" />
    </svg>
  ),
  deadlines: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  team: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="10" cy="7" r="4" />
      <path d="M21 21v-2a4 4 0 0 0-3-3.87M17 3.13A4 4 0 0 1 17 11" />
    </svg>
  ),
  messages: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  audit: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4l2 2" />
    </svg>
  ),
  settings: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.602.852 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  gift: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
      <path d="M7.5 8a2.5 2.5 0 0 1 0-5c2.5 0 4.5 2.5 4.5 5M16.5 8a2.5 2.5 0 0 0 0-5c-2.5 0-4.5 2.5-4.5 5" />
    </svg>
  ),
  bell: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  search: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  ),
  plus: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  arrow: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  ),
}

export function defaultNav(role: string, unreadMessages = 0): NavItem[] {
  const items: NavItem[] = [
    { href: '/', label: 'Tableau de bord', icon: NAV_ICONS.dashboard },
    { href: '/clients', label: 'Dossiers clients', icon: NAV_ICONS.clients },
    { href: '/requests', label: 'Demandes', icon: NAV_ICONS.requests },
    { href: '/documents', label: 'Documents', icon: NAV_ICONS.documents },
    { href: '/deadlines', label: 'Échéances', icon: NAV_ICONS.deadlines },
    { href: '/team', label: 'Équipe', icon: NAV_ICONS.team },
    { href: '/messages', label: 'Messages', icon: NAV_ICONS.messages, badge: unreadMessages },
    { href: '/settings', label: 'Paramètres', icon: NAV_ICONS.settings },
  ]
  if (role === 'owner') {
    items.splice(7, 0, { href: '/audit', label: 'Journal d’audit', icon: NAV_ICONS.audit })
  }
  return items
}

type Props = {
  active: string
  profile: {
    full_name: string | null
    role: string
    organizations?: { name: string | null } | { name: string | null }[] | null
  }
  title: string
  welcome?: string
  unreadMessages?: number
  notificationCount?: number
  rail?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
}

export default function AppShell({
  active,
  profile,
  title,
  welcome,
  unreadMessages,
  notificationCount,
  rail,
  action,
  children,
}: Props) {
  const items = defaultNav(profile.role, unreadMessages ?? 0)

  return (
    <div className={`shell ${rail ? '' : 'narrow'}`} data-testid="app-shell">
      <Sidebar active={active} profile={profile} items={items} />

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{title}</h1>
            {welcome && <p className="welcome">{welcome}</p>}
          </div>

          <div className="search-box" role="search">
            <span style={{ color: 'var(--muted-2)' }} aria-hidden>{NAV_ICONS.search}</span>
            <input placeholder="Rechercher..." aria-label="Rechercher" />
            <span className="kbd">⌘ K</span>
          </div>

          <div className="topbar-actions">
            <Link href="/settings" className="icon-btn" aria-label="Nouveautés" title="Nouveautés">
              {NAV_ICONS.gift}
            </Link>
            <Link href="/notifications" className="icon-btn" aria-label="Notifications" title="Notifications">
              {NAV_ICONS.bell}
              {typeof notificationCount === 'number' && notificationCount > 0 && (
                <span className="dot">{notificationCount}</span>
              )}
            </Link>
            {action || (
              <Link href="/clients" className="btn-primary" data-testid="btn-new">
                {NAV_ICONS.plus}
                Nouveau
              </Link>
            )}
          </div>
        </header>

        {children}
      </main>

      {rail && <aside className="rail" data-testid="right-rail">{rail}</aside>}
    </div>
  )
}
