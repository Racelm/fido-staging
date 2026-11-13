'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { currentPeriod, daysBetween, reminderMessage, periodLabel, todayInMorocco } from '@/lib/reminders'

function intIn(v: FormDataEntryValue | null, min: number, max: number, fallback: number): number {
  const n = Number(v)
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback
}

/** Enregistre les réglages de relance du cabinet (owner ou staff). */
export async function saveReminderSettings(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Session expirée.' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()
  if (!profile?.organization_id || !['owner', 'staff'].includes(profile.role)) {
    return { success: false, error: 'Accès refusé.' }
  }

  const overdue = intIn(formData.get('overdue_days'), 1, 15, 3)
  const escalate = intIn(formData.get('escalate_days'), 2, 30, 7)
  if (escalate <= overdue) {
    return { success: false, error: 'L’alerte au cabinet doit venir après la relance de retard.' }
  }

  const { error } = await supabase.from('reminder_settings').upsert({
    organization_id: profile.organization_id,
    enabled: formData.get('enabled') === 'on',
    due_day: intIn(formData.get('due_day'), 1, 28, 10),
    before_days: intIn(formData.get('before_days'), 1, 15, 3),
    overdue_days: overdue,
    escalate_days: escalate,
    updated_at: new Date().toISOString(),
  })
  if (error) return { success: false, error: error.message }

  revalidatePath('/settings')
  return { success: true }
}

/** Met en pause / réactive les relances pour un client. */
export async function setClientRemindersPaused(clientId: string, paused: boolean) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Session expirée.' }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['owner', 'staff'].includes(profile.role)) {
    return { success: false, error: 'Accès refusé.' }
  }

  // La RLS « staff can manage clients » limite déjà au cabinet de l'utilisateur.
  const { error } = await supabase
    .from('clients')
    .update({ reminders_paused: paused })
    .eq('id', clientId)
  if (error) return { success: false, error: error.message }

  revalidatePath(`/clients/${clientId}`)
  return { success: true }
}

/* -------------------------------------------------------------------------- */
/*                 Suivi mensuel (/suivi) — actions du cabinet                 */
/* -------------------------------------------------------------------------- */


async function staffContext() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role, organizations(name)')
    .eq('id', user.id)
    .single()
  if (!profile?.organization_id || !['owner', 'staff'].includes(profile.role)) return null
  const org = Array.isArray(profile.organizations) ? profile.organizations[0] : profile.organizations
  return {
    supabase,
    userId: user.id,
    orgId: profile.organization_id as string,
    cabinetName: (org as { name?: string } | null)?.name || 'Votre cabinet',
  }
}

/** Crée la demande du mois pour tous les clients actifs qui n'en ont pas encore. */
export async function generateMonthlyRequests(): Promise<void> {
  const ctx = await staffContext()
  if (!ctx) return
  const { data: settings } = await ctx.supabase
    .from('reminder_settings')
    .select('due_day')
    .eq('organization_id', ctx.orgId)
    .maybeSingle()
  const p = currentPeriod(todayInMorocco(), settings?.due_day ?? 10)

  const [{ data: clients }, { data: existing }] = await Promise.all([
    ctx.supabase
      .from('clients')
      .select('id')
      .eq('organization_id', ctx.orgId)
      .eq('status', 'active')
      .is('deleted_at', null),
    ctx.supabase
      .from('document_requests')
      .select('client_id')
      .eq('organization_id', ctx.orgId)
      .eq('is_recurring', true)
      .eq('period', p.period),
  ])
  const have = new Set((existing || []).map((r) => r.client_id as string))
  const rows = (clients || [])
    .filter((c) => !have.has(c.id as string))
    .map((c) => ({
      organization_id: ctx.orgId,
      client_id: c.id,
      title: `Factures d’achat et de vente – ${p.label}`,
      description: `Merci de déposer toutes vos factures d’achat et de vente de ${p.label}.`,
      status: 'pending',
      category: 'piece_comptable',
      due_date: p.dueDate,
      created_by: ctx.userId,
      is_recurring: true,
      period: p.period,
    }))
  if (rows.length) await ctx.supabase.from('document_requests').insert(rows)
  revalidatePath('/suivi')
}

/** Envoie tout de suite un rappel dans l'espace Tiwizi du client. */
export async function relaunchNow(requestId: string): Promise<void> {
  const ctx = await staffContext()
  if (!ctx) return
  // Lecture via la session : la RLS garantit que la demande appartient au cabinet.
  const { data: req } = await ctx.supabase
    .from('document_requests')
    .select('id, client_id, period, due_date, reminder_stage, status, clients(profile_id)')
    .eq('id', requestId)
    .eq('organization_id', ctx.orgId)
    .single()
  if (!req || req.status !== 'pending' || !req.period || !req.due_date) return
  const client = Array.isArray(req.clients) ? req.clients[0] : req.clients
  const profileId = (client as { profile_id?: string | null } | null)?.profile_id
  if (!profileId) return

  const diff = daysBetween(todayInMorocco(), req.due_date as string)
  const stage = diff > 0 ? 4 : diff === 0 ? 3 : req.reminder_stage >= 1 ? 2 : 1
  const msg = reminderMessage(stage, {
    cabinetName: ctx.cabinetName,
    periodLabel: periodLabel(req.period as string),
    dueDate: req.due_date as string,
  })

  // Les notifications d'autrui ne sont insérables qu'avec la clé service (RLS).
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return
  const admin = createAdminClient(url, key, { auth: { persistSession: false } })
  const { error } = await admin.from('notifications').insert({
    organization_id: ctx.orgId,
    recipient_id: profileId,
    type: 'document_reminder',
    title: msg.title,
    body: msg.body,
    entity_type: 'document_request',
    entity_id: req.id,
  })
  await admin.from('reminder_log').insert({
    organization_id: ctx.orgId,
    client_id: req.client_id,
    request_id: req.id,
    stage,
    channel: 'in_app',
    recipient: profileId,
    ok: !error,
    error: error ? `manuel: ${error.message}` : 'manuel',
  })
  if (!error) {
    await admin
      .from('document_requests')
      .update({
        reminder_stage: Math.max(stage, req.reminder_stage as number),
        last_reminded_at: new Date().toISOString(),
      })
      .eq('id', req.id)
  }
  revalidatePath('/suivi')
}

/**
 * Le cabinet juge la demande :
 *  - 'pending'   = incomplet → les relances reprennent ;
 *  - 'processed' = complet, traité.
 */
export async function setRequestStatus(requestId: string, status: 'pending' | 'processed'): Promise<void> {
  const ctx = await staffContext()
  if (!ctx) return
  await ctx.supabase
    .from('document_requests')
    .update(status === 'pending' ? { status, escalated_at: null } : { status })
    .eq('id', requestId)
    .eq('organization_id', ctx.orgId)
  revalidatePath('/suivi')
}
