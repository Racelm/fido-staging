import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppShell from '@/components/AppShell'
import { controlerReleve } from '@/lib/tva/releve-deductions'
import { codeAvertissement, MODE_PAIEMENT_LABEL } from '@/lib/tva/fields'
import {
  defaultPeriod,
  loadPeriod,
  PERIOD_LABEL,
  regimeFromClient,
  toLigne,
  type InvoiceRow,
} from '@/lib/tva/server'
import InvoiceReview, { type ReviewAnomaly } from './InvoiceReview'
import ExportPanel from './ExportPanel'
import CreateFromDocument from './CreateFromDocument'
import ExportHistory from './ExportHistory'

export const dynamic = 'force-dynamic'

const fmt = (v: number | string | null) =>
  v === null || v === '' ? '—' : Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const STATUS: Record<InvoiceRow['status'], { label: string; cls: string }> = {
  a_verifier: { label: 'À vérifier', cls: 'pill-orange' },
  valide: { label: 'Validée', cls: 'pill-green' },
  rejete: { label: 'Rejetée', cls: 'pill-gray' },
}

export default async function TvaClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>
  searchParams: Promise<{ annee?: string; periode?: string; ligne?: string }>
}) {
  const { clientId } = await params
  const sp = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name,role,organization_id,organizations(name)')
    .eq('id', user.id)
    .single()
  if (!profile || !['owner', 'staff'].includes(profile.role)) redirect('/')

  const { data: clientRow } = await supabase
    .from('clients')
    .select('id,company_name,tva_period')
    .eq('id', clientId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!clientRow) redirect('/tva')
  const regime = regimeFromClient(clientRow.tva_period)
  const fallback = regime ? defaultPeriod(regime) : { annee: new Date().getFullYear(), periode: 1 }
  const annee = Number(sp.annee) || fallback.annee
  const periode = Number(sp.periode) || fallback.periode

  const loaded = await loadPeriod(supabase, clientId, annee, periode)
  if ('error' in loaded) {
    return (
      <AppShell active="/tva" profile={profile} title={`TVA — ${clientRow.company_name}`}>
        <section className="card card-padded">
          <div className="empty-state">
            <strong>Dossier incomplet</strong>
            <span>{loaded.error}</span>
            <Link className="btn-secondary" href={`/clients/${clientId}/edit`}>Compléter la fiche client</Link>
          </div>
        </section>
      </AppShell>
    )
  }
  const s = loaded.state
  const base = `/tva/${clientId}?annee=${annee}&periode=${periode}`

  // Factures d'achat (PDF) du client pas encore saisies
  const [{ data: purchaseDocs }, { data: linked }, { data: suppliers }, { data: exports }] = await Promise.all([
    supabase
      .from('documents')
      .select('id,name,created_at,review_status')
      .eq('client_id', clientId)
      .eq('category', 'facture_achat')
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    supabase.from('purchase_invoices').select('document_id').eq('client_id', clientId).not('document_id', 'is', null),
    supabase.from('tva_suppliers').select('id,name,if_number,ice').eq('client_id', clientId).order('name'),
    supabase
      .from('tva_exports')
      .select('id,annee,periode,line_count,total_tva_deductible,xml_sha256,exported_at,cancelled_at,cancel_reason')
      .eq('client_id', clientId)
      .order('exported_at', { ascending: false })
      .limit(20),
  ])
  const linkedIds = new Set((linked ?? []).map((l) => l.document_id))
  const docsToEnter = (purchaseDocs ?? []).filter((d) => !linkedIds.has(d.id))

  // Ligne sélectionnée
  const selectedId = sp.ligne
  let selected: InvoiceRow | null = null
  let selectedAnomalies: ReviewAnomaly[] = []
  let selectedValid = false
  const idx = s.rows.findIndex((r) => r.id === selectedId)
  if (idx >= 0) {
    selected = s.rows[idx]
    selectedAnomalies = s.anomalies
      .filter((a) => a.ligne === idx + 1)
      .map((a) => ({ niveau: a.niveau, champ: a.champ, message: a.message, code: codeAvertissement(a) }))
    selectedValid = s.validStates[idx]
  } else {
    const u = s.undated.find((r) => r.id === selectedId) ?? s.rejected.find((r) => r.id === selectedId)
    if (u) {
      selected = u
      selectedAnomalies = controlerReleve(s.entete, [toLigne(u)]).map((a) => ({
        niveau: a.niveau,
        champ: a.champ,
        message: a.message,
        code: codeAvertissement(a),
      }))
    }
  }

  let pdfUrl: string | null = null
  if (selected?.document_id) {
    const { data: doc } = await supabase
      .from('documents')
      .select('storage_path,organization_id')
      .eq('id', selected.document_id)
      .maybeSingle()
    if (doc) {
      const { data: signed } = await supabase.storage.from('documents').createSignedUrl(doc.storage_path, 60 * 30)
      pdfUrl = signed?.signedUrl ?? null
      await supabase.rpc('log_audit_event', {
        p_action: 'document.view',
        p_entity_type: 'document',
        p_entity_id: selected.document_id,
        p_organization_id: doc.organization_id,
        p_meta: { context: 'tva_review' },
      })
    }
  }

  const issuesByRow = s.rows.map((_, i) => s.anomalies.filter((a) => a.ligne === i + 1))
  const validatedCount = s.validStates.filter(Boolean).length
  const totalDeductible = s.rows.reduce(
    (sum, r) => sum + (Number(r.amount_tva) || 0) * ((Number(r.prorata) || 100) / 100),
    0
  )
  const label = PERIOD_LABEL(s.entete.regime, periode, annee)
  const maxP = s.entete.regime === 1 ? 12 : 4
  const years = [annee - 1, annee, annee + 1]

  return (
    <AppShell
      active="/tva"
      profile={profile}
      title={`TVA — ${s.client.company_name}`}
      welcome={`Relevé des déductions · ${label} · IF ${s.entete.identifiantFiscal}`}
      action={<Link href="/tva" className="btn-secondary">← Dossiers TVA</Link>}
    >
      <form className="tva-period" method="get" action={`/tva/${clientId}`} style={{ marginBottom: 16 }}>
        <select name="annee" defaultValue={annee} aria-label="Année">
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select name="periode" defaultValue={periode} aria-label="Période">
          {Array.from({ length: maxP }, (_, i) => i + 1).map((p) => (
            <option key={p} value={p}>{PERIOD_LABEL(s.entete.regime, p, annee).replace(` ${annee}`, '')}</option>
          ))}
        </select>
        <button className="btn-secondary" type="submit">Afficher</button>
        <span className="section-sub">Période {s.bounds.debut} → {s.bounds.fin} (date de paiement)</span>
      </form>

      <div className="tva-stats">
        <div className="tva-stat"><strong>{s.rows.length}</strong><span>Factures de la période</span></div>
        <div className="tva-stat"><strong>{validatedCount}</strong><span>Validées par le cabinet</span></div>
        <div className="tva-stat"><strong>{s.rows.length - validatedCount + s.undated.length}</strong><span>À vérifier / compléter</span></div>
        <div className="tva-stat"><strong>{fmt(totalDeductible)}</strong><span>TVA déductible (DH)</span></div>
      </div>

      {docsToEnter.length > 0 && (
        <section className="card card-padded" style={{ marginBottom: 16 }}>
          <div className="section-head">
            <div>
              <h2 className="section-title">Factures d’achat reçues à saisir</h2>
              <p className="section-sub">PDF classés « Facture achat » sans ligne de relevé.</p>
            </div>
          </div>
          <table className="audit-table">
            <tbody>
              {docsToEnter.map((d) => (
                <tr key={d.id}>
                  <td style={{ fontWeight: 600 }}>{d.name}</td>
                  <td>{new Date(d.created_at).toLocaleDateString('fr-FR')}</td>
                  <td style={{ textAlign: 'right' }}>
                    <CreateFromDocument documentId={d.id} basePath={base} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {s.undated.length > 0 && (
        <section className="card card-padded" style={{ marginBottom: 16 }}>
          <div className="section-head">
            <div>
              <h2 className="section-title">Sans date de paiement</h2>
              <p className="section-sub">
                La déduction se fait au mois du paiement : complétez la date et le mode de paiement, ou rejetez la facture.
              </p>
            </div>
          </div>
          <table className="audit-table">
            <tbody>
              {s.undated.map((r) => (
                <tr key={r.id} className={r.id === selectedId ? 'tva-row-active' : ''}>
                  <td style={{ fontWeight: 600 }}>{r.supplier_name || 'Fournisseur à saisir'}</td>
                  <td>{r.invoice_number || '—'}</td>
                  <td>{fmt(r.amount_ttc)} DH TTC</td>
                  <td style={{ textAlign: 'right' }}>
                    <Link className="btn-secondary" href={`${base}&ligne=${r.id}`}>Compléter</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card card-padded" style={{ marginBottom: 16 }}>
        <div className="section-head">
          <div>
            <h2 className="section-title">Lignes du relevé — {label}</h2>
            <p className="section-sub">Chaque ligne doit être vérifiée sur le PDF puis validée.</p>
          </div>
        </div>
        {s.rows.length ? (
          <table className="audit-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Fournisseur</th>
                <th>N° facture</th>
                <th>Payée le</th>
                <th>Mode</th>
                <th style={{ textAlign: 'right' }}>HT</th>
                <th style={{ textAlign: 'right' }}>TVA</th>
                <th>Statut</th>
                <th>Points</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r, i) => {
                const issues = issuesByRow[i]
                const errors = issues.filter((a) => a.niveau === 'erreur').length
                const st = r.status === 'valide' && !s.validStates[i] ? { label: 'À revalider', cls: 'pill-red' } : STATUS[r.status]
                return (
                  <tr key={r.id} className={r.id === selectedId ? 'tva-row-active' : ''}>
                    <td>{i + 1}</td>
                    <td style={{ fontWeight: 600 }}>{r.supplier_name || '—'}</td>
                    <td>{r.invoice_number || '—'}</td>
                    <td>{r.payment_date ? new Date(r.payment_date).toLocaleDateString('fr-FR') : '—'}</td>
                    <td>{r.payment_mode ? MODE_PAIEMENT_LABEL[r.payment_mode] : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(r.amount_ht)}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(r.amount_tva)}</td>
                    <td>
                      <span className={`pill ${st.cls}`}>{st.label}</span>
                      {r.export_id && <span className="pill pill-blue" style={{ marginLeft: 4 }}>Exportée</span>}
                    </td>
                    <td>
                      {errors > 0 ? (
                        <span className="pill pill-red">{errors} erreur(s)</span>
                      ) : issues.length > 0 ? (
                        <span className="pill pill-orange">{issues.length} alerte(s)</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <Link className="btn-secondary" href={`${base}&ligne=${r.id}`} data-testid={`tva-review-${r.id}`}>
                        Vérifier
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">
            <strong>Aucune facture payée sur cette période</strong>
            <span>Saisissez les factures d’achat reçues ou changez de période.</span>
          </div>
        )}
      </section>

      {selected && (
        <section className="card card-padded" style={{ marginBottom: 16 }} id="verification">
          <InvoiceReview
            key={`${selected.id}-${selected.status}-${selected.validation_hash ?? ''}`}
            invoice={selected}
            anomalies={selectedAnomalies}
            pdfUrl={pdfUrl}
            suppliers={suppliers ?? []}
            validAndUnchanged={selectedValid}
            closeHref={base}
          />
        </section>
      )}

      <section className="card card-padded" style={{ marginBottom: 16 }}>
        <ExportPanel
          clientId={clientId}
          annee={annee}
          periode={periode}
          label={label}
          exportable={s.exportable && s.undated.length === 0}
          alreadyExported={s.alreadyExported}
          blocking={[
            ...s.undated.map((r) => `Facture ${r.invoice_number || r.id.slice(0, 8)} : date de paiement manquante`),
            ...s.blocking.map((a) =>
              a.ligne ? `Ligne ${a.ligne} (${s.rows[a.ligne - 1]?.supplier_name || '—'}) : ${a.message}` : a.message
            ),
          ]}
        />
      </section>

      <section className="card card-padded">
        <ExportHistory exports={exports ?? []} isOwner={profile.role === 'owner'} />
      </section>
    </AppShell>
  )
}
