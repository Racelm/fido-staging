'use client'

import { useActionState } from 'react'
import { signIn } from '@/app/actions/auth'

type State = { error: string }
const initialState: State = { error: '' }

export default function LoginForm({ redirect }: { redirect: string }) {
  const [state, action, pending] = useActionState(async (_prev: State, formData: FormData) => {
    const result = await signIn(formData)
    return { error: result?.error || '' }
  }, initialState)

  return (
    <form action={action} className="auth-form" data-testid="login-form">
      <input type="hidden" name="redirect" value={redirect} />
      <input
        className="search auth-input"
        name="email"
        type="email"
        placeholder="E-mail professionnel"
        autoComplete="email"
        required
        data-testid="login-email"
      />
      <input
        className="search auth-input"
        name="password"
        type="password"
        placeholder="Mot de passe"
        autoComplete="current-password"
        minLength={8}
        required
        data-testid="login-password"
      />
      {state.error && (
        <p className="auth-error" data-testid="login-error">
          {state.error}
        </p>
      )}
      <button className="primary auth-submit" disabled={pending} data-testid="login-submit">
        {pending ? 'Connexion...' : 'Se connecter'}
      </button>
    </form>
  )
}
