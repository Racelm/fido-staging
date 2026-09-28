import { firstRel } from '@/lib/rel'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import DownloadButton from './DownloadButton'

export default async function DocumentsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('full_name,role,organization_id,organizations(name)').eq('id',user.id).single()
  if (!profile || !['owner','staff'].includes(profile.role)) return null
  const { data: documents } = await supabase.from('documents').select('id,name,mime_type,size_bytes,created_at,clients(company_name)').eq('organization_id',profile.organization_id).order('created_at',{ascending:false}).limit(100)

  return <main className="app"><aside className="sidebar"><div className="brand">Fido<span>.</span></div><nav className="nav"><Link href="/">⌂ &nbsp; Tableau de bord</Link><Link href="/clients">♙ &nbsp; Clients</Link><Link className="active" href="/documents">▣ &nbsp; Documents</Link><Link href="/requests">✓ &nbsp; À traiter</Link><Link href="/messages">✉ &nbsp; Messages</Link><Link href="/settings">⚙ &nbsp; Paramètres</Link></nav></aside>
  <section className="main"><header className="topbar"><div><div className="eyebrow">{firstRel(profile.organizations)?.name}</div><h1 className="title">Documents</h1><p className="muted">Tous les fichiers partagés avec vos clients.</p></div><div className="user"><span>{profile.full_name || 'Utilisateur'}</span><div className="avatar">{(profile.full_name||'U').charAt(0).toUpperCase()}</div></div></header>
  <section className="card"><div className="section-header"><div><div className="section-title">Documents reçus</div><p className="muted">{documents?.length || 0} document(s)</p></div></div>
  {documents?.length ? <div className="client-list">{documents.map(d=><div className="client-row" key={d.id}><div className="client-avatar">▣</div><div className="client-info"><strong>{d.name}</strong><span>{firstRel(d.clients)?.company_name || 'Client'} · {new Date(d.created_at).toLocaleDateString('fr-FR')} · {d.size_bytes ? Math.round(d.size_bytes/1024) + ' Ko' : 'Taille inconnue'}</span></div><DownloadButton documentId={d.id} /></div>)}</div> : <div className="empty-state"><strong>Aucun document</strong><span>Les documents de vos clients apparaîtront ici.</span></div>}</section></section></main>
}
