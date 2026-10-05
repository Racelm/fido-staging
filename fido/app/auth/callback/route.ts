import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Supabase Auth PKCE callback.
 *
 * Lorsque Supabase envoie un e-mail d'invitation natif
 * (`admin.inviteUserByEmail`), le lien magique transite par
 * `https://xxxx.supabase.co/auth/v1/verify?...&redirect_to=OUR_URL`
 * puis Supabase redirige vers `redirect_to?code=<pkce_code>`.
 *
 * Ce handler échange ce `code` contre une vraie session (cookies),
 * puis redirige vers l'URL `next` (par défaut `/`).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') || '/'
  const errorParam = searchParams.get('error_description') || searchParams.get('error')

  if (errorParam) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(errorParam)}`
    )
  }
  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing-code`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`
    )
  }

  // Sécurité : on n'autorise que des redirections relatives internes
  // (rejette aussi //evil.com qui serait protocol-relative).
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/'
  return NextResponse.redirect(`${origin}${safeNext}`)
}
