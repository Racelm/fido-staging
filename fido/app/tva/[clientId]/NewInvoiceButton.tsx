'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createManualInvoice } from '@/app/actions/tva'

/** Crée une ligne vide à saisir à la main et l'ouvre dans le formulaire de vérification */
export default function NewInvoiceButton({ clientId, basePath }: { clientId: string; basePath: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      {error && <span style={{ color: 'var(--red-600)', fontSize: 12 }}>{error}</span>}
      <button
        type="button"
        className="btn-primary"
        disabled={pending}
        data-testid="tva-new-invoice"
        onClick={() =>
          start(async () => {
            const res = await createManualInvoice(clientId)
            if (!res.ok) return setError(res.error)
            router.push(`${basePath}&ligne=${res.id}#verification`)
          })
        }
      >
        {pending ? '…' : '+ Nouvelle facture'}
      </button>
    </span>
  )
}
