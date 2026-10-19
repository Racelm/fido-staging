'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { exportReleve } from '@/app/actions/tva'

export default function ExportPanel({
  clientId,
  annee,
  periode,
  label,
  exportable,
  alreadyExported,
  blocking,
}: {
  clientId: string
  annee: number
  periode: number
  label: string
  exportable: boolean
  alreadyExported: boolean
  blocking: string[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ fileName: string; sha256: string; lines: number } | null>(null)

  function onExport() {
    setError(null)
    start(async () => {
      const res = await exportReleve(clientId, annee, periode)
      if (!res.ok) {
        setError(res.error + (res.anomalies?.length ? ` (${res.anomalies.length} point(s))` : ''))
        return
      }
      setDone({ fileName: res.fileName, sha256: res.sha256, lines: res.lines })
      window.location.href = res.url
      router.refresh()
    })
  }

  return (
    <div>
      <div className="section-head">
        <div>
          <h2 className="section-title">Fichier EDI pour SIMPL-TVA — {label}</h2>
          <p className="section-sub">
            Le fichier n’est généré que si toutes les lignes de la période sont validées par le cabinet, sans erreur ni alerte non acceptée.
          </p>
        </div>
      </div>

      {alreadyExported ? (
        <p className="section-sub">Cette période a déjà été exportée. Téléchargez le fichier dans l’historique ci-dessous, ou faites annuler l’export par le propriétaire du cabinet pour corriger.</p>
      ) : (
        <>
          {blocking.length > 0 && (
            <>
              <strong style={{ fontSize: 13 }}>Export bloqué — {blocking.length} point(s) à traiter :</strong>
              <ul className="tva-blocking">
                {blocking.slice(0, 15).map((b, i) => <li key={i}>{b}</li>)}
                {blocking.length > 15 && <li>… et {blocking.length - 15} autre(s)</li>}
              </ul>
            </>
          )}

          {exportable && !done && (
            <label style={{ display: 'flex', gap: 8, fontSize: 13, margin: '8px 0 12px', alignItems: 'flex-start' }}>
              <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} data-testid="tva-export-confirm" />
              <span>
                Je confirme avoir vérifié chaque ligne sur les pièces justificatives. Le cabinet reste responsable de la déclaration déposée.
              </span>
            </label>
          )}

          <div className="tva-actions">
            <button
              type="button"
              className="btn-primary"
              disabled={pending || !exportable || !confirm || !!done}
              onClick={onExport}
              data-testid="tva-export"
            >
              {pending ? 'Génération…' : 'Générer le fichier .zip'}
            </button>
          </div>
        </>
      )}

      {error && <p style={{ color: 'var(--red-600)', fontSize: 13 }}>{error}</p>}
      {done && (
        <p style={{ color: 'var(--emerald-600)', fontSize: 13 }}>
          {done.fileName} généré ({done.lines} ligne(s)). Empreinte SHA-256 : <code>{done.sha256.slice(0, 16)}…</code>
        </p>
      )}

      <strong style={{ fontSize: 13, display: 'block', marginTop: 12 }}>Dépôt sur SIMPL-TVA (profil « Rédacteur »)</strong>
      <ol className="tva-steps">
        <li>Créez la déclaration de la période et enregistrez-la en brouillon (sinon le fichier est rejeté).</li>
        <li>Menu « Envoi EDI » : envoyez le fichier .zip tel quel, sans le décompresser.</li>
        <li>« Suivi envoi EDI » : attendez l’état « Traité » (un brouillon existant est remplacé par le relevé).</li>
        <li>Complétez le reste de la déclaration, puis validez, signez et déposez.</li>
      </ol>
    </div>
  )
}
