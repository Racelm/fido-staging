import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import AppShell from '@/components/AppShell'
import EditClientForm from './EditClientForm'

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
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

  const { data: client } = await supabase
    .from('clients')
    .select(
      'id, company_name, contact_name, email, phone, address, website, status, ice, if_number, rc_number, cnss_number, patente_number, tva_period, fiscal_year_start'
    )
    .eq('id', id)
    .eq('organization_id', profile.organization_id)
    .is('deleted_at', null)
    .single()
  if (!client) notFound()

  return (
    <AppShell
      active="/clients"
      profile={profile}
      title={`Modifier · ${client.company_name}`}
      welcome="Mettez à jour les informations du dossier client"
    >
      <Link href={`/clients/${client.id}`} className="btn-ghost" style={{ marginBottom: 12 }}>
        ← Retour à la fiche client
      </Link>

      <section
        className="card card-padded"
        style={{ maxWidth: 720 }}
        data-testid="edit-client-section"
      >
        <h2 className="section-title">Informations du client</h2>
        <p className="muted" style={{ margin: '4px 0 16px' }}>
          Toutes les modifications sont enregistrées dans le journal d’audit.
        </p>
        <EditClientForm client={client} />
      </section>
    </AppShell>
  )
}
