'use server'

import { revalidatePath } from 'next/cache'
import { firstRel } from '@/lib/rel'
import { createClient } from '@/lib/supabase/server'
import { createInvitationInternal } from './invitations'
import { clientProfileUpdatedTemplate } from '@/lib/email'
import { getStaffEmails, sendToMany } from '@/lib/notify'

export async function createClientRecord(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Session expirée. Veuillez vous reconnecter.' }

  const companyName = String(formData.get('company_name') || '').trim()
  const contactName = String(formData.get('contact_name') || '').trim()
  const email = String(formData.get('email') || '').trim().toLowerCase()
  const phone = String(formData.get('phone') || '').trim()
  const ice = String(formData.get('ice') || '').trim()
  const ifNumber = String(formData.get('if_number') || '').trim()
  const rcNumber = String(formData.get('rc_number') || '').trim()
  const cnssNumber = String(formData.get('cnss_number') || '').trim()
  const tvaPeriodRaw = String(formData.get('tva_period') || '').trim()
  const tvaPeriod =
    tvaPeriodRaw && ['mensuel', 'trimestriel', 'exonere'].includes(tvaPeriodRaw)
      ? tvaPeriodRaw
      : null
  const fiscalYearStart =
    String(formData.get('fiscal_year_start') || '').trim() || null

  if (!companyName) return { error: 'Le nom de l’entreprise est obligatoire.' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role, organizations(name)')
    .eq('id', user.id)
    .single()
  if (!profile?.organization_id || !['owner', 'staff'].includes(profile.role))
    return { error: 'Vous n’avez pas les droits pour créer un client.' }

  const { data: inserted, error } = await supabase
    .from('clients')
    .insert({
      organization_id: profile.organization_id,
      company_name: companyName,
      contact_name: contactName || null,
      email: email || null,
      phone: phone || null,
      ice: ice || null,
      if_number: ifNumber || null,
      rc_number: rcNumber || null,
      cnss_number: cnssNumber || null,
      tva_period: tvaPeriod,
      fiscal_year_start: fiscalYearStart,
      status: email ? 'invited' : 'active',
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  // Auto-génération des échéances fiscales pour l'année en cours
  if (inserted?.id && (tvaPeriod || fiscalYearStart)) {
    await supabase.rpc('generate_fiscal_deadlines_for_client', {
      target_client: inserted.id,
      year_ref: new Date().getFullYear(),
    })
  }

  // Auto-créer une invitation si un e-mail client est fourni
  let invitation:
    | { inviteUrl: string; emailSent: boolean; emailVia: 'emergent' | 'supabase' | 'none'; emailError?: string }
    | undefined
  if (inserted?.id && email) {
    const cabinetName = firstRel(profile.organizations)?.name || 'Votre cabinet'
    const res = await createInvitationInternal(supabase, {
      organizationId: profile.organization_id,
      clientId: inserted.id,
      clientEmail: email,
      clientCompany: companyName,
      cabinetName,
    })
    if (!res.error && res.inviteUrl) {
      invitation = {
        inviteUrl: res.inviteUrl,
        emailSent: res.emailSent,
        emailVia: res.emailVia,
        emailError: res.emailError,
      }
    }
  }

  revalidatePath('/clients')
  revalidatePath('/')
  revalidatePath('/deadlines')
  return { success: true, clientId: inserted?.id, invitation }
}

export async function regenerateDeadlinesForClient(clientId: string, year?: number) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Session expirée.' }
  const { data, error } = await supabase.rpc('generate_fiscal_deadlines_for_client', {
    target_client: clientId,
    year_ref: year ?? new Date().getFullYear(),
  })
  if (error) return { error: error.message }
  revalidatePath('/deadlines')
  revalidatePath(`/clients/${clientId}`)
  return { success: true, inserted: data ?? 0 }
}

export async function markDeadlineCompleted(deadlineId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Session expirée.' }
  const { error } = await supabase
    .from('fiscal_deadlines')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      completed_by: user.id,
    })
    .eq('id', deadlineId)
  if (error) return { error: error.message }
  revalidatePath('/deadlines')
  return { success: true }
}

/* -------------------------------------------------------------------------- */
/*                   Édition fiche client (fiduciaire)                        */
/* -------------------------------------------------------------------------- */

const TVA_VALUES = ['mensuel', 'trimestriel', 'exonere'] as const
const STATUS_VALUES = ['active', 'invited', 'inactive'] as const

function cleanOptional(formData: FormData, key: string): string | null {
  const raw = String(formData.get(key) || '').trim()
  return raw ? raw : null
}

/** Fiduciaire (owner/staff) : édite TOUS les champs de la fiche client. */
export async function updateClientRecord(clientId: string, formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Session expirée.' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()
  if (!profile?.organization_id || !['owner', 'staff'].includes(profile.role))
    return { error: 'Vous n’avez pas les droits pour modifier un client.' }

  const companyName = String(formData.get('company_name') || '').trim()
  if (!companyName) return { error: 'Le nom de l’entreprise est obligatoire.' }

  const tvaRaw = String(formData.get('tva_period') || '').trim()
  const tvaPeriod = (TVA_VALUES as readonly string[]).includes(tvaRaw) ? tvaRaw : null
  const statusRaw = String(formData.get('status') || '').trim()
  const status = (STATUS_VALUES as readonly string[]).includes(statusRaw) ? statusRaw : undefined

  const payload: Record<string, unknown> = {
    company_name: companyName,
    contact_name: cleanOptional(formData, 'contact_name'),
    email: cleanOptional(formData, 'email')?.toLowerCase() ?? null,
    phone: cleanOptional(formData, 'phone'),
    address: cleanOptional(formData, 'address'),
    website: cleanOptional(formData, 'website'),
    ice: cleanOptional(formData, 'ice'),
    if_number: cleanOptional(formData, 'if_number'),
    rc_number: cleanOptional(formData, 'rc_number'),
    cnss_number: cleanOptional(formData, 'cnss_number'),
    patente_number: cleanOptional(formData, 'patente_number'),
    tva_period: tvaPeriod,
    fiscal_year_start: cleanOptional(formData, 'fiscal_year_start'),
  }
  if (status) payload.status = status

  const { error } = await supabase
    .from('clients')
    .update(payload)
    .eq('id', clientId)
    .eq('organization_id', profile.organization_id)
    .is('deleted_at', null)
  if (error) return { error: error.message }

  revalidatePath(`/clients/${clientId}`)
  revalidatePath('/clients')
  revalidatePath('/audit')
  return { success: true }
}

/** Client (rôle = 'client') : édite SEULEMENT ses propres champs de contact. */
export async function updateOwnClientProfile(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Session expirée.' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || profile.role !== 'client')
    return { error: 'Accès réservé aux comptes clients.' }

  // Récupérer la ligne client associée au profil AVANT update (pour email + diff)
  const { data: before } = await supabase
    .from('clients')
    .select(
      'id, organization_id, company_name, contact_name, email, phone, address, website'
    )
    .eq('profile_id', user.id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!before) return { error: 'Aucun dossier client associé à votre compte.' }

  // Champs autorisés en self-service — PAS d'ICE/IF/RC/CNSS/status/organization_id/email
  // (email reste l'identité de connexion ; à modifier via Supabase Auth, pas ici)
  const payload = {
    contact_name: cleanOptional(formData, 'contact_name'),
    phone: cleanOptional(formData, 'phone'),
    address: cleanOptional(formData, 'address'),
    website: cleanOptional(formData, 'website'),
    company_name: String(formData.get('company_name') || before.company_name).trim(),
  }

  const { error } = await supabase
    .from('clients')
    .update(payload)
    .eq('id', before.id)
  if (error) return { error: error.message }

  // Notification best-effort au cabinet
  try {
    const [staffEmails, { data: orgRow }] = await Promise.all([
      getStaffEmails(before.organization_id),
      supabase
        .from('organizations')
        .select('name')
        .eq('id', before.organization_id)
        .single(),
    ])
    if (staffEmails.length) {
      const changes: Array<[string, string | null, string | null]> = []
      const push = (label: string, oldV: string | null, newV: string | null) => {
        if ((oldV || '') !== (newV || '')) changes.push([label, oldV, newV])
      }
      push('Nom de l’entreprise', before.company_name, payload.company_name)
      push('Contact', before.contact_name, payload.contact_name)
      push('Téléphone', before.phone, payload.phone)
      push('Adresse', before.address, payload.address)
      push('Site web', before.website, payload.website)

      const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://fido.app').replace(/\/+$/, '')
      const tpl = clientProfileUpdatedTemplate({
        clientCompany: payload.company_name,
        cabinetName: orgRow?.name || 'Votre cabinet',
        changes,
        appUrl: `${appUrl}/clients/${before.id}`,
        appName: 'Fido',
      })
      await sendToMany(staffEmails, tpl)
    }
  } catch {
    /* notification best-effort : ne bloque jamais la mise à jour */
  }

  revalidatePath('/client')
  revalidatePath('/client/profile')
  return { success: true }
}
