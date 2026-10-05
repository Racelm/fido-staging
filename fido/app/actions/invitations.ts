'use server'

import { createClient as createAdminClient } from '@supabase/supabase-js'
import { firstRel } from '@/lib/rel'
import { createHash, randomBytes } from 'crypto'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { inviteEmailTemplate, sendEmail } from '@/lib/email'

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * Essaie d'envoyer l'e-mail d'invitation via le canal le plus simple disponible :
 *   1. Si EMERGENT_EMAIL_KEY est configurée → envoi via Resend proxy Emergent (template custom)
 *   2. Sinon si SUPABASE_SERVICE_ROLE_KEY est configurée → envoi via Supabase Auth
 *      natif (inviteUserByEmail), gratuit, inclus avec Supabase, template dans
 *      le dashboard Supabase
 *   3. Sinon → aucun envoi (le lien doit être copié manuellement depuis l'UI)
 */
async function sendInvitationEmail(params: {
  email: string
  cabinetName: string
  clientCompany: string
  inviteUrl: string
  nextRedirect: string // route finale après vérification Supabase (notre /invite/[token])
}): Promise<{ sent: boolean; via: 'emergent' | 'supabase' | 'none'; error?: string }> {
  const appName = process.env.EMAIL_FROM_NAME || 'Fido'

  // 1. Emergent proxy (template custom, HTML riche)
  if (process.env.EMERGENT_EMAIL_KEY) {
    try {
      const { subject, html } = inviteEmailTemplate({
        cabinetName: params.cabinetName,
        clientCompany: params.clientCompany,
        inviteUrl: params.inviteUrl,
        appName,
      })
      await sendEmail({ to: params.email, subject, html })
      return { sent: true, via: 'emergent' }
    } catch (err) {
      return {
        sent: false,
        via: 'emergent',
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  // 2. Supabase natif (gratuit, template simple de Supabase Auth)
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (serviceKey && supabaseUrl) {
    try {
      const admin = createAdminClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false },
      })
      const redirectTo = `${appUrl()}${params.nextRedirect}`
      const { error } = await admin.auth.admin.inviteUserByEmail(params.email, {
        redirectTo,
        data: { cabinet_name: params.cabinetName, invited_by_app: appName },
      })
      if (error) {
        return { sent: false, via: 'supabase', error: error.message }
      }
      return { sent: true, via: 'supabase' }
    } catch (err) {
      return {
        sent: false,
        via: 'supabase',
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  return { sent: false, via: 'none' }
}

export async function createInvitationInternal(
  supabase: SupabaseServerClient,
  params: {
    organizationId: string
    clientId: string
    clientEmail: string
    clientCompany: string
    cabinetName: string
  }
): Promise<{
  token: string
  inviteUrl: string
  emailSent: boolean
  emailVia: 'emergent' | 'supabase' | 'none'
  emailError?: string
  error?: string
}> {
  const rawToken = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')

  const { error: insertErr } = await supabase
    .from('client_invitations')
    .insert({
      client_id: params.clientId,
      email: params.clientEmail,
      token_hash: tokenHash,
    })
  if (insertErr) {
    return { token: '', inviteUrl: '', emailSent: false, emailVia: 'none', error: insertErr.message }
  }

  const inviteUrl = `${appUrl()}/invite/${rawToken}`
  const result = await sendInvitationEmail({
    email: params.clientEmail,
    cabinetName: params.cabinetName,
    clientCompany: params.clientCompany,
    inviteUrl,
    nextRedirect: `/invite/${rawToken}`,
  })

  await supabase.rpc('log_audit_event', {
    p_action: 'invitation.create',
    p_entity_type: 'invitation',
    p_entity_id: params.clientId,
    p_organization_id: params.organizationId,
    p_meta: {
      email: params.clientEmail,
      email_sent: result.sent,
      email_via: result.via,
      email_error: result.error,
    },
  })

  return {
    token: rawToken,
    inviteUrl,
    emailSent: result.sent,
    emailVia: result.via,
    emailError: result.error,
  }
}

export async function createClientInvitation(clientId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Session expirée. Veuillez vous reconnecter.' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role, organizations(name)')
    .eq('id', user.id)
    .single()
  if (!profile?.organization_id || !['owner', 'staff'].includes(profile.role))
    return { error: 'Accès refusé.' }

  const { data: client } = await supabase
    .from('clients')
    .select('id, organization_id, email, company_name')
    .eq('id', clientId)
    .eq('organization_id', profile.organization_id)
    .single()
  if (!client) return { error: 'Client introuvable.' }
  if (!client.email)
    return { error: 'Ajoutez une adresse e-mail au client avant de créer une invitation.' }

  const cabinetName = firstRel(profile.organizations)?.name || 'Votre cabinet'

  const result = await createInvitationInternal(supabase, {
    organizationId: profile.organization_id,
    clientId: client.id,
    clientEmail: client.email,
    clientCompany: client.company_name,
    cabinetName,
  })
  if (result.error) return { error: result.error }

  revalidatePath(`/clients/${client.id}`)
  return {
    success: true,
    token: result.token,
    inviteUrl: result.inviteUrl,
    emailSent: result.emailSent,
    emailVia: result.emailVia,
    emailError: result.emailError,
  }
}
