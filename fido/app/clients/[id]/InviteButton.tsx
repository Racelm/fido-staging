'use client'

import { useState } from 'react'
import { createClientInvitation } from '@/app/actions/invitations'

export default function InviteButton({
  clientId,
  existingInvitation,
}: {
  clientId: string
  existingInvitation: { expiresAt: string } | null
}) {
  const [loading, setLoading] = useState(false)
  const [inviteUrl, setInviteUrl] = useState('')
  const [emailSent, setEmailSent] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  async function createInvite() {
    setLoading(true)
    setError('')
    setCopied(false)
    const result = await createClientInvitation(clientId)
    if (result.error) {
      setError(result.error)
    } else if (result.inviteUrl) {
      setInviteUrl(result.inviteUrl)
      setEmailSent(Boolean(result.emailSent))
    }
    setLoading(false)
  }

  async function copyLink() {
    if (!inviteUrl) return
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="card card-padded" style={{ display: 'grid', gap: 10 }}>
      <div>
        <strong>Accès client</strong>
        <p className="muted" style={{ margin: '4px 0 0' }}>
          Génère un lien d’invitation sécurisé (valable 7 jours).
        </p>
      </div>
      <button
        className="btn-primary"
        onClick={createInvite}
        disabled={loading}
        data-testid="invite-create"
      >
        {loading
          ? 'Création...'
          : existingInvitation
            ? 'Régénérer une invitation'
            : 'Créer une invitation'}
      </button>

      {inviteUrl && (
        <div style={{ display: 'grid', gap: 8 }} data-testid="invite-result">
          <span
            className={emailSent ? 'auth-notice' : 'auth-notice'}
            style={emailSent ? undefined : { background: '#fff7ed', color: '#9a3412' }}
          >
            {emailSent
              ? '✉️ Un e-mail d’invitation a été envoyé au client.'
              : '⚠️ L’envoi d’e-mail n’est pas configuré. Partagez ce lien avec votre client :'}
          </span>
          <input
            className="search auth-input"
            readOnly
            value={inviteUrl}
            onFocus={(e) => e.currentTarget.select()}
            data-testid="invite-url"
            style={{ fontSize: 12 }}
          />
          <button
            type="button"
            className="btn-secondary"
            onClick={copyLink}
            data-testid="invite-copy"
          >
            {copied ? '✓ Lien copié dans le presse-papier' : 'Copier le lien'}
          </button>
        </div>
      )}

      {existingInvitation && !inviteUrl && (
        <p className="auth-notice">
          Une invitation est déjà en attente jusqu’au{' '}
          {new Date(existingInvitation.expiresAt).toLocaleDateString('fr-FR')}. Vous pouvez la
          régénérer pour obtenir un nouveau lien.
        </p>
      )}

      {error && (
        <p className="auth-error" data-testid="invite-error">
          {error}
        </p>
      )}
    </div>
  )
}
