'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createInvoiceFromDocument } from '@/app/actions/tva'

export default function CreateFromDocument({ documentId, basePath }: { documentId: string; basePath: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      {error && <span style={{ color: 'var(--red-600)', fontSize: 12 }}>{error}</span>}
      <button
        type="button"
        className="btn-secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await createInvoiceFromDocument(documentId)
            if (!res.ok) return setError(res.error)
            router.push(`${basePath}&ligne=${res.id}#verification`)
          })
        }
      >
        {pending ? '…' : 'Saisir / vérifier'}
      </button>
    </span>
  )
}
