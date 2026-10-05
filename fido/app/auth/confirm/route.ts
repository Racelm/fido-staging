import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Supabase Auth confirmation handler (OTP / magic-link / invite).
 *
 * Supabase redirects here after the user clicks the e-mail link :
 *   /auth/confirm?token_hash=XXX&type=invite|signup|recovery|magiclink&next=/invite/TOKEN
 *
 * We verify the OTP token with Supabase, then redirect to the `next` URL
 * (default : /).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as
    | 'signup'
    | 'invite'
    | 'magiclink'
    | 'recovery'
    | 'email_change'
    | null
  const next = searchParams.get('next') || '/'

  if (!token_hash || !type) {
    return NextResponse.redirect(`${origin}/login?error=missing-token`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ type, token_hash })
  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`
    )
  }

  return NextResponse.redirect(`${origin}${next}`)
}
