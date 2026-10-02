import Link from 'next/link'
import { redirect } from 'next/navigation'
import { firstRel } from '@/lib/rel'
import { createClient } from '@/lib/supabase/server'
import AppShell from '@/components/AppShell'
import { markDeadlineCompleted } from '@/app/actions/clients'

const OBLIGATION_LABEL: Record<string, string> = {
  tva_mensuel: 'TVA mensuelle',
  tva_trimestriel: 'TVA trimestrielle',
  is_acompte: 'IS acompte',
  is_solde: 'IS solde',
  ir_professionnel: 'IR pro',
  cnss_mensuel: 'CNSS',
  taxe_professionnelle: 'Taxe pro',
}

function dueClass(dueDate: string): string {
  const diffDays = Math.round(
    (new Date(dueDate + 'T00:00:00Z').getTime() - Date.now()) / 86400000
  )
  if (diffDays < 0) return 'pill-red'
  if (diffDays <= 7) return 'pill-orange'
  if (diffDays <= 30) return 'pill-blue'
  return 'pill-green'
}

async function completeAction(formData: FormData) {
  'use server'
  const id = String(formData.get('id') || '')
  if (id) await markDeadlineCompleted(id)
}

export default async function DeadlinesPage() {
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
  if (!profile || !['owner', 'staff'].includes(profile.role)) redirect('/')

  const { data: deadlines } = await supabase
    .from('fiscal_deadlines')
    .select(
      'id, obligation, period_label, due_date, status, reminded_at, client_id, clients(id, company_name)'
    )
    .eq('organization_id', profile.organization_id)
    .eq('status', 'pending')
    .order('due_date', { ascending: true })
    .limit(200)

  return (
    <AppShell
      active="/deadlines"
      profile={profile}
      title="Échéances fiscales"
      welcome="Vue consolidée DGI / CNSS · rappels J-7 automatiques"
    >
      <section className="card">
        <div className="section-head">
          <div>
            <h2 className="section-title">À venir</h2>
            <p className="section-sub">{deadlines?.length || 0} échéance(s) en attente</p>
          </div>
        </div>
        {deadlines?.length ? (
          <table className="audit-table" data-testid="deadlines-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Obligation</th>
                <th>Période</th>
                <th>Échéance</th>
                <th>Rappel</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {deadlines.map((d) => {
                const client = firstRel(d.clients)
                const dueDate = d.due_date as string
                return (
                  <tr key={d.id}>
                    <td style={{ fontWeight: 600 }}>
                      <Link href={`/clients/${client?.id}`}>{client?.company_name || 'Client'}</Link>
                    </td>
                    <td>{OBLIGATION_LABEL[d.obligation] || d.obligation}</td>
                    <td>{d.period_label}</td>
                    <td>
                      <span className={`pill ${dueClass(dueDate)}`}>
                        {new Date(dueDate + 'T00:00:00Z').toLocaleDateString('fr-FR', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                    </td>
                    <td>
                      {d.reminded_at ? (
                        <span className="pill pill-green">envoyé</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <form action={completeAction}>
                        <input type="hidden" name="id" value={d.id} />
                        <button
                          type="submit"
                          className="btn-secondary"
                          data-testid={`complete-${d.id}`}
                        >
                          Marquer traité
                        </button>
                      </form>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">
            <strong>Aucune échéance en attente</strong>
            <span>
              Les échéances sont générées automatiquement lors de la création d’un client
              (période TVA + début d’exercice).
            </span>
          </div>
        )}
      </section>
    </AppShell>
  )
}
