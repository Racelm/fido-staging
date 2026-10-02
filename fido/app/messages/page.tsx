import { redirect } from 'next/navigation'
import { firstRel } from '@/lib/rel'
import { createClient } from '@/lib/supabase/server'
import AppShell from '@/components/AppShell'

export default async function MessagesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name,role,organization_id,organizations(name)')
    .eq('id', user.id)
    .single()
  if (!profile) redirect('/login')

  const { data: messages } = await supabase
    .from('messages')
    .select('id,body,created_at,sender_id,clients(company_name)')
    .eq('organization_id', profile.organization_id)
    .order('created_at', { ascending: false })
    .limit(50)

  return (
    <AppShell
      active="/messages"
      profile={profile}
      title="Messages"
      welcome="Toutes les conversations avec vos clients"
    >
      <section className="card">
        <div className="section-head">
          <div>
            <h2 className="section-title">Conversations récentes</h2>
            <p className="section-sub">{messages?.length || 0} message(s)</p>
          </div>
        </div>
        {messages?.length ? (
          messages.map((m) => (
            <div className="mini-row" key={m.id} style={{ padding: '14px 22px' }}>
              <div className="mini-row-top">
                <strong>{firstRel(m.clients)?.company_name || 'Client'}</strong>
                <span className="muted" style={{ fontSize: 12 }}>
                  {new Date(m.created_at).toLocaleString('fr-FR')}
                </span>
              </div>
              <div className="mini-row-sub" style={{ marginTop: 6, color: 'var(--ink-2)' }}>
                {m.body}
              </div>
            </div>
          ))
        ) : (
          <div className="empty-state">
            <strong>Aucun message</strong>
            <span>Les conversations avec vos clients apparaîtront ici.</span>
          </div>
        )}
      </section>
    </AppShell>
  )
}
