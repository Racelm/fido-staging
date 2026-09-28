'use client'

import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { notifyStaffOfDocument, validateUploadServerSide } from '@/app/actions/documents'

type Props = {
  clientId: string
  organizationId: string
  requestId?: string
  defaultCategory?: DocumentCategory
}

type DocumentCategory =
  | 'piece_comptable'
  | 'facture_achat'
  | 'facture_vente'
  | 'releve_bancaire'
  | 'contrat'
  | 'statuts'
  | 'proces_verbal'
  | 'cin'
  | 'registre_commerce'
  | 'ice_if'
  | 'cnss'
  | 'tva'
  | 'is_ir'
  | 'autre'

const CATEGORY_LABEL: Record<DocumentCategory, string> = {
  piece_comptable: 'Pièce comptable',
  facture_achat: 'Facture d’achat',
  facture_vente: 'Facture de vente',
  releve_bancaire: 'Relevé bancaire',
  contrat: 'Contrat',
  statuts: 'Statuts',
  proces_verbal: 'PV / Procès-verbal',
  cin: 'CIN',
  registre_commerce: 'Registre de commerce',
  ice_if: 'ICE / IF',
  cnss: 'CNSS',
  tva: 'Déclaration TVA',
  is_ir: 'IS / IR',
  autre: 'Autre',
}

const ACCEPT =
  '.pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx,.csv,.txt,.pptx'
const MAX_SIZE = 25 * 1024 * 1024

export default function ClientUpload({
  clientId,
  organizationId,
  requestId,
  defaultCategory = 'autre',
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<Array<{ text: string; ok: boolean }>>([])
  const [category, setCategory] = useState<DocumentCategory>(defaultCategory)
  const [dragOver, setDragOver] = useState(false)

  async function uploadOne(file: File): Promise<{ text: string; ok: boolean }> {
    const validation = await validateUploadServerSide(file.name, file.size, file.type || null)
    if (!validation.ok) return { text: `${file.name} — ${validation.error}`, ok: false }
    if (file.size > MAX_SIZE) return { text: `${file.name} — trop volumineux`, ok: false }

    const supabase = createClient()
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `${organizationId}/${clientId}/${crypto.randomUUID()}-${safeName}`

    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(path, file, {
        upsert: false,
        contentType: file.type || 'application/octet-stream',
      })
    if (uploadError) return { text: `${file.name} — ${uploadError.message}`, ok: false }

    const { data: userData } = await supabase.auth.getUser()
    const { data: inserted, error: rowError } = await supabase
      .from('documents')
      .insert({
        organization_id: organizationId,
        client_id: clientId,
        request_id: requestId || null,
        name: file.name,
        storage_path: path,
        mime_type: file.type || null,
        size_bytes: file.size,
        uploaded_by: userData.user?.id,
        category,
      })
      .select('id')
      .single()

    if (rowError) {
      await supabase.storage.from('documents').remove([path])
      return { text: `${file.name} — ${rowError.message}`, ok: false }
    }

    // Best-effort staff notification (email)
    if (inserted?.id) {
      notifyStaffOfDocument(inserted.id).catch(() => {})
    }
    return { text: `${file.name} — envoyé ✓`, ok: true }
  }

  async function handleFiles(files: FileList | File[]) {
    setLoading(true)
    setMessages([])
    const results: Array<{ text: string; ok: boolean }> = []
    for (const file of Array.from(files)) {
      const r = await uploadOne(file)
      results.push(r)
    }
    setMessages(results)
    setLoading(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files)
  }

  return (
    <div className="upload-box" data-testid="client-upload">
      <label className="upload-label">
        <span className="muted">Catégorie</span>
        <select
          className="search"
          value={category}
          onChange={(e) => setCategory(e.target.value as DocumentCategory)}
          data-testid="upload-category"
        >
          {(Object.keys(CATEGORY_LABEL) as DocumentCategory[]).map((k) => (
            <option key={k} value={k}>
              {CATEGORY_LABEL[k]}
            </option>
          ))}
        </select>
      </label>

      <div
        className={`upload-dropzone ${dragOver ? 'dragover' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        data-testid="upload-dropzone"
      >
        <strong>Déposez vos fichiers ici</strong>
        <span className="muted">ou cliquez pour parcourir · 25 Mo max par fichier</span>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
          data-testid="upload-input"
        />
      </div>

      <button
        className="primary"
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        data-testid="upload-submit"
      >
        {loading ? 'Envoi...' : 'Choisir des fichiers'}
      </button>

      {messages.length > 0 && (
        <ul className="upload-results" data-testid="upload-results">
          {messages.map((m, i) => (
            <li key={i} className={m.ok ? 'auth-notice' : 'auth-error'}>
              {m.text}
            </li>
          ))}
        </ul>
      )}
      <span className="muted">
        PDF, images, Word, Excel, CSV · 25 Mo max · bulk drag &amp; drop supporté
      </span>
    </div>
  )
}
