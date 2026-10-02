'use server'

import { headers } from 'next/headers'
import { createHash } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'

export async function acceptStaffInvitation(rawToken: string, userName: string) {
  const h = await headers()
  const ip =
    h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown'
  const rl = rateLimit(`invite-staff:${ip}`, 10, 5 * 60 * 1000)
  if (!rl.allowed) {
    return { error: `Trop de tentatives, réessayez dans ${Math.ceil(rl.retryAfterMs / 1000)}s.` }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Session non initialisée.' }

  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const { data: orgId, error } = await supabase.rpc('claim_staff_invitation', {
    invitation_token_hash: tokenHash,
    user_name: userName,
  })
  if (error) return { error: error.message }
  return { success: true, orgId }
}
