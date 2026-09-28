import { firstRel } from '@/lib/rel'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function MessagesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('full_name,role,organization_id,organizations(name)').eq('id',user.id).single()
  if (!profile) return null
  const { data: messages } = await supabase.from('messages').select('id,body,created_at,sender_id,clients(company_name)').eq('organization_id',profile.organization_id).order('created_at',{ascending:false}).limit(50)
  return <main className="app"><aside className="sidebar"><div className="brand">Fido<span>.</span></div><nav className="nav"><Link href="/">⌂ &nbsp; Tableau de bord</Link><Link href="/clients">♙ &nbsp; Clients</Link><Link href="/documents">▣ &nbsp; Documents</Link><Link className="active" href="/messages">✉ &nbsp; Messages</Link><Link href="/settings">⚙ &nbsp; Paramètres</Link></nav></aside><section className="main"><header className="topbar"><div><div className="eyebrow">{firstRel(profile.organizations)?.name}</div><h1 className="title">Messages</h1></div><div className="user"><span>{profile.full_name || 'Utilisateur'}</span><div className="avatar">{(profile.full_name||'U').charAt(0).toUpperCase()}</div></div></header><section className="card"><div className="section-title">Conversations clients</div>{messages?.length ? messages.map(m=><div className="message" key={m.id}><div className="message-top"><span>{firstRel(m.clients)?.company_name || 'Client'}</span><span>{new Date(m.created_at).toLocaleDateString('fr-FR')}</span></div><p>{m.body}</p></div>) : <div className="empty-state"><strong>Aucun message</strong><span>Les conversations avec vos clients apparaîtront ici.</span></div>}</section></section></main>
}
