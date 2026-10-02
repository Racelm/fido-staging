'use client'

import { useState } from 'react'
import { revokeStaffInvitation } from '@/app/actions/staff'

export default function RevokeButton({ invitationId }: { invitationId: string }) {
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function onClick() {
    if (loading) return
    setLoading(true)
    const r = await revokeStaffInvitation(invitationId)
    setLoading(false)
    if (!r.error) setDone(true)
  }

  if (done) return <span className="muted">Révoquée</span>

  return (
    <button
      type="button"
      className="btn-secondary"
      onClick={onClick}
      disabled={loading}
      data-testid={`revoke-${invitationId}`}
    >
      {loading ? '...' : 'Révoquer'}
    </button>
  )
}
