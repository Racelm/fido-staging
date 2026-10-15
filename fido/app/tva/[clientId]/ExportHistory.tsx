'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cancelExport, getExportDownloadUrl } from '@/app/actions/tva'

type Export = {
  id: string
  annee: number
  periode: number
  line_count: number
  total_tva_deductible: number | string
  xml_sha256: string
  exported_at: string
  cancelled_at: string | null
  cancel_reason: string | null
}

export default function ExportHistory({ exports, isOwner }: { exports: Export[]; isOwner: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function download(id: string) {
    setError(null)
    start(async () => {
      const res = await getExportDownloadUrl(id)
      if (!res.ok) return setError(res.error)
      window.location.href = res.url
    })
  }

  function cancel(id: string) {
    const reason = window.prompt('Motif de l’annulation (obligatoire) :')
    if (!reason?.trim()) return
    setError(null)
    start(async () => {
      const res = await cancelExport(id, reason)
      if (!res.ok) return setError(res.error)
      router.refresh()
    })
  }

  return (
    <div>
      <div className="section-head">
        <div>
          <h2 className="section-title">Historique des exports</h2>
          <p className="section-sub">Chaque fichier est archivé avec son empreinte SHA-256.</p>
        </div>
      </div>
      {error && <p style={{ color: 'var(--red-600)', fontSize: 13 }}>{error}</p>}
      {exports.length ? (
        <table className="audit-table">
          <thead>
            <tr>
              <th>Période</th>
              <th>Lignes</th>
              <th style={{ textAlign: 'right' }}>TVA déductible</th>
              <th>Empreinte</th>
              <th>Date</th>
              <th>Statut</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {exports.map((e) => (
              <tr key={e.id}>
                <td>{e.periode} / {e.annee}</td>
                <td>{e.line_count}</td>
                <td style={{ textAlign: 'right' }}>{Number(e.total_tva_deductible).toLocaleString('fr-FR', { minimumFractionDigits: 2 })}</td>
                <td><code>{e.xml_sha256.slice(0, 12)}…</code></td>
                <td>{new Date(e.exported_at).toLocaleString('fr-FR')}</td>
                <td>
                  {e.cancelled_at ? (
                    <span className="pill pill-gray" title={e.cancel_reason ?? ''}>Annulé</span>
                  ) : (
                    <span className="pill pill-green">Actif</span>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <div className="tva-actions" style={{ justifyContent: 'flex-end' }}>
                    <button type="button" className="btn-secondary" disabled={pending} onClick={() => download(e.id)}>
                      Télécharger
                    </button>
                    {isOwner && !e.cancelled_at && (
                      <button type="button" className="btn-ghost" disabled={pending} onClick={() => cancel(e.id)}>
                        Annuler l’export
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="section-sub">Aucun export pour ce client.</p>
      )}
    </div>
  )
}
