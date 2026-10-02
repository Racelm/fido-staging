import Link from 'next/link'
import { redirect } from 'next/navigation'
import { firstRel } from '@/lib/rel'
import { createClient } from '@/lib/supabase/server'
import AppShell, { NAV_ICONS } from '@/components/AppShell'

export default async function RequestsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name,role,organization_id,organizations(name)')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile || !['owner', 'staff'].includes(profile.role)) redirect('/')

  const { data: requests } = await supabase
    .from('document_requests')
    .select('id,title,status,due_date,created_at,clients(id,company_name)')
    .eq('organization_id', profile.organization_id)
    .order('created_at', { ascending: false })
    .limit(100)

  const pill = (status: string, dueDate: string | null) => {
    if (status === 'processed') return { label: 'Traité', cls: 'pill-green' }
    if (status === 'received') return { label: 'En cours', cls: 'pill-blue' }
    if (!dueDate) return { label: 'Planifié', cls: 'pill-gray' }
    const diff = Math.round((new Date(dueDate + 'T00:00:00Z').getTime() - Date.now()) / 86400000)
    if (diff < 0) return { label: 'En retard', cls: 'pill-red' }
    if (diff === 0) return { label: 'Aujourd’hui', cls: 'pill-orange' }
    if (diff <= 3) return { label: `J-${diff}`, cls: 'pill-orange' }
    return { label: 'En attente', cls: 'pill-gray' }
  }

  return (
    <AppShell
      active="/requests"
      profile={profile}
      title="Demandes"
      welcome={`${requests?.length || 0} demande(s) suivie(s)`}
    >
      <section className="card">
        <div className="section-head">
          <div>
            <h2 className="section-title">Toutes les demandes</h2>
            <p className="section-sub">Triées par date de création</p>
          </div>
        </div>
        {requests?.length ? (
          <table className="audit-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Demande</th>
                <th>Statut</th>
                <th>Échéance</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => {
                const client = firstRel(r.clients)
                const p = pill(r.status, r.due_date)
                return (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>{client?.company_name || 'Client'}</td>
                    <td>{r.title}</td>
                    <td>
                      <span className={`pill ${p.cls}`}>{p.label}</span>
                    </td>
                    <td>
                      {r.due_date
                        ? new Date(r.due_date + 'T00:00:00Z').toLocaleDateString('fr-FR')
                        : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <Link
                        href={`/clients/${client?.id}`}
                        className="btn-ghost"
                        style={{ fontSize: 13 }}
                      >
                        Ouvrir {NAV_ICONS.arrow}
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">
            <strong>Tout est à jour</strong>
            <span>Aucune demande en cours.</span>
          </div>
        )}
      </section>
    </AppShell>
  )
}
