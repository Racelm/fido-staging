import { redirect } from 'next/navigation'
import { firstRel } from '@/lib/rel'
import { createClient } from '@/lib/supabase/server'
import AppShell from '@/components/AppShell'

export default async function SettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name,role,organization_id,organizations(name)')
    .eq('id', user.id)
    .single()
  if (!profile) redirect('/login')

  const roleLabel =
    profile.role === 'owner'
      ? 'Propriétaire'
      : profile.role === 'staff'
        ? 'Collaborateur'
        : 'Client'

  return (
    <AppShell active="/settings" profile={profile} title="Paramètres" welcome="Compte et cabinet">
      <div className="content-grid">
        <section className="card card-padded">
          <h2 className="section-title">Compte</h2>
          <p className="muted" style={{ margin: '4px 0 16px' }}>Vos informations personnelles.</p>
          <div style={{ display: 'grid', gap: 10 }}>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Nom</div>
              <div style={{ fontWeight: 600 }}>{profile.full_name || '—'}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Rôle</div>
              <div><span className="pill pill-violet">{roleLabel}</span></div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>E-mail</div>
              <div style={{ fontWeight: 600 }}>{user.email || '—'}</div>
            </div>
          </div>
        </section>

        <section className="card card-padded">
          <h2 className="section-title">Cabinet</h2>
          <p className="muted" style={{ margin: '4px 0 16px' }}>Informations du cabinet et équipe.</p>
          <div style={{ display: 'grid', gap: 10 }}>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Nom du cabinet</div>
              <div style={{ fontWeight: 600 }}>{firstRel(profile.organizations)?.name || '—'}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Audit & sécurité</div>
              <div style={{ fontWeight: 600 }}>
                <span className="pill pill-green">Actif</span>{' '}
                <span className="muted" style={{ fontSize: 12 }}>
                  (loi 09-08, versioning docs, soft-delete)
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className="card card-padded" style={{ marginTop: 16 }}>
        <h2 className="section-title">À venir</h2>
        <p className="muted">
          Gestion des collaborateurs, 2FA, personnalisation des rappels et export loi 09-08
          arrivent dans les prochaines phases.
        </p>
      </section>
    </AppShell>
  )
}
