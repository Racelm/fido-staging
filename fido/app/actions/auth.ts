'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function signIn(formData: FormData) {
  const email = String(formData.get('email') || '').trim().toLowerCase()
  const password = String(formData.get('password') || '')
  const redirectTo = String(formData.get('redirect') || '').trim()

  if (!email || !password) return { error: 'E-mail et mot de passe requis.' }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { error: 'Identifiants invalides.' }

  // Détermine la cible en fonction du rôle
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user?.id ?? '')
    .maybeSingle()
  revalidatePath('/', 'layout')
  const target = redirectTo || (profile?.role === 'client' ? '/client' : '/')
  redirect(target)
}

export async function signUpCabinet(formData: FormData) {
  const email = String(formData.get('email') || '').trim().toLowerCase()
  const password = String(formData.get('password') || '')
  const fullName = String(formData.get('full_name') || '').trim()
  const cabinetName = String(formData.get('cabinet_name') || '').trim()

  if (!email || !password || !cabinetName) {
    return { error: 'Cabinet, e-mail et mot de passe sont obligatoires.' }
  }
  if (password.length < 8) return { error: 'Mot de passe : 8 caractères minimum.' }

  const supabase = await createClient()
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { cabinet_name: cabinetName, full_name: fullName },
    },
  })
  if (error) return { error: error.message }
  return { success: true }
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
