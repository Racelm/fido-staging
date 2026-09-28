'use server'

import { firstRel } from '@/lib/rel'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { documentReceivedTemplate, sendEmail } from '@/lib/email'

const MAX_SIZE = 25 * 1024 * 1024 // 25 MB
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
])

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}

export async function getDocumentDownloadUrl(documentId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Session expirée.' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id,role')
    .eq('id', user.id)
    .single()
  const { data: document } = await supabase
    .from('documents')
    .select('id,storage_path,organization_id,client_id,name,category')
    .eq('id', documentId)
    .is('deleted_at', null)
    .single()
  if (!profile || !document) return { error: 'Document introuvable.' }

  const allowed = ['owner', 'staff'].includes(profile.role)
    ? profile.organization_id === document.organization_id
    : (await supabase.from('clients').select('profile_id').eq('id', document.client_id).single())
        .data?.profile_id === user.id

  if (!allowed) return { error: 'Accès refusé.' }

  const { data, error } = await supabase.storage
    .from('documents')
    .createSignedUrl(document.storage_path, 60 * 10)
  if (error) return { error: error.message }

  await supabase.rpc('log_audit_event', {
    p_action: 'document.download',
    p_entity_type: 'document',
    p_entity_id: document.id,
    p_organization_id: document.organization_id,
    p_meta: { name: document.name },
  })

  return { url: data.signedUrl }
}

/**
 * Validation légère côté serveur (défense en profondeur — la vraie garde vient
 * de la contrainte SQL + de la policy RLS Storage).
 */
export async function validateUploadServerSide(
  fileName: string,
  size: number,
  mime: string | null
): Promise<{ ok: boolean; error?: string }> {
  if (!fileName || fileName.length > 255) return { ok: false, error: 'Nom de fichier invalide.' }
  if (size > MAX_SIZE) return { ok: false, error: 'Fichier trop volumineux (25 Mo maximum).' }
  if (mime && !ALLOWED_MIME.has(mime))
    return { ok: false, error: 'Type de fichier non autorisé.' }
  return { ok: true }
}

export async function notifyStaffOfDocument(documentId: string) {
  // Utilisé après un upload client — best-effort, non bloquant.
  if (!process.env.EMERGENT_EMAIL_KEY) return { success: false }
  const supabase = await createClient()
  const { data: doc } = await supabase
    .from('documents')
    .select('id,name,organization_id,client_id,clients(company_name),organizations(name)')
    .eq('id', documentId)
    .single()
  if (!doc) return { success: false }

  // Récupère les e-mails des owners/staff de l'org (via auth.users -> profiles)
  const { data: staff } = await supabase
    .from('profiles')
    .select('id,full_name')
    .eq('organization_id', doc.organization_id)
    .in('role', ['owner', 'staff'])

  if (!staff?.length) return { success: false }

  const appName = process.env.EMAIL_FROM_NAME || 'Fido'
  const { subject, html } = documentReceivedTemplate({
    clientCompany: firstRel(doc.clients)?.company_name || 'Client',
    documentName: doc.name,
    appUrl: `${appUrl()}/documents`,
    appName,
  })

  // On récupère les e-mails via l'API auth (nécessite service role — sinon on skippe)
  // Ici on note simplement l'audit et laisse Supabase envoyer via triggers.
  await supabase.rpc('log_audit_event', {
    p_action: 'notification.document_received',
    p_entity_type: 'document',
    p_entity_id: doc.id,
    p_organization_id: doc.organization_id,
    p_meta: { staff_count: staff.length },
  })

  // Envoi best-effort : on tente pour chaque staff via l'e-mail stocké côté auth
  // (uniquement si Service Role Key configurée — sinon on skippe silencieusement).
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return { success: true, note: 'staff-email-not-sent (no service key)' }
  try {
    const { createClient: createAdminClient } = await import('@supabase/supabase-js')
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceKey,
      { auth: { persistSession: false } }
    )
    for (const s of staff) {
      const { data: authUser } = await admin.auth.admin.getUserById(s.id)
      const email = authUser?.user?.email
      if (email) {
        try {
          await sendEmail({ to: email, subject, html })
        } catch {
          // ignore per-recipient errors
        }
      }
    }
    return { success: true }
  } catch {
    return { success: false }
  }
}

export async function archiveClient(clientId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Session expirée.' }
  const { error } = await supabase.rpc('archive_client', { target_client: clientId })
  if (error) return { error: error.message }
  revalidatePath('/clients')
  revalidatePath('/')
  return { success: true }
}
