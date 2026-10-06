'use server'

import { firstRel } from '@/lib/rel'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { documentRequestTemplate } from '@/lib/email'
import { getClientEmail, sendToMany } from '@/lib/notify'

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}

export async function createDocumentRequest(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Session expirée.' }

  const title = String(formData.get('title') || '').trim()
  const description = String(formData.get('description') || '').trim()
  const dueDate = String(formData.get('due_date') || '').trim()
  const clientId = String(formData.get('client_id') || '').trim()
  if (!title || !clientId) return { error: 'Le titre et le client sont obligatoires.' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role, organizations(name)')
    .eq('id', user.id)
    .single()
  if (!profile?.organization_id || !['owner', 'staff'].includes(profile.role))
    return { error: 'Accès refusé.' }

  const { data: inserted, error } = await supabase
    .from('document_requests')
    .insert({
      organization_id: profile.organization_id,
      client_id: clientId,
      title,
      description: description || null,
      due_date: dueDate || null,
      created_by: user.id,
      status: 'pending',
    })
    .select('id')
    .single()
  if (error) return { error: error.message }

  // Notification e-mail client (best-effort)
  const [{ data: client }, clientEmail] = await Promise.all([
    supabase.from('clients').select('company_name').eq('id', clientId).single(),
    getClientEmail(clientId),
  ])
  let notification: { sent: boolean; reason?: string } = { sent: false, reason: 'no-email' }
  if (clientEmail && client) {
    const appName = process.env.EMAIL_FROM_NAME || 'Fido'
    const cabinetName = firstRel(profile.organizations)?.name || 'Votre cabinet'
    const { subject, html } = documentRequestTemplate({
      cabinetName,
      clientCompany: client.company_name,
      requestTitle: title,
      description: description || null,
      dueDate: dueDate || null,
      appUrl: `${appUrl()}/client`,
      appName,
    })
    const res = await sendToMany([clientEmail], { subject, html })
    notification = { sent: res.sent > 0 }
  }

  revalidatePath(`/clients/${clientId}`)
  revalidatePath('/documents')
  revalidatePath('/requests')
  revalidatePath('/')
  return { success: true, requestId: inserted?.id, notification }
}
