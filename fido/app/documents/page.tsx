import { redirect } from 'next/navigation'
import { firstRel } from '@/lib/rel'
import { createClient } from '@/lib/supabase/server'
import AppShell from '@/components/AppShell'
import DownloadButton from './DownloadButton'
import ReviewBadge from './ReviewBadge'
import ReviewButtons from './ReviewButtons'

const CATEGORY_LABEL: Record<string, string> = {
  piece_comptable: 'Pièce comptable',
  facture_achat: 'Facture achat',
  facture_vente: 'Facture vente',
  releve_bancaire: 'Relevé bancaire',
  contrat: 'Contrat',
  statuts: 'Statuts',
  proces_verbal: 'PV',
  cin: 'CIN',
  registre_commerce: 'RC',
  ice_if: 'ICE/IF',
  cnss: 'CNSS',
  tva: 'TVA',
  is_ir: 'IS/IR',
  autre: 'Autre',
}

export default async function DocumentsPage() {
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
  if (!profile || !['owner', 'staff'].includes(profile.role)) redirect('/')

  const { data: documents } = await supabase
    .from('documents')
    .select('id,name,mime_type,size_bytes,category,version,review_status,created_at,clients(company_name)')
    .eq('organization_id', profile.organization_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(100)

  const pendingCount = documents?.filter((d) => d.review_status === 'pending_review').length || 0

  return (
    <AppShell
      active="/documents"
      profile={profile}
      title="Documents"
      welcome={
        pendingCount > 0
          ? `${pendingCount} document(s) à vérifier`
          : 'Tous les fichiers partagés avec vos clients'
      }
    >
      <section className="card">
        <div className="section-head">
          <div>
            <h2 className="section-title">Documents reçus</h2>
            <p className="section-sub">{documents?.length || 0} fichier(s)</p>
          </div>
        </div>

        {documents?.length ? (
          <table className="audit-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Client</th>
                <th>Catégorie</th>
                <th>Statut</th>
                <th>Version</th>
                <th>Taille</th>
                <th>Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.id}>
                  <td style={{ fontWeight: 600 }}>{d.name}</td>
                  <td>{firstRel(d.clients)?.company_name || '—'}</td>
                  <td>
                    <span className="pill pill-violet">
                      {CATEGORY_LABEL[d.category as string] || d.category}
                    </span>
                  </td>
                  <td><ReviewBadge status={d.review_status as string} size="sm" /></td>
                  <td>v{d.version ?? 1}</td>
                  <td>{d.size_bytes ? `${Math.round(d.size_bytes / 1024)} Ko` : '—'}</td>
                  <td>{new Date(d.created_at).toLocaleDateString('fr-FR')}</td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      <ReviewButtons
                        documentId={d.id}
                        currentStatus={(d.review_status as 'pending_review' | 'approved' | 'rejected') || 'pending_review'}
                        compact
                      />
                      <DownloadButton documentId={d.id} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">
            <strong>Aucun document</strong>
            <span>Les documents de vos clients apparaîtront ici.</span>
          </div>
        )}
      </section>
    </AppShell>
  )
}
