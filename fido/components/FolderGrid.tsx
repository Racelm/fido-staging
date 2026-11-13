import Link from 'next/link'
import type { FolderSummary } from '@/lib/document-folders'

/**
 * Grille de dossiers (cartes). Chaque carte ouvre le dossier via `?dossier=<clé>`.
 * `baseHref` = chemin de la page (ex. /clients/123), `anchor` = ancre de la section.
 */
export default function FolderGrid({
  folders,
  baseHref,
  anchor = 'documents',
  showReview = false,
}: {
  folders: FolderSummary[]
  baseHref: string
  anchor?: string
  showReview?: boolean
}) {
  return (
    <div className="folder-grid" data-testid="folder-grid">
      {folders.map((f) => (
        <Link
          key={f.key}
          href={`${baseHref}?dossier=${f.key}#${anchor}`}
          className={`folder-card${f.count === 0 ? ' is-empty' : ''}`}
          data-testid={`folder-${f.key}`}
          scroll={false}
        >
          <span className="folder-icon" aria-hidden>
            {f.icon}
          </span>
          <strong className="folder-name">{f.label}</strong>
          <span className="folder-meta">
            {f.count === 0
              ? 'Vide'
              : `${f.count} document${f.count > 1 ? 's' : ''}${
                  f.lastAt ? ` · ${new Date(f.lastAt).toLocaleDateString('fr-FR')}` : ''
                }`}
          </span>
          {showReview && f.toReview > 0 && (
            <span className="pill pill-orange folder-badge">{f.toReview} à vérifier</span>
          )}
        </Link>
      ))}
    </div>
  )
}
