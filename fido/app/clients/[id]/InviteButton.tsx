'use client'

import { useState } from 'react'
import { createClientInvitation } from '@/app/actions/invitations'

export default function InviteButton({ clientId, existingInvitation }: { clientId: string; existingInvitation: { expiresAt: string } | null }) {
  const [loading, setLoading] = useState(false)
  const [inviteUrl, setInviteUrl] = useState('')
  const [error, setError] = useState('')

  async function createInvite() {
    setLoading(true); setError('')
    const result = await createClientInvitation(clientId)
    if (result.error) setError(result.error)
    else if (result.token) setInviteUrl(`${window.location.origin}/invite/${result.token}`)
    setLoading(false)
  }

  return <div className="invite-box">
    <div><strong>Accès client</strong><p className="muted">Créez un lien d’invitation sécurisé valable 7 jours.</p></div>
    <button className="primary" onClick={createInvite} disabled={loading}>{loading ? 'Création...' : 'Créer une invitation'}</button>
    {inviteUrl && <div className="invite-result"><input className="search" value={inviteUrl} readOnly onFocus={e => e.currentTarget.select()} /><button className="secondary" onClick={() => navigator.clipboard.writeText(inviteUrl)}>Copier le lien</button><small>Envoyez ce lien au client par e-mail. L’envoi automatique sera ajouté ensuite.</small></div>}
    {existingInvitation && !inviteUrl && <p className="auth-notice">Une invitation est déjà en attente jusqu’au {new Date(existingInvitation.expiresAt).toLocaleDateString('fr-FR')}.</p>}
    {error && <p className="auth-error">{error}</p>}
  </div>
}
