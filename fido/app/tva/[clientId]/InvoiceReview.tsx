'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { confirmField, rejectInvoice, reopenInvoice, saveInvoice, validateInvoice } from '@/app/actions/tva'
import type { ChampLigne } from '@/lib/tva/releve-deductions'
import {
  ANOMALY_FIELD,
  codeAvertissement,
  FIELD_COLUMN,
  FIELD_LABEL,
  FIELD_ORDER,
  isChampLigne,
  MODE_PAIEMENT_LABEL,
  SEUIL_CONFIANCE_UI,
  TAUX_TVA,
} from '@/lib/tva/fields'
import type { InvoiceRow } from '@/lib/tva/server'

export type ReviewAnomaly = { niveau: 'erreur' | 'avertissement'; champ: string; message: string; code: string }

type Supplier = { id: string; name: string; if_number: string; ice: string }

function initialValues(inv: InvoiceRow): Record<ChampLigne, string> {
  const out = {} as Record<ChampLigne, string>
  for (const f of FIELD_ORDER) {
    const v = (inv as unknown as Record<string, unknown>)[FIELD_COLUMN[f]]
    out[f] = v === null || v === undefined ? '' : NUMERIC.has(f) ? String(Number(v)) : String(v)
  }
  return out
}

const NUMERIC = new Set<ChampLigne>(['montantHT', 'montantTVA', 'montantTTC', 'tauxTVA', 'modePaiement'])

function sameValue(f: ChampLigne, a: string, b: string) {
  if (NUMERIC.has(f)) {
    const na = Number(a.replace(/\s/g, '').replace(',', '.'))
    const nb = Number(b.replace(/\s/g, '').replace(',', '.'))
    if (a.trim() !== '' && b.trim() !== '' && Number.isFinite(na) && Number.isFinite(nb)) return na === nb
  }
  return a.trim() === b.trim()
}

function fieldOf(champ: string): ChampLigne | undefined {
  return ANOMALY_FIELD[champ] ?? (isChampLigne(champ) ? champ : undefined)
}

export default function InvoiceReview({
  invoice,
  anomalies,
  pdfUrl,
  suppliers,
  validAndUnchanged,
  closeHref,
}: {
  invoice: InvoiceRow
  anomalies: ReviewAnomaly[]
  pdfUrl: string | null
  suppliers: Supplier[]
  validAndUnchanged: boolean
  closeHref: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const initial = useMemo(() => initialValues(invoice), [invoice])
  const [values, setValues] = useState(initial)
  const [prorata, setProrata] = useState(String(Number(invoice.prorata)))
  const [accepted, setAccepted] = useState<Set<string>>(new Set(invoice.accepted_warnings ?? []))
  const [serverIssues, setServerIssues] = useState<ReviewAnomaly[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')

  const locked = !!invoice.export_id
  const changed = FIELD_ORDER.filter((f) => !sameValue(f, values[f], initial[f]))
  const prorataChanged = Number(prorata.replace(',', '.')) !== Number(invoice.prorata)
  const dirty = changed.length > 0 || prorataChanged

  const confidence = invoice.extraction_confidence ?? {}
  const confirmed = new Set(invoice.confirmed_fields ?? [])
  const isLow = (f: ChampLigne) =>
    typeof confidence[f] === 'number' && confidence[f] < SEUIL_CONFIANCE_UI && !confirmed.has(f) && !changed.includes(f)

  const issues = serverIssues ?? anomalies
  const errorsFor = (f: ChampLigne) => issues.filter((a) => a.niveau === 'erreur' && fieldOf(a.champ) === f)
  const warnings = issues.filter((a) => a.niveau === 'avertissement')
  const generalErrors = issues.filter((a) => a.niveau === 'erreur' && !fieldOf(a.champ))
  const lowCount = FIELD_ORDER.filter(isLow).length
  const errorCount = issues.filter((a) => a.niveau === 'erreur').length
  const unacceptedWarnings = warnings.filter((w) => !accepted.has(w.code)).length

  const canValidate = !locked && !dirty && errorCount === 0 && lowCount === 0 && unacceptedWarnings === 0 && !!invoice.payment_date

  function set(f: ChampLigne, v: string) {
    setValues((prev) => ({ ...prev, [f]: v }))
    setServerIssues(null)
  }

  function run(fn: () => Promise<{ ok: boolean; error?: string; anomalies?: { niveau: 'erreur' | 'avertissement'; champ: string; message: string }[] }>, okMsg: string) {
    setError(null)
    setInfo(null)
    start(async () => {
      const res = await fn()
      if (!res.ok) {
        setError(res.error ?? 'Erreur.')
        if (res.anomalies) setServerIssues(res.anomalies.map((a) => ({ ...a, code: codeAvertissement(a) })))
        return
      }
      setServerIssues(null)
      setInfo(okMsg)
      router.refresh()
    })
  }

  function save() {
    const payload: Partial<Record<ChampLigne, string>> = {}
    for (const f of changed) payload[f] = values[f]
    run(() => saveInvoice(invoice.id, payload, prorataChanged ? prorata : undefined), 'Modifications enregistrées.')
  }

  function computeTva() {
    const ht = Number(values.montantHT.replace(/\s/g, '').replace(',', '.'))
    const tx = Number(values.tauxTVA)
    if (!Number.isFinite(ht) || !Number.isFinite(tx) || !values.montantHT || !values.tauxTVA) return
    const tva = Math.round(ht * tx) / 100
    setValues((prev) => ({ ...prev, montantTVA: tva.toFixed(2), montantTTC: (Math.round((ht + tva) * 100) / 100).toFixed(2) }))
  }

  function pickSupplier(id: string) {
    const sup = suppliers.find((s) => s.id === id)
    if (!sup) return
    setValues((prev) => ({
      ...prev,
      'fournisseur.nom': sup.name,
      'fournisseur.identifiantFiscal': sup.if_number,
      'fournisseur.ice': sup.ice,
    }))
  }

  const statusLine =
    invoice.status === 'valide' && validAndUnchanged
      ? `Validée le ${new Date(invoice.validated_at!).toLocaleString('fr-FR')}`
      : invoice.status === 'rejete'
        ? `Rejetée : ${invoice.rejection_note ?? ''}`
        : 'À vérifier'

  return (
    <div>
      <div className="section-head">
        <div>
          <h2 className="section-title">Vérification — {invoice.supplier_name || 'nouvelle facture'} {invoice.invoice_number ? `· ${invoice.invoice_number}` : ''}</h2>
          <p className="section-sub">
            {statusLine}
            {locked && ' · Exportée vers SIMPL-TVA (verrouillée)'}
          </p>
        </div>
        <Link href={closeHref} className="btn-ghost">Fermer</Link>
      </div>

      <div className="tva-review">
        <div>
          {pdfUrl ? (
            <iframe className="tva-pdf" src={pdfUrl} title="Facture PDF" />
          ) : (
            <div className="empty-state tva-pdf" style={{ display: 'grid', placeContent: 'center' }}>
              <strong>Pas de PDF lié</strong>
              <span>Ligne saisie manuellement.</span>
            </div>
          )}
        </div>

        <div className="tva-form">
          {suppliers.length > 0 && !locked && (
            <div className="tva-field">
              <label htmlFor="sup-pick">Fournisseur connu (référentiel vérifié)</label>
              <select id="sup-pick" defaultValue="" onChange={(e) => pickSupplier(e.target.value)}>
                <option value="">— Choisir pour remplir IF / ICE —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} · ICE {s.ice}</option>
                ))}
              </select>
            </div>
          )}

          {FIELD_ORDER.map((f) => {
            const errs = errorsFor(f).filter((a) => !a.message.startsWith('Lu sur le PDF'))
            const low = isLow(f)
            const cls = `tva-field${errs.length ? ' is-error' : low ? ' is-low' : ''}`
            const id = `f-${f}`
            return (
              <div key={f} className={cls} data-testid={`tva-field-${f}`}>
                <label htmlFor={id}>
                  <span>{FIELD_LABEL[f]}</span>
                  {low && !locked && (
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{ fontSize: 11, padding: '2px 8px' }}
                      disabled={pending}
                      onClick={() => run(() => confirmField(invoice.id, f), `${FIELD_LABEL[f]} confirmé.`)}
                    >
                      ✓ Conforme au PDF
                    </button>
                  )}
                </label>
                {f === 'modePaiement' ? (
                  <select id={id} value={values[f]} disabled={locked} onChange={(e) => set(f, e.target.value)}>
                    <option value="">—</option>
                    {Object.entries(MODE_PAIEMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                ) : f === 'tauxTVA' ? (
                  <select id={id} value={values[f] ? String(Number(values[f])) : ''} disabled={locked} onChange={(e) => set(f, e.target.value)}>
                    <option value="">—</option>
                    {TAUX_TVA.map((t) => <option key={t} value={t}>{t} %</option>)}
                  </select>
                ) : f === 'dateFacture' || f === 'datePaiement' ? (
                  <input id={id} type="date" value={values[f]} disabled={locked} onChange={(e) => set(f, e.target.value)} />
                ) : (
                  <input
                    id={id}
                    value={values[f]}
                    disabled={locked}
                    inputMode={f.startsWith('montant') || f === 'fournisseur.ice' || f === 'fournisseur.identifiantFiscal' ? 'decimal' : undefined}
                    onChange={(e) => set(f, e.target.value)}
                  />
                )}
                {low && (
                  <span className="tva-msg">
                    Lu automatiquement ({Math.round((confidence[f] ?? 0) * 100)} %) : comparez avec le PDF, corrigez ou confirmez.
                  </span>
                )}
                {errs.map((a) => <span key={a.code} className="tva-msg">{a.message}</span>)}
              </div>
            )
          })}

          <div className="tva-field">
            <label htmlFor="f-prorata">Prorata de déduction (%)</label>
            <input id="f-prorata" value={prorata} disabled={locked} inputMode="decimal" onChange={(e) => setProrata(e.target.value)} />
          </div>

          {!locked && (
            <div className="tva-actions">
              <button type="button" className="btn-ghost" onClick={computeTva} disabled={pending}>
                Calculer TVA et TTC depuis HT × taux
              </button>
            </div>
          )}

          {generalErrors.length > 0 && (
            <ul className="tva-blocking">
              {generalErrors.map((a) => <li key={a.code}>{a.message}</li>)}
            </ul>
          )}

          {warnings.length > 0 && (
            <div className="tva-warnings">
              <strong>Alertes à accepter explicitement avant validation</strong>
              {warnings.map((w) => (
                <label key={w.code}>
                  <input
                    type="checkbox"
                    checked={accepted.has(w.code)}
                    disabled={locked || dirty}
                    onChange={(e) => {
                      const next = new Set(accepted)
                      if (e.target.checked) next.add(w.code)
                      else next.delete(w.code)
                      setAccepted(next)
                    }}
                  />
                  <span>
                    {FIELD_LABEL[fieldOf(w.champ) as ChampLigne] ? `${FIELD_LABEL[fieldOf(w.champ) as ChampLigne]} — ` : ''}
                    {w.message}
                  </span>
                </label>
              ))}
            </div>
          )}

          {error && <p style={{ color: 'var(--red-600)', fontSize: 13, margin: 0 }}>{error}</p>}
          {info && <p style={{ color: 'var(--emerald-600)', fontSize: 13, margin: 0 }}>{info}</p>}

          {!locked && (
            <div className="tva-actions">
              <button type="button" className="btn-secondary" onClick={save} disabled={pending || !dirty} data-testid="tva-save">
                Enregistrer
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={pending || !canValidate || (invoice.status === 'valide' && validAndUnchanged)}
                title={
                  dirty
                    ? 'Enregistrez d’abord vos modifications'
                    : !canValidate
                      ? 'Traitez les erreurs, confirmations et alertes'
                      : undefined
                }
                onClick={() => run(() => validateInvoice(invoice.id, [...accepted]), 'Ligne validée.')}
                data-testid="tva-validate"
              >
                ✓ Valider la ligne
              </button>
              {invoice.status !== 'rejete' && !rejecting && (
                <button type="button" className="btn-ghost" onClick={() => setRejecting(true)} disabled={pending}>
                  Rejeter
                </button>
              )}
              {invoice.status !== 'a_verifier' && (
                <button type="button" className="btn-ghost" onClick={() => run(() => reopenInvoice(invoice.id), 'Remise à vérifier.')} disabled={pending}>
                  ↺ Remettre à vérifier
                </button>
              )}
            </div>
          )}

          {!locked && !canValidate && !(invoice.status === 'valide' && validAndUnchanged) && (
            <p className="section-sub">
              Validation possible quand : modifications enregistrées
              {lowCount > 0 && `, ${lowCount} champ(s) lu(s) à confirmer`}
              {errorCount > 0 && `, ${errorCount} erreur(s) corrigée(s)`}
              {unacceptedWarnings > 0 && `, ${unacceptedWarnings} alerte(s) acceptée(s)`}
              {!invoice.payment_date && ', date de paiement saisie'}.
            </p>
          )}

          {rejecting && (
            <div className="tva-actions">
              <input
                className="auth-input"
                style={{ flex: 1, fontSize: 13, padding: '8px 10px' }}
                placeholder="Motif du rejet (doublon, non déductible, illisible...)"
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
              />
              <button type="button" className="btn-secondary" onClick={() => setRejecting(false)}>Annuler</button>
              <button
                type="button"
                className="btn-primary"
                style={{ background: 'var(--red-600)' }}
                disabled={pending || !note.trim()}
                onClick={() => run(() => rejectInvoice(invoice.id, note), 'Facture rejetée : exclue du relevé.')}
              >
                Confirmer le rejet
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
