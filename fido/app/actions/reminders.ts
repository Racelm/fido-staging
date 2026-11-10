'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

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
