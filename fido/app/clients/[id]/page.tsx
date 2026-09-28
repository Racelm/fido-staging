import { firstRel } from '@/lib/rel'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import InviteButton from './InviteButton'
import RequestForm from './RequestForm'
import MessageForm from '@/app/client/MessageForm'
import DownloadButton from '@/app/documents/DownloadButton'

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('full_name, role, organization_id, organizations(name)').eq('id', user.id).single()
  if (!profile || !['owner', 'staff'].includes(profile.role)) return null
  const { data: client } = await supabase.from('clients').select('id, company_name, contact_name, email, phone, status, created_at').eq('id', id).eq('organization_id', profile.organization_id).single()
  if (!client) notFound()
  const [{ data: requests }, { data: documents }, { data: messages }, { data: invitation }] = await Promise.all([
    supabase.from('document_requests').select('id,title,status,due_date,created_at').eq('client_id', id).order('created_at', { ascending: false }).limit(10),
    supabase.from('documents').select('id,name,mime_type,size_bytes,created_at').eq('client_id', id).order('created_at', { ascending: false }).limit(10),
    supabase.from('messages').select('id,body,created_at,sender_id').eq('client_id', id).order('created_at', { ascending: false }).limit(10),
    supabase.from('client_invitations').select('expires_at,accepted_at').eq('client_id', id).is('accepted_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  return <main className="app"><aside className="sidebar"><div className="brand">Fido<span>.</span></div><nav className="nav"><Link href="/">⌂ &nbsp; Tableau de bord</Link><Link className="active" href="/clients">♙ &nbsp; Clients</Link><Link href="/documents">▣ &nbsp; Documents</Link><Link href="/requests">✓ &nbsp; À traiter</Link><Link href="/messages">✉ &nbsp; Messages</Link><Link href="/notifications">● &nbsp; Notifications</Link><Link href="/settings">⚙ &nbsp; Paramètres</Link></nav></aside><section className="main">
    <header className="topbar"><div><div className="eyebrow">{firstRel(profile.organizations)?.name}</div><h1 className="title">Espace client</h1></div><div className="user"><span>{profile.full_name || 'Utilisateur'}</span><div className="avatar">{(profile.full_name || 'U').charAt(0).toUpperCase()}</div></div></header>
    <Link className="back-link" href="/clients">← Retour aux clients</Link>
    <section className="card detail-card"><div className="section-header"><div><div className="section-title">{client.company_name}</div><p className="muted">Espace de collaboration sécurisé</p></div><span className={`status status-${client.status}`}>{client.status === 'active' ? 'Actif' : client.status === 'invited' ? 'Invité' : 'Inactif'}</span></div><div className="detail-meta"><div className="meta-box"><div className="meta-label">Contact</div><div className="meta-value">{client.contact_name || '—'}</div></div><div className="meta-box"><div className="meta-label">E-mail</div><div className="meta-value">{client.email || '—'}</div></div><div className="meta-box"><div className="meta-label">Téléphone</div><div className="meta-value">{client.phone || '—'}</div></div></div><InviteButton clientId={client.id} existingInvitation={invitation ? { expiresAt: invitation.expires_at } : null} /></section>
    <div className="content-grid" style={{ marginTop: 18 }}><section className="card"><div className="section-title">Nouvelle demande</div><p className="muted">Demandez un document précis au client.</p><RequestForm clientId={client.id} /></section><section className="card"><div className="section-title">Demandes de documents</div>{requests?.length ? requests.map(r => <div className="message" key={r.id}><div className="message-top"><span>{r.title}</span><span className="status">{r.status === 'pending' ? 'En attente' : r.status === 'received' ? 'Reçu' : 'Traité'}</span></div><p>{r.due_date ? `Échéance : ${r.due_date}` : 'Aucune échéance'}</p></div>) : <div className="empty-state"><strong>Aucune demande</strong><span>Les demandes apparaîtront ici.</span></div>}</section></div>
    <div className="content-grid" style={{ marginTop: 18 }}><section className="card"><div className="section-title">Documents récents</div>{documents?.length ? documents.map(d => <div className="message" key={d.id}><div className="message-top"><span>{d.name}</span><DownloadButton documentId={d.id} /></div><p>{new Date(d.created_at).toLocaleDateString('fr-FR')}</p></div>) : <div className="empty-state"><strong>Aucun document</strong><span>Les documents reçus apparaîtront ici.</span></div>}</section><section className="card"><div className="section-title">Messages</div>{messages?.length ? messages.map(m => <div className="message" key={m.id}><div className="message-top"><span>{m.sender_id === user.id ? 'Vous' : 'Client'}</span><span>{new Date(m.created_at).toLocaleDateString('fr-FR')}</span></div><p>{m.body}</p></div>) : <div className="empty-state"><strong>Aucun message</strong><span>La conversation apparaîtra ici.</span></div>}</section></div><MessageForm clientId={client.id} />
  </section></main>
}
