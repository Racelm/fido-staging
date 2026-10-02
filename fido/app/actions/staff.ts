'use server'

import { createHash, randomBytes } from 'crypto'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { sendEmail, staffInviteTemplate } from '@/lib/email'

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}

export async function inviteStaff(formData: FormData) {
  const email = String(formData.get('email') || '').trim().toLowerCase()
  const fullName = String(formData.get('full_name') || '').trim() || null

  if (!email) return { error: 'E-mail requis.' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Session expirée.' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organization_id, organizations(name)')
    .eq('id', user.id)
    .single()
  if (!profile || profile.role !== 'owner' || !profile.organization_id) {
    return { error: 'Seul le propriétaire du cabinet peut inviter un collaborateur.' }
  }

  const rawToken = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')

  const { data: inserted, error } = await supabase
    .from('staff_invitations')
    .insert({
      organization_id: profile.organization_id,
      email,
      full_name: fullName,
      role: 'staff',
      token_hash: tokenHash,
      invited_by: user.id,
    })
    .select('id')
    .single()
  if (error) return { error: error.message }

  const inviteUrl = `${appUrl()}/invite-staff/${rawToken}`
  const org = profile.organizations as { name?: string | null } | { name?: string | null }[] | null | undefined
  const cabinetName = (Array.isArray(org) ? org[0]?.name : org?.name) || 'Votre cabinet'
  const appName = process.env.EMAIL_FROM_NAME || 'Fido'

  let emailSent = false
  let emailError: string | undefined
  if (process.env.EMERGENT_EMAIL_KEY) {
    try {
      const { subject, html } = staffInviteTemplate({
        inviteeName: fullName || 'cher·e collaborateur·rice',
        cabinetName,
        inviteUrl,
        appName,
      })
      await sendEmail({ to: email, subject, html })
      emailSent = true
    } catch (err) {
      emailError = err instanceof Error ? err.message : String(err)
    }
  }

  revalidatePath('/team')
  return {
    success: true,
    invitationId: inserted?.id,
    emailSent,
    emailError,
    inviteUrl: emailSent ? undefined : inviteUrl, // fallback si pas d'e-mail
  }
}

export async function revokeStaffInvitation(invitationId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Session expirée.' }
  const { error } = await supabase
    .from('staff_invitations')
    .delete()
    .eq('id', invitationId)
  if (error) return { error: error.message }
  revalidatePath('/team')
  return { success: true }
}
