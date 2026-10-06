type Status = 'pending_review' | 'approved' | 'rejected' | string | null | undefined

/**
 * Badge d'état de revue d'un document.
 * Lisible par fiduciaire ET client.
 */
export default function ReviewBadge({ status, size = 'md' }: { status: Status; size?: 'sm' | 'md' }) {
  const s = (status || 'pending_review') as string
  const map: Record<string, { label: string; cls: string }> = {
    pending_review: { label: 'À vérifier', cls: 'pill-orange' },
    approved: { label: '✓ Validé', cls: 'pill-green' },
    rejected: { label: '⚠︎ À corriger', cls: 'pill-red' },
  }
  const info = map[s] || map.pending_review
  const style = size === 'sm' ? { fontSize: 11, padding: '2px 8px' } : undefined
  return (
    <span className={`pill ${info.cls}`} style={style} data-testid={`review-badge-${s}`}>
      {info.label}
    </span>
  )
}
