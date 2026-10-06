'use client'

import { useState, useTransition } from 'react'
import { reviewDocument, type ReviewAction } from '@/app/actions/documents'

type Status = 'pending_review' | 'approved' | 'rejected'

/**
 * Boutons de revue : Valider / Rejeter / Remettre en attente.
 * Visible UNIQUEMENT côté fiduciaire (owner/staff).
 */
export default function ReviewButtons({
  documentId,
  currentStatus,
  compact = false,
}: {
  documentId: string
  currentStatus: Status
  compact?: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const [showReject, setShowReject] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  function act(next: ReviewAction, withNote?: string) {
    setError(null)
    startTransition(async () => {
      const result = await reviewDocument(documentId, next, withNote ?? null)
      if (result.error) setError(result.error)
      else {
        setShowReject(false)
        setNote('')
      }
    })
  }

  if (showReject) {
    return (
      <div
        style={{ display: 'grid', gap: 6, minWidth: 220 }}
        data-testid={`reject-form-${documentId}`}
      >
        <input
          className="search auth-input"
          style={{ fontSize: 12, padding: '6px 10px' }}
          placeholder="Raison du rejet (optionnel)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={240}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="secondary"
            style={{ fontSize: 12, padding: '4px 10px' }}
            onClick={() => {
              setShowReject(false)
              setNote('')
            }}
            disabled={isPending}
          >
            Annuler
          </button>
          <button
            type="button"
            className="primary"
            style={{ fontSize: 12, padding: '4px 10px', background: '#dc2626' }}
            onClick={() => act('rejected', note)}
            disabled={isPending}
            data-testid={`confirm-reject-${documentId}`}
          >
            {isPending ? '...' : 'Rejeter'}
          </button>
        </div>
        {error && <span style={{ color: '#dc2626', fontSize: 11 }}>{error}</span>}
      </div>
    )
  }

  const btnStyle = compact
    ? { fontSize: 11, padding: '3px 8px' }
    : { fontSize: 12, padding: '4px 10px' }

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {currentStatus !== 'approved' && (
        <button
          type="button"
          className="primary"
          style={{ ...btnStyle, background: '#16a34a' }}
          onClick={() => act('approved')}
          disabled={isPending}
          data-testid={`approve-${documentId}`}
          title="Marquer comme validé"
        >
          {isPending ? '...' : '✓ Valider'}
        </button>
      )}
      {currentStatus !== 'rejected' && (
        <button
          type="button"
          className="secondary"
          style={btnStyle}
          onClick={() => setShowReject(true)}
          disabled={isPending}
          data-testid={`reject-${documentId}`}
          title="Signaler un problème"
        >
          Rejeter
        </button>
      )}
      {currentStatus !== 'pending_review' && (
        <button
          type="button"
          className="btn-ghost"
          style={btnStyle}
          onClick={() => act('pending_review')}
          disabled={isPending}
          data-testid={`reset-${documentId}`}
          title="Remettre en attente"
        >
          ↺
        </button>
      )}
      {error && <span style={{ color: '#dc2626', fontSize: 11 }}>{error}</span>}
    </div>
  )
}
