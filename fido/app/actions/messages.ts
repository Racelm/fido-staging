'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function sendMessage(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Session expirée. Veuillez vous reconnecter.' }

  const clientId = String(formData.get('client_id') || '').trim()
  const body = String(formData.get('body') || '').trim()
  if (!clientId || !body) return { error: 'Le message ne peut pas être vide.' }
  if (body.length > 4000) return { error: 'Le message est trop long (4 000 caractères maximum).' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()

  if (!profile) return { error: 'Profil introuvable.' }

  const { data: client } = await supabase
    .from('clients')
    .select('id, organization_id, profile_id')
    .eq('id', clientId)
    .single()

  if (!client) return { error: 'Client introuvable.' }

  const allowed = profile.role === 'client'
    ? client.profile_id === user.id
    : ['owner', 'staff'].includes(profile.role) && client.organization_id === profile.organization_id

  if (!allowed) return { error: 'Accès refusé.' }

  const { error } = await supabase.from('messages').insert({
    organization_id: client.organization_id,
    client_id: client.id,
    sender_id: user.id,
    body,
  })

  if (error) return { error: error.message }

  revalidatePath('/messages')
  revalidatePath('/client')
  revalidatePath(`/clients/${clientId}`)
  return { success: true }
}
