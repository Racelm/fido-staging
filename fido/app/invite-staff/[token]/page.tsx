'use client'

import { FormEvent, use, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { acceptStaffInvitation } from '@/app/actions/invite-staff'

export default function InviteStaffPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = use(params)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
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
        'Vérifiez votre e-mail puis reconnectez-vous pour terminer l’activation de votre compte.'
      )
      setLoading(false)
      return
    }

    const r = await acceptStaffInvitation(token, name)
    if (r.error) {
      setError(r.error)
      setLoading(false)
      return
    }

    setDone(true)
    setTimeout(() => {
      window.location.href = '/'
    }, 900)
  }

  return (
    <main className="auth-page">
      <section className="auth-card" data-testid="invite-staff-card">
        <div className="auth-brand">
          <span className="logo">F</span>Fido
        </div>
        <p className="eyebrow">Invitation collaborateur</p>
        <h1>Rejoindre le cabinet</h1>
        {done ? (
          <p className="auth-notice" data-testid="invite-staff-success">
            Votre compte est prêt. Redirection vers l’espace du cabinet...
          </p>
        ) : (
          <>
            <p className="auth-copy">
              Créez votre accès pour collaborer sur les dossiers clients du cabinet.
            </p>
            <form onSubmit={submit} className="auth-form" data-testid="invite-staff-form">
              <input
                className="auth-input"
                placeholder="Votre nom complet"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                data-testid="invite-staff-name"
              />
              <input
                className="auth-input"
                type="email"
                placeholder="E-mail (celui de l’invitation)"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                data-testid="invite-staff-email"
              />
              <input
                className="auth-input"
                type="password"
                minLength={8}
                placeholder="Mot de passe (8 car. min.)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                data-testid="invite-staff-password"
              />
              {error && (
                <p className="auth-error" data-testid="invite-staff-error">
                  {error}
                </p>
              )}
              <button
                className="auth-submit"
                disabled={loading}
                data-testid="invite-staff-submit"
              >
                {loading ? 'Activation...' : 'Activer mon compte'}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  )
}
