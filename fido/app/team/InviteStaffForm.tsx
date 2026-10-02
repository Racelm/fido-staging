'use client'

import { useActionState } from 'react'
import { inviteStaff } from '@/app/actions/staff'

type State = { error: string; success: boolean; inviteUrl?: string; emailSent?: boolean }
const initialState: State = { error: '', success: false }

export default function InviteStaffForm() {
  const [state, action, pending] = useActionState(
    async (_prev: State, formData: FormData) => {
      const r = await inviteStaff(formData)
      if (r.success) {
        return {
          error: '',
          success: true,
          inviteUrl: r.inviteUrl,
          emailSent: r.emailSent,
        }
      }
      return { error: r.error || 'Erreur inconnue', success: false }
    },
    initialState
  )

  return (
    <form action={action} className="auth-form" data-testid="staff-invite-form">
      <input
        className="auth-input"
        name="full_name"
        placeholder="Nom du collaborateur (optionnel)"
        data-testid="staff-fullname"
      />
      <input
        className="auth-input"
        name="email"
        type="email"
        placeholder="E-mail professionnel *"
        required
        data-testid="staff-email"
      />
      {state.error && (
        <p className="auth-error" data-testid="staff-invite-error">
          {state.error}
        </p>
      )}
      {state.success && (
        <div className="auth-notice" data-testid="staff-invite-success">
          Invitation créée.{' '}
          {state.emailSent
            ? 'L’e-mail d’activation a été envoyé.'
            : 'Partagez ce lien avec le collaborateur :'}
          {state.inviteUrl && (
            <>
              <br />
              <code
                style={{
                  display: 'block',
                  marginTop: 6,
                  padding: 8,
                  background: '#fff',
                  borderRadius: 8,
                  wordBreak: 'break-all',
                  fontSize: 12,
                }}
              >
                {state.inviteUrl}
              </code>
            </>
          )}
        </div>
      )}
      <button
        className="auth-submit"
        disabled={pending}
        data-testid="staff-invite-submit"
      >
        {pending ? 'Envoi...' : 'Envoyer l’invitation'}
      </button>
    </form>
  )
}
