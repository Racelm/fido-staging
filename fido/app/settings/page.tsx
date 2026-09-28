import { firstRel } from '@/lib/rel'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('full_name,role,organization_id,organizations(name)').eq('id',user.id).single()
  if (!profile) return null
  return <main className="app"><aside className="sidebar"><div className="brand">Fido<span>.</span></div><nav className="nav"><Link href="/">⌂ &nbsp; Tableau de bord</Link><Link href="/clients">♙ &nbsp; Clients</Link><Link href="/documents">▣ &nbsp; Documents</Link><Link href="/messages">✉ &nbsp; Messages</Link><Link className="active" href="/settings">⚙ &nbsp; Paramètres</Link></nav></aside><section className="main"><header className="topbar"><div><div className="eyebrow">{firstRel(profile.organizations)?.name}</div><h1 className="title">Paramètres</h1></div><div className="user"><span>{profile.full_name || 'Utilisateur'}</span><div className="avatar">{(profile.full_name||'U').charAt(0).toUpperCase()}</div></div></header><section className="card"><div className="section-title">Compte</div><div className="detail-meta"><div className="meta-box"><div className="meta-label">Nom</div><div className="meta-value">{profile.full_name || '—'}</div></div><div className="meta-box"><div className="meta-label">Rôle</div><div className="meta-value">{profile.role}</div></div><div className="meta-box"><div className="meta-label">E-mail</div><div className="meta-value">{user.email || '—'}</div></div></div></section><section className="card section"><div className="section-title">Configuration</div><div className="placeholder">Les paramètres du cabinet, les membres et les préférences seront ajoutés dans la prochaine phase.</div></section></section></main>
}
