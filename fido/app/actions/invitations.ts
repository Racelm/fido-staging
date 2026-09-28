'use server'

import { firstRel } from '@/lib/rel'
import { createHash, randomBytes } from 'crypto'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { inviteEmailTemplate, sendEmail } from '@/lib/email'

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
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

  const rawToken = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')

  const { error } = await supabase
    .from('client_invitations')
    .insert({ client_id: client.id, email: client.email, token_hash: tokenHash })
  if (error) return { error: error.message }

  const inviteUrl = `${appUrl()}/invite/${rawToken}`
  const cabinetName = firstRel(profile.organizations)?.name || 'Votre cabinet'
  const appName = process.env.EMAIL_FROM_NAME || 'Fido'

  let emailSent = false
  let emailError: string | undefined
  if (process.env.EMERGENT_EMAIL_KEY) {
    try {
      const { subject, html } = inviteEmailTemplate({
        cabinetName,
        clientCompany: client.company_name,
        inviteUrl,
        appName,
      })
      await sendEmail({ to: client.email, subject, html })
      emailSent = true
    } catch (err) {
      emailError = err instanceof Error ? err.message : String(err)
    }
  }

  // Audit
  await supabase.rpc('log_audit_event', {
    p_action: 'invitation.create',
    p_entity_type: 'invitation',
    p_entity_id: client.id,
    p_organization_id: profile.organization_id,
    p_meta: { email: client.email, email_sent: emailSent },
  })

  revalidatePath(`/clients/${client.id}`)
  return { success: true, token: rawToken, emailSent, emailError }
}
