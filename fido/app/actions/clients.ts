'use server'

import { revalidatePath } from 'next/cache'
import { firstRel } from '@/lib/rel'
import { createClient } from '@/lib/supabase/server'
import { createInvitationInternal } from './invitations'

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
