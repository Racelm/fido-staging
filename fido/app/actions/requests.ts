'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function createDocumentRequest(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Session expirée.' }

  const title = String(formData.get('title') || '').trim()
  const description = String(formData.get('description') || '').trim()
  const dueDate = String(formData.get('due_date') || '').trim()
  const clientId = String(formData.get('client_id') || '').trim()
  if (!title || !clientId) return { error: 'Le titre et le client sont obligatoires.' }

  const { data: profile } = await supabase.from('profiles').select('organization_id, role').eq('id', user.id).single()
  if (!profile?.organization_id || !['owner', 'staff'].includes(profile.role)) return { error: 'Accès refusé.' }

  const { error } = await supabase.from('document_requests').insert({
    organization_id: profile.organization_id,
    client_id: clientId,
    title,
    description: description || null,
    due_date: dueDate || null,
    created_by: user.id,
    status: 'pending',
  })
  if (error) return { error: error.message }

  revalidatePath(`/clients/${clientId}`)
  revalidatePath('/documents')
  revalidatePath('/')
  return { success: true }
}
