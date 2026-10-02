import Link from 'next/link'
import { redirect } from 'next/navigation'
import { firstRel } from '@/lib/rel'
import { createClient } from '@/lib/supabase/server'
import AppShell from '@/components/AppShell'
import ClientForm from './ClientForm'

export default async function ClientsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role, organization_id, organizations(name)')
    .eq('id', user.id)
    .single()
  if (!profile || !['owner', 'staff'].includes(profile.role)) redirect('/')

  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, contact_name, email, status, ice, tva_period, created_at')
    .eq('organization_id', profile.organization_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  const statusPill = (s: string) =>
    s === 'active'
      ? { label: 'Actif', cls: 'pill-green' }
      : s === 'invited'
        ? { label: 'Invité', cls: 'pill-orange' }
        : { label: 'Inactif', cls: 'pill-gray' }

  return (
    <AppShell
      active="/clients"
      profile={profile}
      title="Dossiers clients"
      welcome={`${clients?.length || 0} dossier(s) actif(s)`}
    >
      <div className="content-grid">
        <section className="card card-padded">
          <h2 className="section-title">Ajouter un client</h2>
          <p className="muted" style={{ margin: '4px 0 16px' }}>
            Créez l’espace du client. L’invitation pourra être envoyée ensuite.
          </p>
          <ClientForm />
        </section>

        <section className="card">
          <div className="section-head">
            <div>
              <h2 className="section-title">Vos clients</h2>
              <p className="section-sub">{clients?.length || 0} dossier(s)</p>
            </div>
          </div>
          {clients?.length ? (
            clients.map((c) => {
              const pill = statusPill(c.status)
              return (
                <Link className="client-row" href={`/clients/${c.id}`} key={c.id}>
                  <div className="client-avatar">{c.company_name.charAt(0).toUpperCase()}</div>
                  <div className="client-info" style={{ flex: 1 }}>
                    <strong>{c.company_name}</strong>
                    <span>
                      {c.contact_name || c.email || 'Aucun contact'}
                      {c.ice ? ` · ICE ${c.ice}` : ''}
                    </span>
                  </div>
                  <span className={`pill ${pill.cls}`}>{pill.label}</span>
                </Link>
              )
            })
          ) : (
            <div className="empty-state">
              <strong>Aucun client</strong>
              <span>Ajoutez votre premier client avec le formulaire.</span>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  )
}
