'use client'

import { useActionState } from 'react'
import { createDocumentRequest } from '@/app/actions/requests'

const initialState = { error: '', success: false }

export default function RequestForm({ clientId }: { clientId: string }) {
  const [state, action, pending] = useActionState(async (_state: typeof initialState, formData: FormData) => {
    const result = await createDocumentRequest(formData)
    return result.success ? { error: '', success: true } : { error: result.error || 'Une erreur est survenue.', success: false }
  }, initialState)

  return <form action={action} className="request-form">
    <input type="hidden" name="client_id" value={clientId} />
    <input className="search auth-input" name="title" placeholder="Document demandé *" required />
    <textarea className="search auth-input textarea" name="description" placeholder="Instructions pour le client (optionnel)" rows={3} />
    <input className="search auth-input" name="due_date" type="date" />
    {state.error && <p className="auth-error">{state.error}</p>}
    {state.success && <p className="auth-notice">Demande créée.</p>}
    <button className="primary" disabled={pending}>{pending ? 'Envoi...' : 'Demander ce document'}</button>
  </form>
}
