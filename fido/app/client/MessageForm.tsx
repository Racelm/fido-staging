'use client'

import { useRef, useState } from 'react'
import { sendMessage } from '@/app/actions/messages'

export default function MessageForm({ clientId }: { clientId: string }) {
  const formRef = useRef<HTMLFormElement>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(formData: FormData) {
    setError('')
    setLoading(true)
    const result = await sendMessage(formData)
    if (result?.error) setError(result.error)
    else formRef.current?.reset()
    setLoading(false)
  }

  return <form ref={formRef} action={submit} className="composer">
    <input type="hidden" name="client_id" value={clientId} />
    <textarea className="search textarea" name="body" placeholder="Écrivez un message..." rows={3} maxLength={4000} required />
    {error && <p className="auth-error">{error}</p>}
    <div className="composer-footer"><span className="muted">Message sécurisé · 4 000 caractères max.</span><button className="primary" disabled={loading}>{loading ? 'Envoi...' : 'Envoyer'}</button></div>
  </form>
}
