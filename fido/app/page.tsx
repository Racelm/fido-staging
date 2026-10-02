import Link from 'next/link'
import { redirect } from 'next/navigation'
import { firstRel } from '@/lib/rel'
import { createClient } from '@/lib/supabase/server'
import AppShell, { NAV_ICONS } from '@/components/AppShell'

type RequestRow = {
  id: string
  title: string
  status: string
  due_date: string | null
  created_at: string
  clients: { id: string; company_name: string } | { id: string; company_name: string }[] | null
}

type DocumentRow = {
  id: string
  name: string
  created_at: string
  clients: { id: string; company_name: string } | { id: string; company_name: string }[] | null
}

type DeadlineRow = {
  id: string
  obligation: string
  period_label: string
  due_date: string
  clients: { id: string; company_name: string } | { id: string; company_name: string }[] | null
}

type AuditRow = {
  id: string
  action: string
  entity_type: string
  meta: Record<string, unknown>
  created_at: string
  profiles: { full_name: string | null } | { full_name: string | null }[] | null
}

const MONTHS_FR = ['janv', 'févr', 'mars', 'avril', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc']

function formatDay(iso: string): string {
  const d = new Date(iso)
  return `${d.getDate()} ${MONTHS_FR[d.getMonth()]}`
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffMin = Math.round(diffMs / 60000)
  if (diffMin < 60) return `il y a ${Math.max(1, diffMin)} min`
  const diffH = Math.round(diffMin / 60)
  if (diffH < 24) return `aujourd’hui, ${new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
  const diffD = Math.round(diffH / 24)
  if (diffD === 1) return 'hier'
  if (diffD < 7) return `il y a ${diffD} jours`
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}

function requestDotClass(dueDate: string | null, status: string): string {
  if (status === 'processed') return 'd-gray'
  if (!dueDate) return 'd-gray'
  const diff = Math.round((new Date(dueDate + 'T00:00:00Z').getTime() - Date.now()) / 86400000)
  if (diff < 0) return 'd-red'
  if (diff === 0) return 'd-orange'
  if (diff <= 3) return 'd-orange'
  if (status === 'received') return 'd-blue'
  return 'd-blue'
}

function requestStatusPill(dueDate: string | null, status: string): { label: string; cls: string } {
  if (status === 'processed') return { label: 'Traité', cls: 'pill-green' }
  if (status === 'received') return { label: 'En cours', cls: 'pill-blue' }
  if (!dueDate) return { label: 'Planifié', cls: 'pill-gray' }
  const diff = Math.round((new Date(dueDate + 'T00:00:00Z').getTime() - Date.now()) / 86400000)
  if (diff < 0) return { label: 'En retard', cls: 'pill-red' }
  if (diff === 0) return { label: 'Échéance aujourd’hui', cls: 'pill-orange' }
  if (diff <= 3) return { label: `Échéance J-${diff}`, cls: 'pill-orange' }
  return { label: 'Planifié', cls: 'pill-gray' }
}

const OBLIGATION_SHORT: Record<string, string> = {
  tva_mensuel: 'TVA',
  tva_trimestriel: 'TVA',
  is_acompte: 'IS',
  is_solde: 'IS',
  ir_professionnel: 'IR',
  cnss_mensuel: 'CNSS',
  taxe_professionnelle: 'Taxe pro',
}

const ACTION_LABEL: Record<string, { label: string; variant: 'a-green' | 'a-blue' | 'a-amber' | '' }> = {
  'document.upload': { label: 'téléchargé', variant: 'a-green' },
  'document.download': { label: 'téléchargé', variant: 'a-green' },
  'client.create': { label: 'ajouté', variant: 'a-amber' },
  'client.archive': { label: 'archivé', variant: '' },
  'request.create': { label: 'créée', variant: 'a-amber' },
  'invitation.create': { label: 'envoyée', variant: 'a-blue' },
  'notification.document_received': { label: 'reçue', variant: 'a-blue' },
}

const ACTION_ICON: Record<string, React.ReactNode> = {
  'document.upload': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" /><path d="M12 17v-6M9 14l3-3 3 3" /></svg>
  ),
  'document.download': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" /><path d="M12 11v6M9 14l3 3 3-3" /></svg>
  ),
  'request.create': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 10h8M8 14h5" /></svg>
  ),
  'invitation.create': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
  ),
  default: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /></svg>
  ),
}

export default async function DashboardPage() {
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
  if (!profile) redirect('/login')
  if (profile.role === 'client') redirect('/client')

  const orgId = profile.organization_id

  // Compteurs KPI
  const [openReqRes, overdueRes, docsCountRes, msgsCountRes, docsYdayCountRes, msgsYdayRes] =
    await Promise.all([
      supabase
        .from('document_requests')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .in('status', ['pending', 'received']),
      supabase
        .from('fiscal_deadlines')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('status', 'pending')
        .lt('due_date', new Date().toISOString().slice(0, 10)),
      supabase
        .from('documents')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .is('deleted_at', null)
        .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString()),
      supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString()),
      supabase
        .from('documents')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .is('deleted_at', null)
        .gte('created_at', new Date(Date.now() - 48 * 3600 * 1000).toISOString())
        .lt('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString()),
      supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .gte('created_at', new Date(Date.now() - 48 * 3600 * 1000).toISOString())
        .lt('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString()),
    ])

  const openRequests = openReqRes.count ?? 0
  const overdueDeadlines = overdueRes.count ?? 0
  const newDocs = docsCountRes.count ?? 0
  const newMsgs = msgsCountRes.count ?? 0
  const newDocsDelta = newDocs - (docsYdayCountRes.count ?? 0)
  const newMsgsDelta = newMsgs - (msgsYdayRes.count ?? 0)

  // "Que dois-je faire maintenant ?" — 5 requests triées par urgence (pending d'abord, due_date asc)
  const { data: todoRaw } = await supabase
    .from('document_requests')
    .select('id,title,status,due_date,created_at,clients(id,company_name)')
    .eq('organization_id', orgId)
    .in('status', ['pending', 'received'])
    .order('status', { ascending: true })
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(5)
  const todo = (todoRaw as unknown as RequestRow[]) || []

  // Colonne 1 — En attente du client (status pending)
  const { data: waitClientRaw } = await supabase
    .from('document_requests')
    .select('id,title,status,due_date,clients(id,company_name)')
    .eq('organization_id', orgId)
    .eq('status', 'pending')
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(3)
  const waitClient = (waitClientRaw as unknown as RequestRow[]) || []

  // Colonne 2 — En attente du cabinet (status received)
  const { data: waitCabinetRaw } = await supabase
    .from('document_requests')
    .select('id,title,status,due_date,created_at,clients(id,company_name)')
    .eq('organization_id', orgId)
    .eq('status', 'received')
    .order('created_at', { ascending: false })
    .limit(3)
  const waitCabinet = (waitCabinetRaw as unknown as RequestRow[]) || []

  // Colonne 3 — Échéances à venir (fiscal)
  const { data: deadlinesRaw } = await supabase
    .from('fiscal_deadlines')
    .select('id,obligation,period_label,due_date,clients(id,company_name)')
    .eq('organization_id', orgId)
    .eq('status', 'pending')
    .gte('due_date', new Date().toISOString().slice(0, 10))
    .order('due_date', { ascending: true })
    .limit(4)
  const upcomingDeadlines = (deadlinesRaw as unknown as DeadlineRow[]) || []

  // Rail — Fil d'activités (audit events)
  const { data: activityRaw } = await supabase
    .from('audit_events')
    .select('id,action,entity_type,meta,created_at,profiles(full_name)')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(5)
  const activities = (activityRaw as unknown as AuditRow[]) || []

  // Rail — Échéances à venir (bloc inférieur)
  const upcomingRail = upcomingDeadlines.slice(0, 4)

  const rail = (
    <>
      <section>
        <h3>Fil d’activités</h3>
        {activities.length ? (
          activities.map((a) => {
            const label = ACTION_LABEL[a.action] || { label: a.action, variant: '' }
            const metaName = (a.meta?.name as string) || (a.meta?.company_name as string) || (a.meta?.title as string) || a.entity_type
            const icon = ACTION_ICON[a.action] || ACTION_ICON.default
            return (
              <div key={a.id} className="activity">
                <div className={`activity-icon ${label.variant}`}>{icon}</div>
                <div className="activity-body">
                  <strong>{metaName}</strong>
                  <span>{firstRel(a.profiles)?.full_name || 'Système'} · {label.label}</span>
                  <span className="activity-time">{formatRelativeTime(a.created_at)}</span>
                </div>
              </div>
            )
          })
        ) : (
          <div className="muted" style={{ fontSize: 13 }}>Aucune activité pour le moment.</div>
        )}
        <Link href="/audit" className="btn-ghost" style={{ marginTop: 10 }}>
          Voir toutes les activités {NAV_ICONS.arrow}
        </Link>
      </section>

      <section>
        <h3>Échéances à venir</h3>
        {upcomingRail.length ? (
          upcomingRail.map((d) => {
            const date = new Date(d.due_date + 'T00:00:00Z')
            const client = firstRel(d.clients)
            return (
              <div key={d.id} className="deadline-row">
                <div className="deadline-date">
                  <span className="d">{date.getDate()}</span>
                  <span className="m">{MONTHS_FR[date.getMonth()]}</span>
                </div>
                <div className="deadline-body">
                  <strong>{OBLIGATION_SHORT[d.obligation] || d.obligation}</strong>
                  <span>{client?.company_name || 'Client'}</span>
                </div>
              </div>
            )
          })
        ) : (
          <div className="muted" style={{ fontSize: 13 }}>Aucune échéance à venir.</div>
        )}
        <Link href="/deadlines" className="btn-ghost" style={{ marginTop: 10 }}>
          Voir toutes les échéances {NAV_ICONS.arrow}
        </Link>
      </section>
    </>
  )

  const firstName = (profile.full_name || '').split(' ')[0] || 'tout le monde'

  return (
    <AppShell
      active="/"
      profile={profile}
      title="Tableau de bord"
      welcome={`Bienvenue, ${firstName} ! 👋`}
      unreadMessages={newMsgs}
      notificationCount={overdueDeadlines + newMsgs}
      rail={rail}
    >
      <div className="kpi-grid" data-testid="dashboard-kpis">
        <article className="kpi k-violet">
          <div className="kpi-icon">{NAV_ICONS.documents}</div>
          <div>
            <div className="kpi-value" data-testid="kpi-open-requests">{openRequests}</div>
            <div className="kpi-label">Demandes ouvertes</div>
          </div>
        </article>
        <article className="kpi k-red">
          <div className="kpi-icon">{NAV_ICONS.deadlines}</div>
          <div>
            <div className="kpi-value" data-testid="kpi-overdue">{overdueDeadlines}</div>
            <div className="kpi-label">Échéances dépassées</div>
          </div>
        </article>
        <article className="kpi k-green">
          <div className="kpi-icon">{NAV_ICONS.documents}</div>
          <div>
            <div className="kpi-value" data-testid="kpi-new-docs">{newDocs}</div>
            <div className="kpi-label">Nouveaux documents</div>
            <div className={`kpi-delta ${newDocsDelta > 0 ? 'up' : newDocsDelta < 0 ? 'down' : ''}`}>
              {newDocsDelta >= 0 ? '+' : ''}{newDocsDelta} depuis hier
            </div>
          </div>
        </article>
        <article className="kpi k-blue">
          <div className="kpi-icon">{NAV_ICONS.messages}</div>
          <div>
            <div className="kpi-value" data-testid="kpi-new-msgs">{newMsgs}</div>
            <div className="kpi-label">Nouveaux messages</div>
            <div className={`kpi-delta ${newMsgsDelta > 0 ? 'up' : newMsgsDelta < 0 ? 'down' : ''}`}>
              {newMsgsDelta >= 0 ? '+' : ''}{newMsgsDelta} depuis hier
            </div>
          </div>
        </article>
      </div>

      <section className="card" data-testid="todo-list">
        <div className="section-head">
          <div>
            <h2 className="section-title">Que dois-je faire maintenant ?</h2>
            <p className="section-sub">Priorisé par échéance et statut</p>
          </div>
        </div>

        {todo.length ? (
          todo.map((r) => {
            const client = firstRel(r.clients)
            const pill = requestStatusPill(r.due_date, r.status)
            const dotClass = requestDotClass(r.due_date, r.status)
            return (
              <Link
                key={r.id}
                className="task-row"
                href={client ? `/clients/${client.id}` : '/requests'}
              >
                <span className={`task-dot ${dotClass}`} />
                <span className="task-client">{client?.company_name || 'Client'}</span>
                <span className="task-text">{r.title}</span>
                <span className={`pill ${pill.cls}`}>{pill.label}</span>
                <span className="task-date">
                  {r.due_date ? formatDay(r.due_date + 'T00:00:00Z') : '—'}
                </span>
              </Link>
            )
          })
        ) : (
          <div className="empty-state">
            <strong>Rien à faire pour l’instant</strong>
            <span>Les demandes et échéances urgentes apparaîtront ici.</span>
          </div>
        )}

        <div className="card-footer">
          <Link href="/requests" className="btn-ghost">
            Voir toutes les tâches {NAV_ICONS.arrow}
          </Link>
        </div>
      </section>

      <div className="three-cols">
        {/* En attente du client */}
        <section className="mini-card">
          <div className="mini-card-header">
            <span className="mini-card-title">
              En attente du client
              {waitClient.length > 0 && <span className="mini-card-count">{waitClient.length}</span>}
            </span>
          </div>
          {waitClient.length ? (
            waitClient.map((r) => {
              const client = firstRel(r.clients)
              const pill = requestStatusPill(r.due_date, r.status)
              return (
                <div className="mini-row" key={r.id}>
                  <div className="mini-row-top">
                    <strong>{client?.company_name || 'Client'}</strong>
                    <span className={`pill ${pill.cls}`}>{pill.label}</span>
                  </div>
                  <div className="mini-row-sub">{r.title}</div>
                </div>
              )
            })
          ) : (
            <div className="mini-row"><span className="muted">Aucune demande ouverte.</span></div>
          )}
          <div className="mini-card-footer">
            <Link href="/requests" className="btn-ghost">Tout afficher {NAV_ICONS.arrow}</Link>
          </div>
        </section>

        {/* En attente du cabinet */}
        <section className="mini-card">
          <div className="mini-card-header">
            <span className="mini-card-title">
              En attente du cabinet
              {waitCabinet.length > 0 && <span className="mini-card-count">{waitCabinet.length}</span>}
            </span>
          </div>
          {waitCabinet.length ? (
            waitCabinet.map((r) => {
              const client = firstRel(r.clients)
              return (
                <div className="mini-row" key={r.id}>
                  <div className="mini-row-top">
                    <strong>{client?.company_name || 'Client'}</strong>
                    <span className="pill pill-blue">À traiter</span>
                  </div>
                  <div className="mini-row-sub">{r.title}</div>
                </div>
              )
            })
          ) : (
            <div className="mini-row"><span className="muted">Rien à traiter.</span></div>
          )}
          <div className="mini-card-footer">
            <Link href="/requests" className="btn-ghost">Tout afficher {NAV_ICONS.arrow}</Link>
          </div>
        </section>

        {/* Échéances à venir */}
        <section className="mini-card">
          <div className="mini-card-header">
            <span className="mini-card-title">
              Échéances à venir
              {upcomingDeadlines.length > 0 && (
                <span className="mini-card-count">{upcomingDeadlines.length}</span>
              )}
            </span>
          </div>
          {upcomingDeadlines.length ? (
            upcomingDeadlines.map((d) => {
              const client = firstRel(d.clients)
              const diffDays = Math.round(
                (new Date(d.due_date + 'T00:00:00Z').getTime() - Date.now()) / 86400000
              )
              const label =
                diffDays === 0 ? 'Aujourd’hui' : diffDays === 1 ? 'Demain' : `Dans ${diffDays}j`
              return (
                <div className="mini-row" key={d.id}>
                  <div className="mini-row-top">
                    <strong>
                      {OBLIGATION_SHORT[d.obligation] || d.obligation} — {client?.company_name}
                    </strong>
                    <span
                      className={`pill ${diffDays <= 1 ? 'pill-red' : diffDays <= 7 ? 'pill-orange' : 'pill-blue'}`}
                    >
                      {label}
                    </span>
                  </div>
                  <div className="mini-row-sub">{d.period_label}</div>
                </div>
              )
            })
          ) : (
            <div className="mini-row"><span className="muted">Aucune échéance imminente.</span></div>
          )}
          <div className="mini-card-footer">
            <Link href="/deadlines" className="btn-ghost">Tout afficher {NAV_ICONS.arrow}</Link>
          </div>
        </section>
      </div>
    </AppShell>
  )
}
