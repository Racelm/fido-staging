import { redirect } from 'next/navigation'
import { firstRel } from '@/lib/rel'
import { createClient } from '@/lib/supabase/server'
import AppShell from '@/components/AppShell'

const ACTION_LABELS: Record<string, string> = {
  'document.upload': 'Document téléversé',
  'document.download': 'Document téléchargé',
  'client.create': 'Client créé',
  'client.archive': 'Client archivé',
  'request.create': 'Demande créée',
  'invitation.create': 'Invitation générée',
  'notification.document_received': 'Notification (document reçu)',
}

export default async function AuditPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role, organization_id, organizations(name)')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile || profile.role !== 'owner') redirect('/')

  const { data: events } = await supabase
    .from('audit_events')
    .select('id, action, entity_type, entity_id, meta, created_at, actor_id, profiles(full_name)')
    .eq('organization_id', profile.organization_id)
    .order('created_at', { ascending: false })
    .limit(200)

  return (
    <AppShell
      active="/audit"
      profile={profile}
      title="Journal d’audit"
      welcome="Traçabilité des accès et actions · loi 09-08"
    >
      <section className="card">
        <div className="section-head">
          <div>
            <h2 className="section-title">Derniers événements</h2>
            <p className="section-sub">{events?.length || 0} entrées sur les 200 dernières</p>
          </div>
        </div>
        {events?.length ? (
          <table className="audit-table" data-testid="audit-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Action</th>
                <th>Entité</th>
                <th>Acteur</th>
                <th>Détails</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.created_at).toLocaleString('fr-FR')}</td>
                  <td>
                    <span className="pill pill-violet">
                      {ACTION_LABELS[e.action] || e.action}
                    </span>
                  </td>
                  <td>
                    {e.entity_type}
                    <br />
                    <small className="muted">{e.entity_id}</small>
                  </td>
                  <td>{firstRel(e.profiles)?.full_name || e.actor_id || '—'}</td>
                  <td>
                    <code>{JSON.stringify(e.meta || {}, null, 0).slice(0, 140)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">
            <strong>Aucun événement</strong>
            <span>Le journal se remplira au fil de l’activité.</span>
          </div>
        )}
      </section>
    </AppShell>
  )
}
