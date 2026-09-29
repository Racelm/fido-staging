/**
 * Fido — Seed de test pour un cabinet fictif marocain.
 *
 * Prérequis :
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY (obligatoire — nécessite l'admin auth API)
 *
 * Usage :
 *   pnpm dlx tsx scripts/seed.ts
 *
 * Ce script est IDEMPOTENT sur la partie données (upsert par email).
 * L'auth user cabinet-owner est créé une seule fois — supprimez-le manuellement
 * dans Supabase Studio si vous devez rejouer.
 */

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis')
  process.exit(1)
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL || 'demo-cabinet@fido.local'
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD || 'Fido-Demo-2026!'
const CABINET_NAME = process.env.SEED_CABINET_NAME || 'Cabinet Atlas Comptabilité'
const OWNER_FULL_NAME = process.env.SEED_OWNER_FULL_NAME || 'Karim Bennani'

const CLIENTS = [
  {
    company_name: 'Atlas Distribution SARL',
    contact_name: 'Youssef Amrani',
    email: process.env.SEED_CLIENT1_EMAIL || 'atlas-demo@fido.local',
    phone: '+212 6 61 12 34 56',
    ice: '001234567000091',
    if_number: '12345678',
    rc_number: 'RC 45678 Casablanca',
    tva_period: 'trimestriel' as const,
  },
  {
    company_name: 'CasaTech Services',
    contact_name: 'Nadia El Mansouri',
    email: process.env.SEED_CLIENT2_EMAIL || 'casatech-demo@fido.local',
    phone: '+212 6 63 44 22 11',
    ice: '001987654000023',
    if_number: '87654321',
    tva_period: 'mensuel' as const,
  },
  {
    company_name: 'Rabat Conseil',
    contact_name: 'Omar Alaoui',
    email: process.env.SEED_CLIENT3_EMAIL || 'rabat-demo@fido.local',
    phone: '+212 5 37 22 33 44',
    ice: '000000876000045',
    tva_period: 'exonere' as const,
  },
]

const REQUEST_TEMPLATES = [
  { title: 'Relevé bancaire mensuel', category: 'releve_bancaire' as const },
  { title: 'Factures d’achat du mois', category: 'facture_achat' as const },
  { title: 'Factures de vente du mois', category: 'facture_vente' as const },
  { title: 'CIN du gérant (recto/verso)', category: 'cin' as const },
  { title: 'Statuts à jour', category: 'statuts' as const },
]

async function main() {
  console.log(`→ Cabinet : ${CABINET_NAME}`)

  // 1. Créer le compte owner si absent
  const list = await admin.auth.admin.listUsers()
  let ownerId: string | undefined = list.data.users.find((u) => u.email === OWNER_EMAIL)?.id
  if (!ownerId) {
    const { data, error } = await admin.auth.admin.createUser({
      email: OWNER_EMAIL,
      password: OWNER_PASSWORD,
      email_confirm: true,
      user_metadata: { cabinet_name: CABINET_NAME, full_name: OWNER_FULL_NAME },
    })
    if (error || !data.user) throw error || new Error('createUser failed')
    ownerId = data.user.id
    console.log(`  ✓ Owner créé : ${OWNER_EMAIL}`)
    // le trigger handle_new_cabinet_owner crée l'org+profil automatiquement.
    // On attend un tout petit peu pour laisser le trigger s'exécuter.
    await new Promise((r) => setTimeout(r, 500))
  } else {
    console.log(`  = Owner déjà existant : ${OWNER_EMAIL}`)
  }

  // 2. Récupérer l'organization_id de l'owner
  const { data: profile } = await admin
    .from('profiles')
    .select('id, organization_id, role')
    .eq('id', ownerId)
    .single()
  if (!profile?.organization_id) throw new Error('Profile owner incomplet — trigger cabinet raté')
  const orgId = profile.organization_id
  console.log(`  ✓ Organization : ${orgId}`)

  // 3. Upsert des clients
  for (const c of CLIENTS) {
    const { data: existing } = await admin
      .from('clients')
      .select('id')
      .eq('organization_id', orgId)
      .eq('email', c.email)
      .maybeSingle()

    let clientId: string
    if (existing) {
      clientId = existing.id
      console.log(`  = Client existant : ${c.company_name}`)
    } else {
      const { data, error } = await admin
        .from('clients')
        .insert({ ...c, organization_id: orgId, status: 'active' })
        .select('id')
        .single()
      if (error) throw error
      clientId = data.id
      console.log(`  ✓ Client créé : ${c.company_name}`)
    }

    // 4. Créer 5 demandes pour chaque client si aucune n'existe déjà
    const { count } = await admin
      .from('document_requests')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
    if ((count ?? 0) === 0) {
      const dueBase = new Date()
      dueBase.setDate(dueBase.getDate() + 15)
      const rows = REQUEST_TEMPLATES.map((t, i) => ({
        organization_id: orgId,
        client_id: clientId,
        title: t.title,
        category: t.category,
        status: 'pending' as const,
        due_date: new Date(dueBase.getTime() + i * 86400000).toISOString().slice(0, 10),
        created_by: ownerId!,
      }))
      const { error: reqErr } = await admin.from('document_requests').insert(rows)
      if (reqErr) throw reqErr
      console.log(`    ✓ 5 demandes créées`)
    }

    // 5. Générer les échéances fiscales de l'année en cours
    const { data: generated, error: genErr } = await admin.rpc(
      'generate_fiscal_deadlines_for_client',
      { target_client: clientId, year_ref: new Date().getFullYear() }
    )
    if (genErr) {
      console.warn(`    ⚠ Génération échéances échouée : ${genErr.message}`)
    } else if ((generated ?? 0) > 0) {
      console.log(`    ✓ ${generated} échéances fiscales générées`)
    }
  }

  console.log('\n✅ Seed terminé.')
  console.log(`   Login owner : ${OWNER_EMAIL}  /  ${OWNER_PASSWORD}`)
}

main().catch((err) => {
  console.error('❌ Seed error:', err)
  process.exit(1)
})
