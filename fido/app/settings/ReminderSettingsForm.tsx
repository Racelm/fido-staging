'use client'

import { useActionState } from 'react'
import { saveReminderSettings } from '@/app/actions/reminders'

export type ReminderSettingsValues = {
  enabled: boolean
  due_day: number
  before_days: number
  overdue_days: number
  escalate_days: number
}

type State = { error: string; success: boolean }

const label: React.CSSProperties = { fontSize: 12, display: 'grid', gap: 4 }

export default function ReminderSettingsForm({ initial }: { initial: ReminderSettingsValues }) {
  const [state, action, pending] = useActionState(
    async (_prev: State, formData: FormData): Promise<State> => {
      const r = await saveReminderSettings(formData)
      return r.success ? { error: '', success: true } : { error: r.error || 'Erreur', success: false }
    },
    { error: '', success: false }
  )

  return (
    <form action={action} className="auth-form" data-testid="reminder-settings-form">
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}>
        <input type="checkbox" name="enabled" defaultChecked={initial.enabled} data-testid="reminders-enabled" />
        Relancer automatiquement mes clients pour leurs documents mensuels
      </label>

      <label className="muted" style={label}>
        Date limite de dépôt (jour du mois suivant)
        <input className="auth-input" type="number" name="due_day" min={1} max={28} defaultValue={initial.due_day} />
      </label>
      <label className="muted" style={label}>
        Rappel … jours avant la date limite
        <input className="auth-input" type="number" name="before_days" min={1} max={15} defaultValue={initial.before_days} />
      </label>
      <label className="muted" style={label}>
        Relance de retard … jours après la date limite
        <input className="auth-input" type="number" name="overdue_days" min={1} max={15} defaultValue={initial.overdue_days} />
      </label>
      <label className="muted" style={label}>
        M’alerter (« à appeler ») … jours après la date limite
        <input className="auth-input" type="number" name="escalate_days" min={2} max={30} defaultValue={initial.escalate_days} />
      </label>

      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        Les rappels s’affichent dans l’espace Tiwizi de vos clients, au nom de votre cabinet : au plus un
        par client et par jour, jamais le week-end. Aucun e-mail n’est envoyé. Ils s’arrêtent dès que le
        client dépose un document.
      </p>

      {state.error && <p className="auth-error">{state.error}</p>}
      {state.success && <div className="auth-notice">Réglages enregistrés.</div>}
      <button className="auth-submit" disabled={pending} data-testid="reminder-settings-submit">
        {pending ? 'Enregistrement...' : 'Enregistrer'}
      </button>
    </form>
  )
}
