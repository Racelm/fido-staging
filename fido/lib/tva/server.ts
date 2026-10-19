import type { SupabaseClient } from '@supabase/supabase-js'
import {
  anomaliesBloquantes,
  controlerReleve,
  empreinteLigne,
  type Anomalie,
  type ChampLigne,
  type EnteteReleve,
  type LigneDeduction,
  type ModePaiement,
  type RegimeTva,
} from './releve-deductions'

/** Ligne telle que stockée dans public.purchase_invoices */
export type InvoiceRow = {
  id: string
  organization_id: string
  client_id: string
  document_id: string | null
  supplier_id: string | null
  supplier_name: string | null
  supplier_if: string | null
  supplier_ice: string | null
  invoice_number: string | null
  designation: string | null
  invoice_date: string | null
  amount_ht: number | string | null
  tva_rate: number | string | null
  amount_tva: number | string | null
  amount_ttc: number | string | null
  prorata: number | string
  payment_mode: number | null
  payment_date: string | null
  extraction_confidence: Record<string, number> | null
  confirmed_fields: string[] | null
  status: 'a_verifier' | 'valide' | 'rejete'
  validated_by: string | null
  validated_at: string | null
  validation_hash: string | null
  accepted_warnings: string[] | null
  rejection_note: string | null
  export_id: string | null
  created_at: string
}

export const INVOICE_COLUMNS =
  'id,organization_id,client_id,document_id,supplier_id,supplier_name,supplier_if,supplier_ice,invoice_number,designation,invoice_date,amount_ht,tva_rate,amount_tva,amount_ttc,prorata,payment_mode,payment_date,extraction_confidence,confirmed_fields,status,validated_by,validated_at,validation_hash,accepted_warnings,rejection_note,export_id,created_at'

const num = (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? NaN : Number(v))

/** Conversion ligne SQL → ligne du relevé (les valeurs manquantes déclenchent des erreurs de contrôle) */
export function toLigne(r: InvoiceRow): LigneDeduction {
  return {
    numFacture: r.invoice_number ?? '',
    designation: r.designation ?? '',
    montantHT: num(r.amount_ht),
    montantTVA: num(r.amount_tva),
    montantTTC: num(r.amount_ttc),
    tauxTVA: num(r.tva_rate),
    prorata: num(r.prorata),
    fournisseur: {
      identifiantFiscal: r.supplier_if ?? '',
      nom: r.supplier_name ?? '',
      ice: r.supplier_ice ?? '',
    },
    modePaiement: (r.payment_mode ?? 0) as ModePaiement,
    datePaiement: r.payment_date ?? '',
    dateFacture: r.invoice_date ?? '',
    extraction: r.document_id
      ? {
          pdfId: r.document_id,
          confiance: (r.extraction_confidence ?? {}) as Partial<Record<ChampLigne, number>>,
          champsConfirmes: (r.confirmed_fields ?? []) as ChampLigne[],
        }
      : undefined,
    validation:
      r.status === 'valide' && r.validation_hash && r.validated_by && r.validated_at
        ? {
            validePar: r.validated_by,
            valideLe: r.validated_at,
            empreinte: r.validation_hash,
            avertissementsAcceptes: r.accepted_warnings ?? [],
          }
        : undefined,
  }
}

export function regimeFromClient(tvaPeriod: string | null): RegimeTva | null {
  if (tvaPeriod === 'mensuel') return 1
  if (tvaPeriod === 'trimestriel') return 2
  return null
}

export function periodBounds(annee: number, periode: number, regime: RegimeTva) {
  const moisDebut = regime === 1 ? periode : (periode - 1) * 3 + 1
  const moisFin = regime === 1 ? periode : moisDebut + 2
  const pad = (n: number) => String(n).padStart(2, '0')
  const dernier = new Date(Date.UTC(annee, moisFin, 0)).getUTCDate()
  return { debut: `${annee}-${pad(moisDebut)}-01`, fin: `${annee}-${pad(moisFin)}-${pad(dernier)}` }
}

/** Période qui contient une date de paiement */
export function periodOfDate(date: string, regime: RegimeTva): { annee: number; periode: number } {
  const [y, m] = date.split('-').map(Number)
  return { annee: y, periode: regime === 1 ? m : Math.ceil(m / 3) }
}

export type ClientTva = {
  id: string
  organization_id: string
  company_name: string
  if_number: string | null
  tva_period: string | null
}

export type PeriodState = {
  client: ClientTva
  entete: EnteteReleve
  bounds: { debut: string; fin: string }
  /** Factures de la période (hors rejetées), dans l'ordre du relevé */
  rows: InvoiceRow[]
  rejected: InvoiceRow[]
  /** Factures du client sans date de paiement : non rattachables à une période */
  undated: InvoiceRow[]
  /** Anomalies indexées sur `rows` (ligne = index + 1) */
  anomalies: Anomalie[]
  /** Pour chaque ligne : validée et inchangée depuis la validation */
  validStates: boolean[]
  /** Tout ce qui bloque l'export (vide = exportable si au moins une ligne) */
  blocking: Anomalie[]
  /** Période déjà exportée (lignes verrouillées) */
  alreadyExported: boolean
  exportable: boolean
}

export async function loadPeriod(
  supabase: SupabaseClient,
  clientId: string,
  annee: number,
  periode: number
): Promise<{ error: string } | { state: PeriodState }> {
  const { data: client } = await supabase
    .from('clients')
    .select('id,organization_id,company_name,if_number,tva_period')
    .eq('id', clientId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!client) return { error: 'Client introuvable.' }

  const regime = regimeFromClient(client.tva_period)
  if (!regime) return { error: 'Régime TVA du client non défini (mensuel ou trimestriel) : complétez la fiche client.' }
  if (!client.if_number || !/^\d{1,15}$/.test(client.if_number))
    return { error: 'Identifiant fiscal (IF) du client manquant ou invalide : complétez la fiche client.' }
  const maxPeriode = regime === 1 ? 12 : 4
  if (!Number.isInteger(periode) || periode < 1 || periode > maxPeriode) return { error: 'Période invalide.' }

  const bounds = periodBounds(annee, periode, regime)
  const [{ data: inPeriod, error }, { data: undated }] = await Promise.all([
    supabase
      .from('purchase_invoices')
      .select(INVOICE_COLUMNS)
      .eq('client_id', clientId)
      .is('deleted_at', null)
      .gte('payment_date', bounds.debut)
      .lte('payment_date', bounds.fin)
      .order('payment_date', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('purchase_invoices')
      .select(INVOICE_COLUMNS)
      .eq('client_id', clientId)
      .is('deleted_at', null)
      .is('payment_date', null)
      .neq('status', 'rejete')
      .order('created_at', { ascending: true }),
  ])
  if (error) return { error: error.message }

  const all = (inPeriod ?? []) as InvoiceRow[]
  const rows = all.filter((r) => r.status !== 'rejete')
  const rejected = all.filter((r) => r.status === 'rejete')
  const entete: EnteteReleve = { identifiantFiscal: client.if_number, annee, periode, regime }
  const lignes = rows.map(toLigne)
  const anomalies = controlerReleve(entete, lignes)
  const validStates = lignes.map((l) => !!l.validation && l.validation.empreinte === empreinteLigne(l))
  const blocking = anomaliesBloquantes(entete, lignes)
  const alreadyExported = rows.some((r) => !!r.export_id)
  const exportable = rows.length > 0 && blocking.length === 0 && !alreadyExported

  return {
    state: {
      client: client as ClientTva,
      entete,
      bounds,
      rows,
      rejected,
      undated: (undated ?? []) as InvoiceRow[],
      anomalies,
      validStates,
      blocking,
      alreadyExported,
      exportable,
    },
  }
}

/** Période à déclarer par défaut : la période précédant la date du jour */
export function defaultPeriod(regime: RegimeTva, today: Date = new Date()): { annee: number; periode: number } {
  let annee = today.getFullYear()
  const mois = today.getMonth() + 1
  if (regime === 1) {
    if (mois === 1) return { annee: annee - 1, periode: 12 }
    return { annee, periode: mois - 1 }
  }
  const trimestre = Math.ceil(mois / 3)
  if (trimestre === 1) {
    annee -= 1
    return { annee, periode: 4 }
  }
  return { annee, periode: trimestre - 1 }
}

export const PERIOD_LABEL = (regime: RegimeTva, periode: number, annee: number) => {
  if (regime === 2) return `T${periode} ${annee}`
  const mois = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
  return `${mois[periode - 1]} ${annee}`
}
