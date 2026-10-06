import { createClient as createAdminClient } from '@supabase/supabase-js'
import { sendEmailSafe } from '@/lib/email'

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createAdminClient(url, key, { auth: { persistSession: false } })
}

/** Récupère les e-mails des owners+staff d'une organisation. */
export async function getStaffEmails(organizationId: string): Promise<string[]> {
  const a = admin()
  if (!a) return []
  const { data: profiles } = await a
    .from('profiles')
    .select('id')
    .eq('organization_id', organizationId)
    .in('role', ['owner', 'staff'])
  if (!profiles?.length) return []
  const emails: string[] = []
  for (const p of profiles) {
    try {
      const { data } = await a.auth.admin.getUserById(p.id as string)
      if (data?.user?.email) emails.push(data.user.email)
    } catch {
      /* ignore per-user */
    }
  }
  return emails
}

/** Récupère l'e-mail d'un client (via colonne clients.email ou via auth.users). */
export async function getClientEmail(clientId: string): Promise<string | null> {
  const a = admin()
  if (!a) return null
  const { data: client } = await a
    .from('clients')
    .select('email, profile_id')
    .eq('id', clientId)
    .single()
  if (!client) return null
  if (client.email) return client.email
  if (client.profile_id) {
    try {
      const { data } = await a.auth.admin.getUserById(client.profile_id as string)
      return data?.user?.email || null
    } catch {
      return null
    }
  }
  return null
}

/** Envoie un e-mail à une liste de destinataires en best-effort. */
export async function sendToMany(
  recipients: string[],
  payload: { subject: string; html: string }
): Promise<{ sent: number; failed: number }> {
  let sent = 0
  let failed = 0
  for (const to of recipients) {
    const r = await sendEmailSafe({ to, ...payload })
    if (r.sent) sent += 1
    else failed += 1
  }
  return { sent, failed }
}
