/**
 * Dossiers de documents : regroupe les catégories (enum document_category)
 * en dossiers affichés sous forme de cartes, côté cabinet et côté client.
 */

export type DocumentCategory =
  | 'piece_comptable'
  | 'facture_achat'
  | 'facture_vente'
  | 'releve_bancaire'
  | 'contrat'
  | 'statuts'
  | 'proces_verbal'
  | 'cin'
  | 'registre_commerce'
  | 'ice_if'
  | 'cnss'
  | 'tva'
  | 'is_ir'
  | 'autre'

/** Libellés lisibles des catégories (sous-dossiers du dossier « Juridique »). */
export const CATEGORY_LABEL: Record<DocumentCategory, string> = {
  piece_comptable: 'Pièce comptable',
  facture_achat: 'Facture d’achat',
  facture_vente: 'Facture de vente',
  releve_bancaire: 'Relevé bancaire',
  contrat: 'Contrat',
  statuts: 'Statuts',
  proces_verbal: 'PV / Procès-verbal',
  cin: 'CIN',
  registre_commerce: 'Registre de commerce',
  ice_if: 'ICE / IF',
  cnss: 'CNSS',
  tva: 'Déclaration TVA',
  is_ir: 'IS / IR',
  autre: 'Autre',
}

export type FolderKey =
  | 'achats'
  | 'ventes'
  | 'banque'
  | 'cnss'
  | 'tva'
  | 'is_ir'
  | 'pieces'
  | 'juridique'
  | 'autres'

export type Folder = {
  key: FolderKey
  label: string
  icon: string
  /** Catégories rangées dans ce dossier ; la première sert par défaut au dépôt. */
  categories: DocumentCategory[]
}

export const FOLDERS: Folder[] = [
  { key: 'achats', label: 'Factures d’achat', icon: '🧾', categories: ['facture_achat'] },
  { key: 'ventes', label: 'Factures de vente', icon: '📤', categories: ['facture_vente'] },
  { key: 'banque', label: 'Relevés bancaires', icon: '🏦', categories: ['releve_bancaire'] },
  { key: 'cnss', label: 'CNSS', icon: '👥', categories: ['cnss'] },
  { key: 'tva', label: 'TVA', icon: '📊', categories: ['tva'] },
  { key: 'is_ir', label: 'IS / IR', icon: '🏛️', categories: ['is_ir'] },
  { key: 'pieces', label: 'Pièces comptables', icon: '📎', categories: ['piece_comptable'] },
  {
    key: 'juridique',
    label: 'Juridique & administratif',
    icon: '📁',
    categories: ['statuts', 'proces_verbal', 'registre_commerce', 'ice_if', 'cin', 'contrat'],
  },
  { key: 'autres', label: 'Autres', icon: '🗂️', categories: ['autre'] },
]

export function folderOf(category: string | null | undefined): FolderKey {
  return FOLDERS.find((f) => f.categories.includes(category as DocumentCategory))?.key ?? 'autres'
}

export function findFolder(key: string | null | undefined): Folder | undefined {
  return FOLDERS.find((f) => f.key === key)
}

export type FolderSummary = Folder & {
  count: number
  toReview: number
  lastAt: string | null
}

/** Compte les documents par dossier (tous les dossiers, même vides). */
export function summarizeFolders(
  docs: Array<{ category: string | null; review_status?: string | null; created_at: string }>
): FolderSummary[] {
  return FOLDERS.map((f) => {
    const inFolder = docs.filter((d) => folderOf(d.category) === f.key)
    const lastAt = inFolder.reduce<string | null>(
      (max, d) => (!max || d.created_at > max ? d.created_at : max),
      null
    )
    return {
      ...f,
      count: inFolder.length,
      toReview: inFolder.filter((d) => d.review_status === 'pending_review').length,
      lastAt,
    }
  })
}
