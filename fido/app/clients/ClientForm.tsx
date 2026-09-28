'use client'

import { useActionState } from 'react'
import { createClientRecord } from '@/app/actions/clients'

const initialState = { error: '', success: false }

export default function ClientForm() {
  const [state, action, pending] = useActionState(async (_state: typeof initialState, formData: FormData) => {
    const result = await createClientRecord(formData)
    return result.success ? { error: '', success: true } : { error: result.error || 'Une erreur est survenue.', success: false }
  }, initialState)

  return (
    <form action={action} className="client-form">
      <input className="search auth-input" name="company_name" placeholder="Nom de l’entreprise *" required />
      <input className="search auth-input" name="contact_name" placeholder="Nom du contact" />
      <input className="search auth-input" name="email" type="email" placeholder="E-mail" />
      <input className="search auth-input" name="phone" placeholder="Téléphone" />
      {state.error && <p className="auth-error">{state.error}</p>}
      {state.success && <p className="auth-notice">Client ajouté avec succès.</p>}
      <button className="primary auth-submit" disabled={pending}>
        {pending ? 'Ajout en cours...' : 'Ajouter le client'}
      </button>
    </form>
  )
}
