'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function createClientRecord(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Session expirée. Veuillez vous reconnecter.' }
  const companyName = String(formData.get('company_name') || '').trim()
  const contactName = String(formData.get('contact_name') || '').trim()
  const email = String(formData.get('email') || '').trim().toLowerCase()
  const phone = String(formData.get('phone') || '').trim()
  if (!companyName) return { error: 'Le nom de l’entreprise est obligatoire.' }

  const { data: profile } = await supabase.from('profiles').select('organization_id, role').eq('id', user.id).single()
  if (!profile?.organization_id || !['owner', 'staff'].includes(profile.role)) return { error: 'Vous n’avez pas les droits pour créer un client.' }

  const { error } = await supabase.from('clients').insert({
    organization_id: profile.organization_id,
    company_name: companyName,
    contact_name: contactName || null,
    email: email || null,
    phone: phone || null,
    status: email ? 'invited' : 'active',
  })
  if (error) return { error: error.message }
  revalidatePath('/clients'); revalidatePath('/')
  return { success: true }
}
