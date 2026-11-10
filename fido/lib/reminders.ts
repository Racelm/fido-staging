/**
 * Relances automatiques — logique pure (sans I/O), testable isolément.
 * Utilisée par app/api/cron/document-reminders/route.ts.
 */

export type ReminderSettings = {
  organization_id: string
  enabled: boolean
  due_day: number
  before_days: number
  overdue_days: number
  escalate_days: number
}

export type ReminderAction =
  | { kind: 'none' }
  | { kind: 'client'; stage: 1 | 2 | 3 | 4 }
  | { kind: 'escalate' }

export const TZ = 'Africa/Casablanca'

const MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

/** Date du jour (YYYY-MM-DD) dans le fuseau du Maroc. */
export function todayInMorocco(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now)
}

/** 0 = dimanche … 6 = samedi, dans le fuseau du Maroc. */
export function weekdayInMorocco(now = new Date()): number {
  const d = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(now)
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(d)
}

/** Différence en jours entiers : a - b (dates ISO YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86_400_000)
}

/**
 * Pour une date du jour, la période à demander (mois précédent) et son échéance
 * (le `dueDay` du mois courant). Ex. 2026-11-03, dueDay 10 →
 * { period: '2026-10-01', dueDate: '2026-11-10', label: 'octobre 2026' }.
 */
export function currentPeriod(today: string, dueDay: number) {
  const [y, m] = today.split('-').map(Number)
  const py = m === 1 ? y - 1 : y
  const pm = m === 1 ? 12 : m - 1
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    period: `${py}-${pad(pm)}-01`,
    dueDate: `${y}-${pad(m)}-${pad(dueDay)}`,
    label: `${MONTHS.at(pm - 1)} ${py}`,
  }
}

/** Libellé « octobre 2026 » à partir d'une période YYYY-MM-01. */
export function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number)
  return `${MONTHS.at(m - 1)} ${y}`
}

/**
 * Quelle action pour une demande en attente ?
 * Un seul message par jour : on envoie uniquement le palier le plus avancé
 * atteint et pas encore envoyé (rattrape les week-ends sans rafale).
 */
export function nextAction(params: {
  today: string
  dueDate: string
  currentStage: number
  escalatedAt: string | null
  settings: Pick<ReminderSettings, 'before_days' | 'overdue_days' | 'escalate_days'>
}): ReminderAction {
  const { today, dueDate, currentStage, escalatedAt, settings } = params
  const diff = daysBetween(today, dueDate) // < 0 : avant l'échéance

  if (diff >= settings.escalate_days) {
    return escalatedAt ? { kind: 'none' } : { kind: 'escalate' }
  }

  let target: 1 | 2 | 3 | 4 = 1
  if (diff >= -settings.before_days) target = 2
  if (diff >= 0) target = 3
  if (diff >= settings.overdue_days) target = 4
  // Jour J manqué (tombé un week-end) : « c'est aujourd'hui » serait faux → message de retard
  if (target === 3 && diff > 0) target = currentStage < 3 ? 4 : 3

  return target > currentStage ? { kind: 'client', stage: target } : { kind: 'none' }
}
