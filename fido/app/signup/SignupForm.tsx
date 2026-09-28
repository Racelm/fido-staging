'use client'

import { useActionState } from 'react'
import { signUpCabinet } from '@/app/actions/auth'

type State = { error: string; success: boolean }
const initialState: State = { error: '', success: false }

export default function SignupForm() {
  const [state, action, pending] = useActionState(async (_prev: State, formData: FormData) => {
    const result = await signUpCabinet(formData)
    if (result?.success) return { error: '', success: true }
    return { error: result?.error || 'Une erreur est survenue.', success: false }
  }, initialState)

  return (
    <form action={action} className="auth-form" data-testid="signup-form">
      <input
        className="search auth-input"
        name="cabinet_name"
        placeholder="Nom du cabinet *"
        required
        data-testid="signup-cabinet"
      />
      <input
        className="search auth-input"
        name="full_name"
        placeholder="Votre nom complet"
        data-testid="signup-fullname"
      />
      <input
        className="search auth-input"
        name="email"
        type="email"
        placeholder="E-mail professionnel *"
        autoComplete="email"
        required
        data-testid="signup-email"
      />
      <input
        className="search auth-input"
        name="password"
        type="password"
        placeholder="Mot de passe (min. 8 caractères) *"
        autoComplete="new-password"
        minLength={8}
        required
        data-testid="signup-password"
      />
      {state.error && (
        <p className="auth-error" data-testid="signup-error">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="auth-notice" data-testid="signup-success">
          Cabinet créé. Vérifiez votre e-mail si la confirmation est activée, puis connectez-vous.
        </p>
      )}
      <button className="primary auth-submit" disabled={pending} data-testid="signup-submit">
        {pending ? 'Création...' : 'Créer mon cabinet'}
      </button>
    </form>
  )
}
