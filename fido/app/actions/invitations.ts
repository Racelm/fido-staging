'use server'

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
 * Crée une invitation : row dans client_invitations + e-mail (si clé configurée).
 * Retourne toujours le lien à partager (fallback manuel si pas d'e-mail).
 */
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
    return { token: '', inviteUrl: '', emailSent: false, error: insertErr.message }
  }

  const inviteUrl = `${appUrl()}/invite/${rawToken}`
  const appName = process.env.EMAIL_FROM_NAME || 'Fido'
  let emailSent = false
  let emailError: string | undefined

  if (process.env.EMERGENT_EMAIL_KEY) {
    try {
      const { subject, html } = inviteEmailTemplate({
        cabinetName: params.cabinetName,
        clientCompany: params.clientCompany,
        inviteUrl,
        appName,
      })
      await sendEmail({ to: params.clientEmail, subject, html })
      emailSent = true
    } catch (err) {
      emailError = err instanceof Error ? err.message : String(err)
    }
  }

  await supabase.rpc('log_audit_event', {
    p_action: 'invitation.create',
    p_entity_type: 'invitation',
    p_entity_id: params.clientId,
    p_organization_id: params.organizationId,
    p_meta: { email: params.clientEmail, email_sent: emailSent },
  })

  return { token: rawToken, inviteUrl, emailSent, emailError }
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
    emailError: result.emailError,
  }
}
