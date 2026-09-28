import Link from 'next/link'
import { redirect } from 'next/navigation'
import SignupForm from './SignupForm'
import { createClient } from '@/lib/supabase/server'

export default async function SignupPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user) redirect('/')

  return (
    <main className="auth-page">
      <section className="auth-card" data-testid="signup-card">
        <div className="brand auth-brand">
          Fido<span>.</span>
        </div>
        <p className="eyebrow">Nouveau cabinet</p>
        <h1>Créer votre cabinet</h1>
        <p className="auth-copy">
          Créez votre espace fiduciaire en quelques secondes. Votre cabinet et votre compte
          propriétaire seront initialisés automatiquement.
        </p>
        <SignupForm />
        <p className="auth-copy" style={{ marginTop: 18 }}>
          Déjà un compte ? <Link href="/login" data-testid="link-login">Se connecter</Link>
        </p>
      </section>
    </main>
  )
}
