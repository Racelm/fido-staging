'use client'

import { useState } from 'react'
import { getDocumentDownloadUrl } from '@/app/actions/documents'

export default function DownloadButton({ documentId }: { documentId: string }) {
  const [loading, setLoading] = useState(false)
  async function download() {
    setLoading(true)
    const result = await getDocumentDownloadUrl(documentId)
    setLoading(false)
    if (result.url) window.open(result.url, '_blank', 'noopener,noreferrer')
    else if (result.error) alert(result.error)
  }
  return <button className="secondary" onClick={download} disabled={loading}>{loading ? '...' : 'Ouvrir'}</button>
}
