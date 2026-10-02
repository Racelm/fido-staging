import { redirect } from 'next/navigation'
import { firstRel } from '@/lib/rel'
import { createClient } from '@/lib/supabase/server'
import AppShell from '@/components/AppShell'
import InviteStaffForm from './InviteStaffForm'
import RevokeButton from './RevokeButton'

export default async function TeamPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role, organization_id, organizations(name)')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile || !['owner', 'staff'].includes(profile.role)) redirect('/')

  const isOwner = profile.role === 'owner'

  const [{ data: members }, { data: invitations }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('organization_id', profile.organization_id)
      .in('role', ['owner', 'staff'])
      .order('role', { ascending: true }),
    supabase
      .from('staff_invitations')
      .select('id, email, full_name, created_at, expires_at, accepted_at, invited_by, profiles!invited_by(full_name)')
      .eq('organization_id', profile.organization_id)
      .is('accepted_at', null)
      .order('created_at', { ascending: false }),
  ])

  return (
    <AppShell
      active="/team"
      profile={profile}
      title="Collaborateurs du cabinet"
      welcome={`${members?.length || 0} membre(s) actif(s)`}
    >
      <div className="content-grid">
        <section className="card card-padded">
          <h2 className="section-title">Inviter un collaborateur</h2>
          <p className="muted" style={{ margin: '4px 0 16px' }}>
            Il recevra un e-mail pour activer son compte Fido avec un rôle «&nbsp;collaborateur&nbsp»
            (accès complet aux clients et aux documents du cabinet).
          </p>
          {isOwner ? (
            <InviteStaffForm />
          ) : (
            <div className="auth-notice">
              Seul le propriétaire du cabinet peut inviter de nouveaux collaborateurs.
            </div>
          )}
        </section>

        <section className="card">
          <div className="section-head">
            <div>
              <h2 className="section-title">Membres</h2>
              <p className="section-sub">{members?.length || 0} membre(s)</p>
            </div>
          </div>
          {members?.length ? (
            members.map((m) => (
              <div className="client-row" key={m.id}>
                <div className="client-avatar">
                  {(m.full_name || '?').charAt(0).toUpperCase()}
                </div>
                <div className="client-info" style={{ flex: 1 }}>
                  <strong>{m.full_name || 'Membre'}</strong>
                  <span>{m.id === user.id ? 'Vous' : m.role === 'owner' ? 'Propriétaire' : 'Collaborateur'}</span>
                </div>
                <span className={`pill ${m.role === 'owner' ? 'pill-violet' : 'pill-blue'}`}>
                  {m.role === 'owner' ? 'Propriétaire' : 'Collaborateur'}
                </span>
              </div>
            ))
          ) : (
            <div className="empty-state">
              <strong>Aucun membre</strong>
              <span>Invitez votre premier collaborateur à gauche.</span>
            </div>
          )}
        </section>
      </div>

      {invitations && invitations.length > 0 && (
        <section className="card" style={{ marginTop: 16 }}>
          <div className="section-head">
            <div>
              <h2 className="section-title">Invitations en attente</h2>
              <p className="section-sub">{invitations.length} en attente d’activation</p>
            </div>
          </div>
          <table className="audit-table">
            <thead>
              <tr>
                <th>E-mail</th>
                <th>Nom</th>
                <th>Invité par</th>
                <th>Expire</th>
                {isOwner && <th></th>}
              </tr>
            </thead>
            <tbody>
              {invitations.map((inv) => (
                <tr key={inv.id}>
                  <td style={{ fontWeight: 600 }}>{inv.email}</td>
                  <td>{inv.full_name || '—'}</td>
                  <td>{firstRel(inv.profiles)?.full_name || '—'}</td>
                  <td>{new Date(inv.expires_at).toLocaleDateString('fr-FR')}</td>
                  {isOwner && (
                    <td style={{ textAlign: 'right' }}>
                      <RevokeButton invitationId={inv.id} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </AppShell>
  )
}
