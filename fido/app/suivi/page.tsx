import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppShell, { NAV_ICONS } from '@/components/AppShell'
import { generateMonthlyRequests, relaunchNow, setRequestStatus } from '@/app/actions/reminders'
import { currentPeriod, daysBetween, frenchDate, periodLabel, todayInMorocco } from '@/lib/reminders'

type Row = {
  clientId: string
  company: string
  hasAccount: boolean
  paused: boolean
  request: {
    id: string
    status: string
    due_date: string
    reminder_stage: number
    last_reminded_at: string | null
    escalated_at: string | null
  } | null
  docs: number
}

type State = { key: string; label: string; cls: string; order: number }

const STAGE_LABEL = ['—', 'Annonce', 'Rappel J-3', 'Jour J', 'Retard']

function stateOf(r: Row, today: string): State {
  const q = r.request
  if (!q) return { key: 'none', label: 'Pas de demande', cls: 'pill-gray', order: 3 }
  if (q.status === 'processed') return { key: 'done', label: 'Traité', cls: 'pill-green', order: 5 }
  if (q.status === 'received') return { key: 'received', label: 'Reçu – à vérifier', cls: 'pill-blue', order: 4 }
  if (q.escalated_at) return { key: 'call', label: 'À appeler', cls: 'pill-red', order: 0 }
  if (daysBetween(today, q.due_date) > 0) return { key: 'late', label: 'En retard', cls: 'pill-red', order: 1 }
  return { key: 'waiting', label: 'En attente', cls: 'pill-orange', order: 2 }
}

export default async function SuiviPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role, organization_id, organizations(name)')
    .eq('id', user.id)
    .single()
  if (!profile) redirect('/login')
  if (!['owner', 'staff'].includes(profile.role)) redirect('/client')
  const orgId = profile.organization_id as string

  const { data: settings } = await supabase
    .from('reminder_settings')
    .select('enabled, due_day')
    .eq('organization_id', orgId)
    .maybeSingle()
  const today = todayInMorocco()
  const p = currentPeriod(today, settings?.due_day ?? 10)

  const [{ data: clients }, { data: requests }] = await Promise.all([
    supabase
      .from('clients')
      .select('id, company_name, profile_id, reminders_paused')
      .eq('organization_id', orgId)
      .eq('status', 'active')
      .is('deleted_at', null)
      .order('company_name'),
    supabase
      .from('document_requests')
      .select('id, client_id, status, due_date, reminder_stage, last_reminded_at, escalated_at')
      .eq('organization_id', orgId)
      .eq('is_recurring', true)
      .eq('period', p.period),
  ])

  const reqIds = (requests || []).map((r) => r.id as string)
  const [{ data: docs }, { count: remindersSent }] = reqIds.length
    ? await Promise.all([
        supabase.from('documents').select('request_id').in('request_id', reqIds).is('deleted_at', null),
        supabase
          .from('reminder_log')
          .select('id', { count: 'exact', head: true })
          .in('request_id', reqIds)
          .eq('ok', true)
          .lte('stage', 4),
      ])
    : [{ data: [] as { request_id: string }[] }, { count: 0 }]

  const docCount = new Map<string, number>()
  for (const d of docs || []) docCount.set(d.request_id as string, (docCount.get(d.request_id as string) || 0) + 1)
  const reqByClient = new Map((requests || []).map((r) => [r.client_id as string, r]))

  const rows: Array<Row & { state: State }> = (clients || [])
    .map((c) => {
      const q = reqByClient.get(c.id as string)
      const row: Row = {
        clientId: c.id as string,
        company: c.company_name as string,
        hasAccount: !!c.profile_id,
        paused: !!c.reminders_paused,
        request: q
          ? {
              id: q.id as string,
              status: q.status as string,
              due_date: q.due_date as string,
              reminder_stage: (q.reminder_stage as number) ?? 0,
              last_reminded_at: q.last_reminded_at as string | null,
              escalated_at: q.escalated_at as string | null,
            }
          : null,
        docs: q ? docCount.get(q.id as string) || 0 : 0,
      }
      return { ...row, state: stateOf(row, today) }
    })
    .sort((a, b) => a.state.order - b.state.order || a.company.localeCompare(b.company, 'fr'))

  const total = rows.length
  const complete = rows.filter((r) => r.state.key === 'received' || r.state.key === 'done').length
  const afterReminder = rows.filter(
    (r) => (r.state.key === 'received' || r.state.key === 'done') && (r.request?.reminder_stage ?? 0) > 0
  ).length
  const toCall = rows.filter((r) => r.state.key === 'call').length
  const missingRequests = rows.filter((r) => r.state.key === 'none').length

  return (
    <AppShell
      active="/suivi"
      profile={profile}
      title="Suivi mensuel"
      welcome={`Documents de ${periodLabel(p.period)} · date limite ${frenchDate(p.dueDate)}`}
    >
      {!settings?.enabled && (
        <section className="card card-padded" style={{ marginBottom: 16, borderLeft: '4px solid var(--violet-500)' }}>
          <strong>Les relances automatiques sont désactivées.</strong>{' '}
          <span className="muted">
            Vous pouvez relancer à la main ci-dessous, ou les activer dans{' '}
            <Link href="/settings">Paramètres</Link>.
          </span>
        </section>
      )}

      <div className="kpi-grid" data-testid="suivi-kpis">
        <article className="kpi k-green">
          <div className="kpi-icon">✓</div>
          <div>
            <div className="kpi-value">
              {complete}/{total}
            </div>
            <div className="kpi-label">Clients ayant déposé</div>
          </div>
        </article>
        <article className="kpi k-violet">
          <div className="kpi-icon">◷</div>
          <div>
            <div className="kpi-value">{remindersSent ?? 0}</div>
            <div className="kpi-label">Rappels envoyés par Tiwizi</div>
          </div>
        </article>
        <article className="kpi k-blue">
          <div className="kpi-icon">↻</div>
          <div>
            <div className="kpi-value">{afterReminder}</div>
            <div className="kpi-label">Dépôts après un rappel</div>
          </div>
        </article>
        <article className="kpi k-red">
          <div className="kpi-icon">☎</div>
          <div>
            <div className="kpi-value">{toCall}</div>
            <div className="kpi-label">Clients à appeler</div>
          </div>
        </article>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="section-head">
          <div>
            <h2 className="section-title">Ce qui manque ce mois-ci</h2>
            <p className="section-sub">Un client par ligne, les urgences en premier</p>
          </div>
          {missingRequests > 0 && (
            <form action={generateMonthlyRequests}>
              <button className="btn-primary" type="submit" data-testid="generate-requests">
                {NAV_ICONS.plus} Créer les {missingRequests} demande(s) manquante(s)
              </button>
            </form>
          )}
        </div>

        {rows.length ? (
          <table className="audit-table" data-testid="suivi-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Statut</th>
                <th>Documents</th>
                <th>Dernier rappel</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.clientId}>
                  <td style={{ fontWeight: 600 }}>
                    <Link href={`/clients/${r.clientId}`}>{r.company}</Link>
                    {!r.hasAccount && (
                      <div className="muted" style={{ fontSize: 11, fontWeight: 400 }}>
                        Compte Tiwizi non activé : pas de rappel possible
                      </div>
                    )}
                    {r.paused && (
                      <div className="muted" style={{ fontSize: 11, fontWeight: 400 }}>
                        Rappels en pause
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`pill ${r.state.cls}`}>{r.state.label}</span>
                  </td>
                  <td>{r.request ? r.docs : '—'}</td>
                  <td>
                    {r.request?.last_reminded_at
                      ? `${STAGE_LABEL.at(r.request.reminder_stage) ?? '—'} · ${new Date(
                          r.request.last_reminded_at
                        ).toLocaleDateString('fr-FR')}`
                      : '—'}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {r.request && r.request.status === 'pending' && r.hasAccount && (
                      <form action={relaunchNow.bind(null, r.request.id)} style={{ display: 'inline' }}>
                        <button className="btn-ghost" type="submit" style={{ fontSize: 13 }}>
                          Relancer maintenant
                        </button>
                      </form>
                    )}
                    {r.request && r.request.status === 'received' && (
                      <>
                        <form
                          action={setRequestStatus.bind(null, r.request.id, 'pending')}
                          style={{ display: 'inline' }}
                        >
                          <button className="btn-ghost" type="submit" style={{ fontSize: 13 }}>
                            Incomplet
                          </button>
                        </form>{' '}
                        <form
                          action={setRequestStatus.bind(null, r.request.id, 'processed')}
                          style={{ display: 'inline' }}
                        >
                          <button className="btn-ghost" type="submit" style={{ fontSize: 13 }}>
                            Complet ✓
                          </button>
                        </form>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">
            <strong>Aucun client actif</strong>
            <span>Ajoutez vos clients pour suivre leurs documents mensuels.</span>
          </div>
        )}
      </section>
    </AppShell>
  )
}
