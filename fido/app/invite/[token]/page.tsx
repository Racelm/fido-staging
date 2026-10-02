'use client'

import { FormEvent, use, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { acceptInvitation } from '@/app/actions/invite'

export default function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = use(params)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    })
    if (signUpError) {
      setError(signUpError.message)
      setLoading(false)
      return
    }
    if (!data.session) {
      setError(
        'Vérifiez votre e-mail puis reconnectez-vous pour terminer l’activation de votre espace.'
      )
      setLoading(false)
      return
    }

    const result = await acceptInvitation(token, name)
    if (result.error) {
      setError(result.error)
      setLoading(false)
      return
    }

    setDone(true)
    setTimeout(() => {
      window.location.href = '/client'
    }, 900)
    setLoading(false)
  }

  return (
    <main className="auth-page">
      <section className="auth-card" data-testid="invite-card">
        <div className="auth-brand">
          <span className="logo">F</span>Fido
        </div>
        <p className="eyebrow">Invitation client</p>
        <h1>Rejoindre votre espace</h1>
        {done ? (
          <p className="auth-notice" data-testid="invite-success">
            Votre compte est prêt. Redirection...
          </p>
        ) : (
          <>
            <p className="auth-copy">
              Créez votre accès sécurisé à l’espace de collaboration Fido.
            </p>
            <form onSubmit={submit} className="auth-form" data-testid="invite-form">
              <input
                className="search auth-input"
                placeholder="Votre nom"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                data-testid="invite-name"
              />
              <input
                className="search auth-input"
                type="email"
                placeholder="E-mail utilisé pour l’invitation"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                data-testid="invite-email"
              />
              <input
                className="search auth-input"
                type="password"
                minLength={8}
                placeholder="Mot de passe (8 caractères min.)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                data-testid="invite-password"
              />
              {error && (
                <p className="auth-error" data-testid="invite-error">
                  {error}
                </p>
              )}
              <button
                className="primary auth-submit"
                disabled={loading}
                data-testid="invite-submit"
              >
                {loading ? 'Création...' : 'Créer mon espace'}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  )
}
