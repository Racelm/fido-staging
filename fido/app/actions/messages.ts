'use server'

import { firstRel } from '@/lib/rel'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { newMessageTemplate } from '@/lib/email'
import { getClientEmail, getStaffEmails, sendToMany } from '@/lib/notify'

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}

export async function sendMessage(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Session expirée. Veuillez vous reconnecter.' }

  const clientId = String(formData.get('client_id') || '').trim()
  const body = String(formData.get('body') || '').trim()
  if (!clientId || !body) return { error: 'Le message ne peut pas être vide.' }
  if (body.length > 4000)
    return { error: 'Le message est trop long (4 000 caractères maximum).' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role, full_name, organizations(name)')
    .eq('id', user.id)
    .single()
  if (!profile) return { error: 'Profil introuvable.' }

  const { data: client } = await supabase
    .from('clients')
    .select('id, organization_id, profile_id, company_name')
    .eq('id', clientId)
    .single()
  if (!client) return { error: 'Client introuvable.' }

  const allowed =
    profile.role === 'client'
      ? client.profile_id === user.id
      : ['owner', 'staff'].includes(profile.role) &&
        client.organization_id === profile.organization_id

  if (!allowed) return { error: 'Accès refusé.' }

  const { error } = await supabase.from('messages').insert({
    organization_id: client.organization_id,
    client_id: client.id,
    sender_id: user.id,
    body,
  })
  if (error) return { error: error.message }

  // Notification e-mail (best-effort, ne jette jamais)
  const cabinetName = firstRel(profile.organizations)?.name || 'Votre cabinet'
  const appName = process.env.EMAIL_FROM_NAME || 'Tiwizi'
  const preview = body.length > 220 ? body.slice(0, 217) + '…' : body

  if (profile.role === 'client') {
    // Client → staff : prévenir toute l'équipe cabinet
    const staffEmails = await getStaffEmails(client.organization_id)
    if (staffEmails.length) {
      const { subject, html } = newMessageTemplate({
        clientCompany: client.company_name,
        messagePreview: preview,
        appUrl: `${appUrl()}/clients/${client.id}`,
        appName,
      })
      await sendToMany(staffEmails, { subject, html })
    }
  } else {
    // Staff → client : prévenir le client (via adresse clients.email ou profile)
    const clientEmail = await getClientEmail(client.id)
    if (clientEmail) {
      const { subject, html } = newMessageTemplate({
        clientCompany: cabinetName, // on affiche le nom du cabinet dans l'e-mail au client
        messagePreview: preview,
        appUrl: `${appUrl()}/client`,
        appName,
      })
      await sendToMany([clientEmail], { subject, html })
    }
  }

  revalidatePath('/messages')
  revalidatePath('/client')
  revalidatePath(`/clients/${clientId}`)
  return { success: true }
}
