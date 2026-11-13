'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setDocumentCategory } from '@/app/actions/documents'
import { CATEGORY_LABEL, FOLDERS } from '@/lib/document-folders'

/** Sélecteur « Ranger dans… » : change la catégorie (donc le dossier) d'un document. */
export default function MoveDocumentSelect({
  documentId,
  category,
}: {
  documentId: string
  category: string | null
}) {
  const router = useRouter()
  const [value, setValue] = useState(category || 'autre')
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }} className="muted">
      Ranger dans
      <select
        className="search"
        style={{ fontSize: 12, padding: '4px 8px' }}
        value={value}
        disabled={pending}
        data-testid={`move-${documentId}`}
        onChange={(e) => {
          const next = e.target.value
          const previous = value
          setValue(next)
          setError('')
          startTransition(async () => {
            const r = await setDocumentCategory(documentId, next)
            if (!r.success) {
              setValue(previous)
              setError(r.error || 'Erreur')
            } else {
              router.refresh()
            }
          })
        }}
      >
        {FOLDERS.map((f) =>
          f.categories.length === 1 ? (
            <option key={f.key} value={f.categories[0]}>
              {f.label}
            </option>
          ) : (
            <optgroup key={f.key} label={f.label}>
              {f.categories.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </optgroup>
          )
        )}
      </select>
      {pending && <span>…</span>}
      {error && <span className="auth-error">{error}</span>}
    </label>
  )
}
