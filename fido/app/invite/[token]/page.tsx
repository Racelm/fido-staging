'use client'

import { FormEvent, use, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { acceptInvitation } from '@/app/actions/invite'

type Mode = 'checking' | 'needs-password' | 'authed-set-password' | 'done'

export default function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = use(params)
  const [mode, setMode] = useState<Mode>('checking')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Détecte si l'utilisateur arrive déjà authentifié (flow invitation Supabase native)
  useEffect(() => {
    const supabase = createClient()
    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (data.user) {
          setEmail(data.user.email || '')
          setName((data.user.user_metadata?.full_name as string) || '')
          setMode('authed-set-password')
        } else {
          setMode('needs-password')
        }
      })
      .catch(() => setMode('needs-password'))
  }, [])

  async function submitNewAccount(e: FormEvent) {
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

    setMode('done')
    setTimeout(() => (window.location.href = '/client'), 900)
    setLoading(false)
  }

  async function submitAuthed(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    // Si l'utilisateur veut (re)définir un mot de passe
    if (password) {
      const { error: pwdErr } = await supabase.auth.updateUser({ password })
      if (pwdErr) {
        setError(pwdErr.message)
        setLoading(false)
        return
      }
    }

    const result = await acceptInvitation(token, name)
    if (result.error) {
      setError(result.error)
      setLoading(false)
      return
    }
    setMode('done')
    setTimeout(() => (window.location.href = '/client'), 900)
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

        {mode === 'checking' && (
          <p className="auth-copy">Vérification de votre invitation...</p>
        )}

        {mode === 'done' && (
          <p className="auth-notice" data-testid="invite-success">
            Votre compte est prêt. Redirection...
          </p>
        )}

        {mode === 'needs-password' && (
          <>
            <p className="auth-copy">
              Créez votre accès sécurisé à l’espace de collaboration Fido.
            </p>
            <form onSubmit={submitNewAccount} className="auth-form" data-testid="invite-form">
              <input
                className="auth-input"
                placeholder="Votre nom"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                data-testid="invite-name"
              />
              <input
                className="auth-input"
                type="email"
                placeholder="E-mail utilisé pour l’invitation"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                data-testid="invite-email"
              />
              <input
                className="auth-input"
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
                className="auth-submit"
                disabled={loading}
                data-testid="invite-submit"
              >
                {loading ? 'Création...' : 'Créer mon espace'}
              </button>
            </form>
          </>
        )}

        {mode === 'authed-set-password' && (
          <>
            <p className="auth-copy">
              Bienvenue{name ? `, ${name}` : ''} ! Votre e-mail <strong>{email}</strong> est
              vérifié. Choisissez un mot de passe pour accéder à votre espace.
            </p>
            <form onSubmit={submitAuthed} className="auth-form" data-testid="invite-form-authed">
              <input
                className="auth-input"
                placeholder="Votre nom"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                data-testid="invite-name"
              />
              <input
                className="auth-input"
                type="password"
                minLength={8}
                placeholder="Nouveau mot de passe (8 caractères min.)"
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
                className="auth-submit"
                disabled={loading}
                data-testid="invite-submit"
              >
                {loading ? 'Activation...' : 'Activer mon espace'}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  )
}
