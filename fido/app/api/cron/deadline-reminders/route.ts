import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { deadlineReminderTemplate, sendEmail } from '@/lib/email'

/**
 * Cron : rappels J-7 des échéances fiscales.
 *
 * Vercel Cron poste sur cette route selon `vercel.json` (recommandé : 08:00 UTC).
 * Authentifié via `CRON_SECRET` (Bearer) — Vercel injecte automatiquement
 * l'en-tête `Authorization: Bearer <CRON_SECRET>` si la variable existe.
 *
 * Sécurité :
 *   - Utilise SUPABASE_SERVICE_ROLE_KEY (jamais exposée au client).
 *   - Idempotent : `reminded_at` est mis à jour, on ne re-notifie pas.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type DeadlineRow = {
  id: string
  organization_id: string
  client_id: string
  obligation: string
  period_label: string
  due_date: string
  reminded_at: string | null
  clients: {
    company_name: string
    contact_name: string | null
    email: string | null
  }
  organizations: {
    name: string
  }
}

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${secret}`) return unauthorized()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })
  }
  if (!process.env.EMERGENT_EMAIL_KEY) {
    return NextResponse.json({ error: 'EMERGENT_EMAIL_KEY not configured' }, { status: 500 })
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fido.local'
  const appName = process.env.EMAIL_FROM_NAME || 'Tiwizi'

  // Fenêtre : les échéances dues dans exactement 7 jours (aujourd'hui + 7)
  const today = new Date()
  const target = new Date(today)
  target.setUTCDate(target.getUTCDate() + 7)
  const targetIso = target.toISOString().slice(0, 10)

  const { data, error } = await admin
    .from('fiscal_deadlines')
    .select(
      'id, organization_id, client_id, obligation, period_label, due_date, reminded_at, clients!inner(company_name, contact_name, email), organizations!inner(name)'
    )
    .eq('status', 'pending')
    .eq('due_date', targetIso)
    .is('reminded_at', null)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data as unknown as DeadlineRow[]) || []
  let sentClient = 0
  let sentStaff = 0
  const errors: string[] = []

  for (const row of rows) {
    // 1. E-mail au client si adresse disponible
    if (row.clients.email) {
      try {
        const { subject, html } = deadlineReminderTemplate({
          recipientName: row.clients.contact_name || row.clients.company_name,
          clientCompany: row.clients.company_name,
          cabinetName: row.organizations.name,
          obligation: row.obligation,
          periodLabel: row.period_label,
          dueDate: row.due_date,
          appUrl: `${appUrl}/client`,
          appName,
          audience: 'client',
        })
        await sendEmail({ to: row.clients.email, subject, html })
        sentClient += 1
      } catch (err) {
        errors.push(`client ${row.id}: ${(err as Error).message}`)
      }
    }

    // 2. CC staff/owner du cabinet
    const { data: staff } = await admin
      .from('profiles')
      .select('id')
      .eq('organization_id', row.organization_id)
      .in('role', ['owner', 'staff'])
    if (staff?.length) {
      const { subject, html } = deadlineReminderTemplate({
        recipientName: 'l’équipe',
        clientCompany: row.clients.company_name,
        cabinetName: row.organizations.name,
        obligation: row.obligation,
        periodLabel: row.period_label,
        dueDate: row.due_date,
        appUrl: `${appUrl}/deadlines`,
        appName,
        audience: 'staff',
      })
      for (const s of staff) {
        try {
          const { data: authUser } = await admin.auth.admin.getUserById(s.id)
          const email = authUser?.user?.email
          if (email) {
            await sendEmail({ to: email, subject, html })
            sentStaff += 1
          }
        } catch (err) {
          errors.push(`staff ${s.id}: ${(err as Error).message}`)
        }
      }
    }

    // 3. Marquer comme rappelé (best-effort, on continue même si erreur)
    await admin
      .from('fiscal_deadlines')
      .update({ reminded_at: new Date().toISOString() })
      .eq('id', row.id)
  }

  return NextResponse.json({
    ok: true,
    processed: rows.length,
    reminders_sent: { client: sentClient, staff: sentStaff },
    errors,
    target_date: targetIso,
  })
}
