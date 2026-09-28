import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import ClientUpload from './ClientUpload'
import MessageForm from './MessageForm'

export default async function ClientPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role, organization_id, organizations(name)')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'client') return null

  const { data: client } = await supabase
    .from('clients')
    .select('id, company_name, contact_name, email, organization_id')
    .eq('profile_id', user.id)
    .single()

  if (!client) return <main className="auth-page"><section className="auth-card"><div className="brand auth-brand">Fido<span>.</span></div><h1>Espace en préparation</h1><p className="auth-copy">Votre compte est bien créé mais votre espace client n'est pas encore rattaché. Contactez votre cabinet.</p></section></main>

  const [{ data: requests }, { data: documents }, { data: messages }] = await Promise.all([
    supabase.from('document_requests').select('id,title,description,status,due_date,created_at').eq('client_id', client.id).order('created_at', { ascending: false }).limit(20),
    supabase.from('documents').select('id,name,mime_type,size_bytes,created_at').eq('client_id', client.id).order('created_at', { ascending: false }).limit(20),
    supabase.from('messages').select('id,body,created_at,sender_id').eq('client_id', client.id).order('created_at', { ascending: true }).limit(50),
  ])

  return <main className="app">
    <aside className="sidebar"><div className="brand">Fido<span>.</span></div><nav className="nav">
      <Link className="active" href="/client">⌂ &nbsp; Mon espace</Link>
      <Link href="/client#demandes">✓ &nbsp; Mes demandes</Link>
      <Link href="/client#documents">▣ &nbsp; Mes documents</Link>
      <Link href="/client#messages">✉ &nbsp; Messages</Link>
    </nav></aside>
    <section className="main">
      <header className="topbar"><div><div className="eyebrow">Espace client · {client.company_name}</div><h1 className="title">Bonjour {profile.full_name || client.contact_name || 'et bienvenue'}</h1></div><div className="user"><span>{user.email}</span><div className="avatar">{(profile.full_name || 'C').charAt(0).toUpperCase()}</div></div></header>

      <div className="grid client-kpis">
        <div className="card"><div className="kpi-label">Demandes ouvertes</div><div className="kpi">{requests?.filter(r => r.status === 'pending').length || 0}</div></div>
        <div className="card"><div className="kpi-label">Documents envoyés</div><div className="kpi">{documents?.length || 0}</div></div>
        <div className="card"><div className="kpi-label">Messages</div><div className="kpi">{messages?.length || 0}</div></div>
      </div>

      <section id="demandes" className="card section"><div className="section-header"><div><div className="section-title">Demandes de votre cabinet</div><p className="muted">Les documents demandés et leurs échéances.</p></div></div>
        {requests?.length ? <div className="request-list">{requests.map(r => <article className="request-card" key={r.id}><div><strong>{r.title}</strong><p className="muted">{r.description || 'Document demandé par votre cabinet.'}</p>{r.due_date && <span className="muted">Échéance : {new Date(r.due_date).toLocaleDateString('fr-FR')}</span>}</div><div className="request-actions"><span className={`status ${r.status === 'pending' ? 'status-invited' : ''}`}>{r.status === 'pending' ? 'À envoyer' : r.status === 'received' ? 'Reçu' : 'Traité'}</span>{r.status === 'pending' && <ClientUpload clientId={client.id} organizationId={client.organization_id} requestId={r.id} />}</div></article>)}</div> : <div className="empty-state"><strong>Aucune demande</strong><span>Votre cabinet n'a pas encore demandé de document.</span></div>}
      </section>

      <section id="documents" className="card section"><div className="section-title">Mes documents</div>{documents?.length ? <div className="client-list">{documents.map(d => <div className="client-row" key={d.id}><div className="client-avatar">▣</div><div className="client-info"><strong>{d.name}</strong><span>{new Date(d.created_at).toLocaleDateString('fr-FR')} · {d.mime_type || 'Document'}</span></div></div>)}</div> : <div className="empty-state"><strong>Aucun document envoyé</strong><span>Les documents que vous envoyez à votre cabinet apparaîtront ici.</span></div>}</section>

      <section id="messages" className="card section"><div className="section-title">Messages avec votre cabinet</div><div className="message-thread">{messages?.map(m => <div className={`message-bubble ${m.sender_id === user.id ? 'mine' : ''}`} key={m.id}><div>{m.body}</div><small>{m.sender_id === user.id ? 'Vous' : 'Cabinet'} · {new Date(m.created_at).toLocaleString('fr-FR')}</small></div>)}</div><MessageForm clientId={client.id} /></section>
    </section>
  </main>
}
