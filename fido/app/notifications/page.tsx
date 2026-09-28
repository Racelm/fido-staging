import { firstRel } from '@/lib/rel'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function NotificationsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('full_name,role,organization_id,organizations(name)').eq('id',user.id).single()
  if (!profile) return null
  const { data: notifications } = await supabase.from('notifications').select('id,type,title,body,entity_type,entity_id,read_at,created_at').eq('recipient_id',user.id).order('created_at',{ascending:false}).limit(100)
  return <main className="app"><aside className="sidebar"><div className="brand">Fido<span>.</span></div><nav className="nav">
    {profile.role === 'client' ? <Link href="/client">⌂ &nbsp; Mon espace</Link> : <><Link href="/">⌂ &nbsp; Tableau de bord</Link><Link href="/clients">♙ &nbsp; Clients</Link><Link href="/documents">▣ &nbsp; Documents</Link><Link href="/requests">✓ &nbsp; À traiter</Link><Link href="/messages">✉ &nbsp; Messages</Link></>}
    <Link className="active" href="/notifications">● &nbsp; Notifications</Link>
  </nav></aside><section className="main"><header className="topbar"><div><div className="eyebrow">{firstRel(profile.organizations)?.name || 'Fido'}</div><h1 className="title">Notifications</h1><p className="muted">Les événements importants de votre espace.</p></div><div className="user"><span>{profile.full_name || 'Utilisateur'}</span><div className="avatar">{(profile.full_name || 'U').charAt(0).toUpperCase()}</div></div></header>
  <section className="card">{notifications?.length ? <div className="client-list">{notifications.map(n=><div className="client-row" key={n.id}><div className="client-avatar">{n.type === 'message' ? '✉' : n.type === 'document_received' ? '▣' : '✓'}</div><div className="client-info"><strong>{n.title}</strong><span>{n.body || ''} · {new Date(n.created_at).toLocaleString('fr-FR')}</span></div>{!n.read_at && <span className="status status-invited">Nouveau</span>}</div>)}</div> : <div className="empty-state"><strong>Aucune notification</strong><span>Vous êtes à jour.</span></div>}</section></section></main>
}
