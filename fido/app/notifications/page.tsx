import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppShell from '@/components/AppShell'

export default async function NotificationsPage() {
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

  const { data: notifications } = await supabase
    .from('notifications')
    .select('id,type,title,body,read_at,created_at')
    .eq('recipient_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100)

  return (
    <AppShell
      active="/notifications"
      profile={profile}
      title="Notifications"
      welcome="Les événements importants de votre espace"
    >
      <section className="card">
        <div className="section-head">
          <div>
            <h2 className="section-title">Centre de notifications</h2>
            <p className="section-sub">{notifications?.length || 0} notification(s)</p>
          </div>
        </div>
        {notifications?.length ? (
          notifications.map((n) => (
            <div className="mini-row" key={n.id} style={{ padding: '14px 22px' }}>
              <div className="mini-row-top">
                <strong>{n.title}</strong>
                <span className="muted" style={{ fontSize: 12 }}>
                  {new Date(n.created_at).toLocaleString('fr-FR')}
                </span>
              </div>
              <div className="mini-row-sub" style={{ marginTop: 4 }}>
                {n.body || ''}
                {!n.read_at && (
                  <span className="pill pill-orange" style={{ marginLeft: 8 }}>
                    Nouveau
                  </span>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="empty-state">
            <strong>Aucune notification</strong>
            <span>Vous êtes à jour.</span>
          </div>
        )}
      </section>
    </AppShell>
  )
}
