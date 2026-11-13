import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  currentPeriod,
  nextAction,
  periodLabel,
  reminderMessage,
  todayInMorocco,
  weekdayInMorocco,
  type ReminderSettings,
} from '@/lib/reminders'

/**
 * Cron : relances automatiques des documents manquants (migration 011).
 *
 * À appeler une fois par jour (recommandé : 09:00 heure du Maroc) :
 *   GET /api/cron/document-reminders
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Sur Hostinger : Tâches cron →
 *   curl -s -H "Authorization: Bearer $CRON_SECRET" https://<domaine>/api/cron/document-reminders
 *
 * Paramètre optionnel `?dry=1` : calcule tout, n'écrit et n'envoie rien.
 *
 * Les rappels sont délivrés DANS Tiwizi (table `notifications` + bandeau dans
 * l'espace client). Aucun e-mail n'est envoyé.
 *
 * Étapes, pour chaque cabinet dont les relances sont activées :
 *   1. Crée la demande mensuelle « Factures d'achat et de vente – <mois> »
 *      pour chaque client actif (idempotent : index unique client+période).
 *   2. Pour chaque demande récurrente encore 'pending', crée au plus UNE
 *      notification par client et par jour, selon le palier atteint.
 *   3. Après `escalate_days` jours de retard : plus de rappel au client,
 *      notification « À appeler » aux owners/staff du cabinet.
 * Aucun rappel le samedi et le dimanche.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ClientRow = { id: string; company_name: string; contact_name: string | null }

type RequestRow = {
  id: string
  organization_id: string
  client_id: string
  period: string
  due_date: string
  reminder_stage: number
  escalated_at: string | null
  clients: {
    company_name: string
    contact_name: string | null
    profile_id: string | null
    reminders_paused: boolean
    status: string
  }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })

  const dry = req.nextUrl.searchParams.get('dry') === '1'
  const now = new Date()
  const today = todayInMorocco(now)
  const weekday = weekdayInMorocco(now)
  if (!dry && (weekday === 0 || weekday === 6)) {
    return NextResponse.json({ ok: true, skipped: 'weekend', today })
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: settingsRows, error: settingsErr } = await admin
    .from('reminder_settings')
    .select('organization_id, enabled, due_day, before_days, overdue_days, escalate_days')
    .eq('enabled', true)
  if (settingsErr) return NextResponse.json({ error: settingsErr.message }, { status: 500 })

  const report = {
    ok: true,
    today,
    dry,
    organizations: 0,
    requests_created: 0,
    client_reminders: 0,
    escalations: 0,
    planned: [] as Array<{ request: string; client: string; action: string }>,
    errors: [] as string[],
  }

  for (const settings of (settingsRows || []) as ReminderSettings[]) {
    report.organizations += 1
    try {
      await processOrganization(admin, settings, { today, dry, report })
    } catch (err) {
      report.errors.push(`org ${settings.organization_id}: ${(err as Error).message}`)
    }
  }

  return NextResponse.json(report)
}

async function processOrganization(
  admin: SupabaseClient,
  settings: ReminderSettings,
  ctx: {
    today: string
    dry: boolean
    report: {
      requests_created: number
      client_reminders: number
      escalations: number
      planned: Array<{ request: string; client: string; action: string }>
      errors: string[]
    }
  }
) {
  const orgId = settings.organization_id
  const { report } = ctx

  const { data: org } = await admin.from('organizations').select('name').eq('id', orgId).single()
  const cabinetName = (org?.name as string) || 'Votre cabinet'

  // --- 1. Créer les demandes du mois ------------------------------------
  const p = currentPeriod(ctx.today, settings.due_day)

  const { data: owner } = await admin
    .from('profiles')
    .select('id')
    .eq('organization_id', orgId)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle()

  if (owner) {
    const { data: clients } = await admin
      .from('clients')
      .select('id, company_name, contact_name')
      .eq('organization_id', orgId)
      .eq('status', 'active')
      .eq('reminders_paused', false)
      .is('deleted_at', null)

    const { data: existing } = await admin
      .from('document_requests')
      .select('client_id')
      .eq('organization_id', orgId)
      .eq('is_recurring', true)
      .eq('period', p.period)
    const have = new Set((existing || []).map((r) => r.client_id as string))

    const missing = ((clients || []) as ClientRow[]).filter((c) => !have.has(c.id))
    if (missing.length && !ctx.dry) {
      const rows = missing.map((c) => ({
        organization_id: orgId,
        client_id: c.id,
        title: `Factures d’achat et de vente – ${p.label}`,
        description: `Merci de déposer toutes vos factures d’achat et de vente de ${p.label}.`,
        status: 'pending',
        category: 'piece_comptable',
        due_date: p.dueDate,
        created_by: owner.id,
        is_recurring: true,
        period: p.period,
      }))
      const { error } = await admin.from('document_requests').insert(rows)
      // 23505 = un autre run a créé la même demande entre-temps : sans gravité
      if (error && error.code !== '23505') report.errors.push(`create ${orgId}: ${error.message}`)
      else if (!error) report.requests_created += rows.length
    } else if (ctx.dry) {
      report.requests_created += missing.length
    }
  }

  // --- 2. Relancer les demandes en attente --------------------------------
  const { data: pending, error: pendErr } = await admin
    .from('document_requests')
    .select(
      'id, organization_id, client_id, period, due_date, reminder_stage, escalated_at, clients!inner(company_name, contact_name, profile_id, reminders_paused, status)'
    )
    .eq('organization_id', orgId)
    .eq('is_recurring', true)
    .eq('status', 'pending')
    .not('due_date', 'is', null)
  if (pendErr) throw new Error(pendErr.message)

  for (const r of (pending || []) as unknown as RequestRow[]) {
    if (r.clients.reminders_paused || r.clients.status !== 'active') continue

    const action = nextAction({
      today: ctx.today,
      dueDate: r.due_date,
      currentStage: r.reminder_stage,
      escalatedAt: r.escalated_at,
      settings,
    })
    if (action.kind === 'none') continue

    const label = periodLabel(r.period)
    report.planned.push({
      request: r.id,
      client: r.clients.company_name,
      action: action.kind === 'client' ? `relance ${action.stage}` : 'alerte cabinet',
    })
    if (ctx.dry) continue

    if (action.kind === 'client') {
      // Le client n'a pas encore activé son compte Tiwizi : rien à afficher.
      if (!r.clients.profile_id) {
        await log(admin, r, action.stage, null, false, 'client sans compte Tiwizi')
        continue
      }
      const msg = reminderMessage(action.stage, { cabinetName, periodLabel: label, dueDate: r.due_date })
      const { error: notifErr } = await admin.from('notifications').insert({
        organization_id: orgId,
        recipient_id: r.clients.profile_id,
        type: 'document_reminder',
        title: msg.title,
        body: msg.body,
        entity_type: 'document_request',
        entity_id: r.id,
      })
      await log(admin, r, action.stage, r.clients.profile_id, !notifErr, notifErr?.message)
      if (notifErr) {
        report.errors.push(`notify ${r.id}: ${notifErr.message}`)
        continue
      }
      await admin
        .from('document_requests')
        .update({ reminder_stage: action.stage, last_reminded_at: new Date().toISOString() })
        .eq('id', r.id)
        .eq('status', 'pending') // ne rien écraser si le client vient de déposer
      report.client_reminders += 1
      continue
    }

    // --- 3. Alerte cabinet -------------------------------------------------
    const { data: staff } = await admin
      .from('profiles')
      .select('id')
      .eq('organization_id', orgId)
      .in('role', ['owner', 'staff'])
    if (staff?.length) {
      const { error: escErr } = await admin.from('notifications').insert(
        staff.map((s) => ({
          organization_id: orgId,
          recipient_id: s.id,
          type: 'reminder_escalation',
          title: `À appeler : ${r.clients.company_name}`,
          body: `Documents de ${label} toujours manquants après ${r.reminder_stage} rappel(s) dans Tiwizi.`,
          entity_type: 'document_request',
          entity_id: r.id,
        }))
      )
      await log(admin, r, 5, null, !escErr, escErr?.message)
      if (escErr) {
        report.errors.push(`escalate ${r.id}: ${escErr.message}`)
        continue
      }
    }
    await admin.from('document_requests').update({ escalated_at: new Date().toISOString() }).eq('id', r.id)
    report.escalations += 1
  }
}

async function log(
  admin: SupabaseClient,
  r: RequestRow,
  stage: number,
  recipient: string | null,
  ok: boolean,
  error?: string
) {
  await admin.from('reminder_log').insert({
    organization_id: r.organization_id,
    client_id: r.client_id,
    request_id: r.id,
    stage,
    channel: 'in_app',
    recipient,
    ok,
    error: error || null,
  })
}
