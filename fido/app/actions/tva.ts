'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  empreinteLigne,
  exporterReleve,
  validerLigne,
  type Anomalie,
  type ChampLigne,
} from '@/lib/tva/releve-deductions'
import { FIELD_COLUMN, isChampLigne } from '@/lib/tva/fields'
import {
  INVOICE_COLUMNS,
  loadPeriod,
  periodOfDate,
  regimeFromClient,
  toLigne,
  type InvoiceRow,
} from '@/lib/tva/server'

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; anomalies?: Anomalie[] }

async function staffContext() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Session expirée. Veuillez vous reconnecter.' as const }
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id,role')
    .eq('id', user.id)
    .single()
  if (!profile?.organization_id || !['owner', 'staff'].includes(profile.role))
    return { error: 'Accès réservé au cabinet.' as const }
  return { supabase, user, profile }
}

async function getInvoice(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string
): Promise<InvoiceRow | null> {
  const { data } = await supabase.from('purchase_invoices').select(INVOICE_COLUMNS).eq('id', id).maybeSingle()
  return (data as InvoiceRow | null) ?? null
}

function revalidateClient(clientId: string) {
  revalidatePath('/tva')
  revalidatePath(`/tva/${clientId}`)
}

/* ------------------------------------------------------------------ */
/* Création                                                            */
/* ------------------------------------------------------------------ */

/** Crée une ligne à vérifier à partir d'une facture d'achat (PDF) du client */
export async function createInvoiceFromDocument(documentId: string): Promise<Result<{ id: string }>> {
  const ctx = await staffContext()
  if ('error' in ctx) return { ok: false, error: ctx.error! }
  const { supabase, user, profile } = ctx

  const { data: doc } = await supabase
    .from('documents')
    .select('id,organization_id,client_id')
    .eq('id', documentId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!doc || doc.organization_id !== profile.organization_id) return { ok: false, error: 'Document introuvable.' }

  const { data: existing } = await supabase
    .from('purchase_invoices')
    .select('id')
    .eq('document_id', documentId)
    .is('deleted_at', null)
    .maybeSingle()
  if (existing) return { ok: true, id: existing.id }

  const { data, error } = await supabase
    .from('purchase_invoices')
    .insert({
      organization_id: doc.organization_id,
      client_id: doc.client_id,
      document_id: doc.id,
      created_by: user.id,
    })
    .select('id')
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? 'Création impossible.' }
  revalidateClient(doc.client_id)
  return { ok: true, id: data.id }
}

/**
 * Crée une ligne vide saisie à la main (facture reçue sur papier, par WhatsApp…).
 * Tous les champs sont saisis par le fiduciaire, donc considérés comme vérifiés ;
 * la ligne reste « à vérifier » jusqu'à sa validation explicite.
 */
export async function createManualInvoice(clientId: string): Promise<Result<{ id: string }>> {
  const ctx = await staffContext()
  if ('error' in ctx) return { ok: false, error: ctx.error! }
  const { supabase, user, profile } = ctx

  const { data: client } = await supabase
    .from('clients')
    .select('id,organization_id')
    .eq('id', clientId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!client || client.organization_id !== profile.organization_id) return { ok: false, error: 'Client introuvable.' }

  const { data, error } = await supabase
    .from('purchase_invoices')
    .insert({ organization_id: client.organization_id, client_id: client.id, created_by: user.id })
    .select('id')
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? 'Création impossible.' }
  revalidateClient(client.id)
  return { ok: true, id: data.id }
}

/** Rattache (ou détache) le PDF justificatif d'une ligne saisie à la main */
export async function linkInvoiceDocument(invoiceId: string, documentId: string | null): Promise<Result> {
  const ctx = await staffContext()
  if ('error' in ctx) return { ok: false, error: ctx.error! }
  const { supabase } = ctx

  const row = await getInvoice(supabase, invoiceId)
  if (!row) return { ok: false, error: 'Facture introuvable.' }
  if (row.export_id) return { ok: false, error: 'Facture déjà exportée : annulez l’export avant de la modifier.' }

  if (documentId) {
    const { data: doc } = await supabase
      .from('documents')
      .select('id,client_id')
      .eq('id', documentId)
      .is('deleted_at', null)
      .maybeSingle()
    if (!doc || doc.client_id !== row.client_id) return { ok: false, error: 'Document introuvable pour ce client.' }
    const { data: used } = await supabase
      .from('purchase_invoices')
      .select('id')
      .eq('document_id', documentId)
      .is('deleted_at', null)
      .neq('id', invoiceId)
      .maybeSingle()
    if (used) return { ok: false, error: 'Ce PDF est déjà rattaché à une autre ligne.' }
  }

  const { error } = await supabase.from('purchase_invoices').update({ document_id: documentId }).eq('id', invoiceId)
  if (error) return { ok: false, error: error.message }
  revalidateClient(row.client_id)
  return { ok: true }
}

/* ------------------------------------------------------------------ */
/* Saisie / correction                                                 */
/* ------------------------------------------------------------------ */

function parseValue(champ: ChampLigne, raw: string): string | number | null {
  const v = raw.trim()
  if (v === '') return null
  switch (champ) {
    case 'montantHT':
    case 'montantTVA':
    case 'montantTTC':
    case 'tauxTVA': {
      const n = Number(v.replace(/\s/g, '').replace(',', '.'))
      return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN
    }
    case 'modePaiement': {
      const n = Number(v)
      return Number.isInteger(n) ? n : NaN
    }
    case 'fournisseur.identifiantFiscal':
    case 'fournisseur.ice':
      return v.replace(/\s/g, '')
    default:
      return v
  }
}

/**
 * Enregistre les champs modifiés par le fiduciaire. Tout champ saisi à la
 * main est considéré comme confirmé. Si la ligne était validée, la base
 * annule automatiquement la validation.
 */
export async function saveInvoice(
  id: string,
  values: Partial<Record<ChampLigne, string>>,
  prorata?: string
): Promise<Result> {
  const ctx = await staffContext()
  if ('error' in ctx) return { ok: false, error: ctx.error! }
  const { supabase, user } = ctx

  const row = await getInvoice(supabase, id)
  if (!row) return { ok: false, error: 'Facture introuvable.' }
  if (row.export_id) return { ok: false, error: 'Facture déjà exportée : annulez l’export avant de la modifier.' }

  const patch: Record<string, unknown> = {}
  const confirmed = new Set(row.confirmed_fields ?? [])
  for (const [k, raw] of Object.entries(values)) {
    if (!isChampLigne(k) || raw === undefined) continue
    const parsed = parseValue(k, raw)
    if (typeof parsed === 'number' && Number.isNaN(parsed))
      return { ok: false, error: `Valeur invalide pour « ${k} ».` }
    const col = FIELD_COLUMN[k]
    const current = (row as unknown as Record<string, unknown>)[col]
    const same =
      current === parsed ||
      (current !== null && parsed !== null && Number(current) === Number(parsed) && typeof parsed === 'number')
    if (!same) patch[col] = parsed
    confirmed.add(k) // vérifié à la main, qu'il ait changé ou non
  }
  if (prorata !== undefined && prorata.trim() !== '') {
    const p = Number(prorata.replace(',', '.'))
    if (!Number.isFinite(p) || p <= 0 || p > 100) return { ok: false, error: 'Prorata invalide (0–100).' }
    if (Number(row.prorata) !== p) patch.prorata = p
  }
  patch.confirmed_fields = [...confirmed]

  const { error } = await supabase.from('purchase_invoices').update(patch).eq('id', id)
  if (error) return { ok: false, error: error.message }

  // Alimente le référentiel fournisseurs (IF/ICE vérifiés par le fiduciaire)
  const name = (patch.supplier_name ?? row.supplier_name) as string | null
  const ifn = (patch.supplier_if ?? row.supplier_if) as string | null
  const ice = (patch.supplier_ice ?? row.supplier_ice) as string | null
  if (name && ifn && /^\d{1,15}$/.test(ifn) && ice && /^\d{15}$/.test(ice)) {
    await supabase.from('tva_suppliers').upsert(
      {
        organization_id: row.organization_id,
        client_id: row.client_id,
        name,
        if_number: ifn,
        ice,
        verified_by: user.id,
        verified_at: new Date().toISOString(),
      },
      { onConflict: 'client_id,ice', ignoreDuplicates: true }
    )
  }

  revalidateClient(row.client_id)
  return { ok: true }
}

/** Confirme un champ lu sur le PDF après contrôle visuel */
export async function confirmField(id: string, champ: string): Promise<Result> {
  if (!isChampLigne(champ)) return { ok: false, error: 'Champ inconnu.' }
  const ctx = await staffContext()
  if ('error' in ctx) return { ok: false, error: ctx.error! }
  const row = await getInvoice(ctx.supabase, id)
  if (!row) return { ok: false, error: 'Facture introuvable.' }
  const confirmed = new Set(row.confirmed_fields ?? [])
  confirmed.add(champ)
  const { error } = await ctx.supabase
    .from('purchase_invoices')
    .update({ confirmed_fields: [...confirmed] })
    .eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidateClient(row.client_id)
  return { ok: true }
}

/* ------------------------------------------------------------------ */
/* Décision du fiduciaire                                              */
/* ------------------------------------------------------------------ */

export async function validateInvoice(id: string, acceptedWarnings: string[] = []): Promise<Result> {
  const ctx = await staffContext()
  if ('error' in ctx) return { ok: false, error: ctx.error! }
  const { supabase, user } = ctx

  const row = await getInvoice(supabase, id)
  if (!row) return { ok: false, error: 'Facture introuvable.' }
  if (!row.payment_date) return { ok: false, error: 'Date de paiement obligatoire : elle détermine la période de déduction.' }

  const { data: client } = await supabase.from('clients').select('tva_period').eq('id', row.client_id).single()
  const regime = regimeFromClient(client?.tva_period ?? null)
  if (!regime) return { ok: false, error: 'Régime TVA du client non défini.' }

  // Contrôle dans le contexte de toute la période (doublons, etc.)
  const { annee, periode } = periodOfDate(row.payment_date, regime)
  const loaded = await loadPeriod(supabase, row.client_id, annee, periode)
  if ('error' in loaded) return { ok: false, error: loaded.error }
  const { entete, rows } = loaded.state
  const index = rows.findIndex((r) => r.id === id)
  if (index < 0) return { ok: false, error: 'Facture hors période ou rejetée.' }

  const res = validerLigne(entete, rows.map(toLigne), index, user.id, acceptedWarnings)
  if (!res.ok) return { ok: false, error: 'La ligne contient encore des points à traiter.', anomalies: res.anomalies }

  const { error } = await supabase
    .from('purchase_invoices')
    .update({
      status: 'valide',
      validated_by: user.id,
      validation_hash: res.ligne.validation!.empreinte,
      accepted_warnings: res.ligne.validation!.avertissementsAcceptes,
      rejection_note: null,
    })
    .eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidateClient(row.client_id)
  return { ok: true }
}

export async function rejectInvoice(id: string, note: string): Promise<Result> {
  const ctx = await staffContext()
  if ('error' in ctx) return { ok: false, error: ctx.error! }
  const row = await getInvoice(ctx.supabase, id)
  if (!row) return { ok: false, error: 'Facture introuvable.' }
  if (!note.trim()) return { ok: false, error: 'Indiquez le motif du rejet.' }
  const { error } = await ctx.supabase
    .from('purchase_invoices')
    .update({ status: 'rejete', rejection_note: note.trim().slice(0, 500) })
    .eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidateClient(row.client_id)
  return { ok: true }
}

export async function reopenInvoice(id: string): Promise<Result> {
  const ctx = await staffContext()
  if ('error' in ctx) return { ok: false, error: ctx.error! }
  const row = await getInvoice(ctx.supabase, id)
  if (!row) return { ok: false, error: 'Facture introuvable.' }
  const { error } = await ctx.supabase
    .from('purchase_invoices')
    .update({ status: 'a_verifier', rejection_note: null })
    .eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidateClient(row.client_id)
  return { ok: true }
}

/* ------------------------------------------------------------------ */
/* Export SIMPL-TVA                                                    */
/* ------------------------------------------------------------------ */

export async function exportReleve(
  clientId: string,
  annee: number,
  periode: number
): Promise<Result<{ url: string; fileName: string; sha256: string; lines: number }>> {
  const ctx = await staffContext()
  if ('error' in ctx) return { ok: false, error: ctx.error! }
  const { supabase, profile } = ctx

  const loaded = await loadPeriod(supabase, clientId, annee, periode)
  if ('error' in loaded) return { ok: false, error: loaded.error }
  const { state } = loaded
  if (state.client.organization_id !== profile.organization_id) return { ok: false, error: 'Accès refusé.' }
  if (state.alreadyExported) return { ok: false, error: 'Cette période a déjà été exportée.' }
  if (state.undated.length)
    return { ok: false, error: `${state.undated.length} facture(s) du client sans date de paiement : à compléter ou rejeter avant l’export.` }

  const lignes = state.rows.map(toLigne)
  // Double contrôle : empreinte recalculée côté serveur sur les données actuelles
  if (state.rows.some((r, i) => r.validation_hash !== empreinteLigne(lignes[i])))
    return { ok: false, error: 'Des données ont changé depuis leur validation : revalidez les lignes concernées.' }

  const res = await exporterReleve(state.entete, lignes)
  if (!res.ok || !res.zip || !res.nomZip || !res.empreinteXml)
    return { ok: false, error: 'Export bloqué : des points restent à traiter.', anomalies: res.anomalies }

  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
  const storagePath = `${state.client.organization_id}/${clientId}/tva/${stamp}-${res.nomZip}`
  const { error: upErr } = await supabase.storage
    .from('documents')
    .upload(storagePath, res.zip, { contentType: 'application/zip', upsert: false })
  if (upErr) return { ok: false, error: `Stockage du fichier impossible : ${upErr.message}` }

  const totalTva = lignes.reduce((s, l) => s + (l.montantTVA * (l.prorata ?? 100)) / 100, 0)
  const { error: regErr } = await supabase.rpc('register_tva_export', {
    p_client_id: clientId,
    p_annee: annee,
    p_periode: periode,
    p_regime: state.entete.regime,
    p_invoice_ids: state.rows.map((r) => r.id),
    p_xml_sha256: res.empreinteXml,
    p_storage_path: storagePath,
    p_total_tva_deductible: Math.round(totalTva * 100) / 100,
  })
  if (regErr) {
    await supabase.storage.from('documents').remove([storagePath])
    return { ok: false, error: regErr.message }
  }

  const { data: signed, error: urlErr } = await supabase.storage
    .from('documents')
    .createSignedUrl(storagePath, 60 * 10, { download: res.nomZip })
  if (urlErr || !signed) return { ok: false, error: urlErr?.message ?? 'Lien de téléchargement indisponible.' }

  revalidateClient(clientId)
  return { ok: true, url: signed.signedUrl, fileName: res.nomZip, sha256: res.empreinteXml, lines: lignes.length }
}

export async function getExportDownloadUrl(exportId: string): Promise<Result<{ url: string }>> {
  const ctx = await staffContext()
  if ('error' in ctx) return { ok: false, error: ctx.error! }
  const { data: exp } = await ctx.supabase
    .from('tva_exports')
    .select('storage_path,organization_id')
    .eq('id', exportId)
    .maybeSingle()
  if (!exp) return { ok: false, error: 'Export introuvable.' }
  const fileName = exp.storage_path.split('/').pop()?.replace(/^\d{8}T\d{6}-/, '') ?? 'releve.zip'
  const { data, error } = await ctx.supabase.storage
    .from('documents')
    .createSignedUrl(exp.storage_path, 60 * 10, { download: fileName })
  if (error || !data) return { ok: false, error: error?.message ?? 'Lien indisponible.' }
  await ctx.supabase.rpc('log_audit_event', {
    p_action: 'tva.export_download',
    p_entity_type: 'tva_export',
    p_entity_id: exportId,
    p_organization_id: exp.organization_id,
    p_meta: {},
  })
  return { ok: true, url: data.signedUrl }
}

export async function cancelExport(exportId: string, reason: string): Promise<Result> {
  const ctx = await staffContext()
  if ('error' in ctx) return { ok: false, error: ctx.error! }
  const { data: exp } = await ctx.supabase.from('tva_exports').select('client_id').eq('id', exportId).maybeSingle()
  const { error } = await ctx.supabase.rpc('cancel_tva_export', { p_export_id: exportId, p_reason: reason })
  if (error) return { ok: false, error: error.message }
  if (exp) revalidateClient(exp.client_id)
  return { ok: true }
}
