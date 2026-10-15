import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppShell from '@/components/AppShell'
import { defaultPeriod, PERIOD_LABEL, periodBounds, regimeFromClient } from '@/lib/tva/server'

export const dynamic = 'force-dynamic'

export default async function TvaPage() {
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

  const [{ data: clients }, { data: invoices }, { data: purchaseDocs }, { data: exports }] = await Promise.all([
    supabase
      .from('clients')
      .select('id,company_name,if_number,tva_period')
      .eq('organization_id', profile.organization_id)
      .is('deleted_at', null)
      .order('company_name'),
    supabase
      .from('purchase_invoices')
      .select('client_id,document_id,status,payment_date,export_id')
      .eq('organization_id', profile.organization_id)
      .is('deleted_at', null),
    supabase
      .from('documents')
      .select('id,client_id')
      .eq('organization_id', profile.organization_id)
      .eq('category', 'facture_achat')
      .is('deleted_at', null),
    supabase
      .from('tva_exports')
      .select('client_id,annee,periode,exported_at')
      .eq('organization_id', profile.organization_id)
      .is('cancelled_at', null),
  ])

  const linkedDocs = new Set((invoices ?? []).map((i) => i.document_id).filter(Boolean))

  const rows = (clients ?? []).map((c) => {
    const regime = regimeFromClient(c.tva_period)
    const own = (invoices ?? []).filter((i) => i.client_id === c.id)
    const pdfToEnter = (purchaseDocs ?? []).filter((d) => d.client_id === c.id && !linkedDocs.has(d.id)).length
    if (!regime) return { c, regime, pdfToEnter, toCheck: 0, period: null as null | { annee: number; periode: number }, inPeriod: 0, validated: 0, exported: false }
    const period = defaultPeriod(regime)
    const b = periodBounds(period.annee, period.periode, regime)
    const inPeriod = own.filter((i) => i.status !== 'rejete' && i.payment_date && i.payment_date >= b.debut && i.payment_date <= b.fin)
    const exported = (exports ?? []).some((e) => e.client_id === c.id && e.annee === period.annee && e.periode === period.periode)
    return {
      c,
      regime,
      pdfToEnter,
      toCheck: own.filter((i) => i.status === 'a_verifier').length,
      period,
      inPeriod: inPeriod.length,
      validated: inPeriod.filter((i) => i.status === 'valide').length,
      exported,
    }
  })

  const totalToCheck = rows.reduce((s, r) => s + r.toCheck + r.pdfToEnter, 0)

  return (
    <AppShell
      active="/tva"
      profile={profile}
      title="TVA — Relevé des déductions"
      welcome={totalToCheck > 0 ? `${totalToCheck} facture(s) d’achat à saisir ou vérifier` : 'Préparez les fichiers EDI pour SIMPL-TVA'}
    >
      <section className="card card-padded">
        <div className="section-head">
          <div>
            <h2 className="section-title">Dossiers TVA</h2>
            <p className="section-sub">
              Période proposée : la dernière période close. Seules les factures validées par le cabinet sont exportées.
            </p>
          </div>
        </div>

        {rows.length ? (
          <table className="audit-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Régime</th>
                <th>Période</th>
                <th>PDF à saisir</th>
                <th>À vérifier</th>
                <th>Validées / période</th>
                <th>Export</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.c.id}>
                  <td style={{ fontWeight: 600 }}>
                    {r.c.company_name}
                    {!r.c.if_number && <div className="section-sub">IF manquant</div>}
                  </td>
                  <td>
                    {r.regime === 1 ? 'Mensuel' : r.regime === 2 ? 'Trimestriel' : (
                      <span className="pill pill-gray">{r.c.tva_period === 'exonere' ? 'Exonéré' : 'Non défini'}</span>
                    )}
                  </td>
                  <td>{r.regime && r.period ? PERIOD_LABEL(r.regime, r.period.periode, r.period.annee) : '—'}</td>
                  <td>{r.pdfToEnter ? <span className="pill pill-violet">{r.pdfToEnter}</span> : '—'}</td>
                  <td>{r.toCheck ? <span className="pill pill-orange">{r.toCheck}</span> : '—'}</td>
                  <td>{r.regime ? `${r.validated} / ${r.inPeriod}` : '—'}</td>
                  <td>
                    {r.exported ? <span className="pill pill-green">Exporté</span> : r.regime ? <span className="pill pill-gray">À faire</span> : '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {r.regime && r.period ? (
                      <Link
                        className="btn-secondary"
                        href={`/tva/${r.c.id}?annee=${r.period.annee}&periode=${r.period.periode}`}
                        data-testid={`tva-open-${r.c.id}`}
                      >
                        Ouvrir
                      </Link>
                    ) : (
                      <Link className="btn-ghost" href={`/clients/${r.c.id}/edit`}>
                        Compléter la fiche
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">
            <strong>Aucun client</strong>
            <span>Créez un dossier client avec son IF et son régime TVA.</span>
          </div>
        )}
      </section>
    </AppShell>
  )
}
