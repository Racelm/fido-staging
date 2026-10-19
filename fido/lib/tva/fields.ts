/**
 * Correspondance champs du relevé ↔ colonnes SQL + libellés UI.
 * Sans dépendance serveur : importable depuis les composants client.
 */
import type { ChampLigne } from './releve-deductions'

export const FIELD_COLUMN: Record<ChampLigne, string> = {
  numFacture: 'invoice_number',
  designation: 'designation',
  montantHT: 'amount_ht',
  montantTVA: 'amount_tva',
  montantTTC: 'amount_ttc',
  tauxTVA: 'tva_rate',
  'fournisseur.identifiantFiscal': 'supplier_if',
  'fournisseur.nom': 'supplier_name',
  'fournisseur.ice': 'supplier_ice',
  modePaiement: 'payment_mode',
  datePaiement: 'payment_date',
  dateFacture: 'invoice_date',
}

export const FIELD_LABEL: Record<ChampLigne, string> = {
  'fournisseur.nom': 'Fournisseur',
  'fournisseur.identifiantFiscal': 'IF fournisseur',
  'fournisseur.ice': 'ICE fournisseur',
  numFacture: 'N° facture',
  dateFacture: 'Date facture',
  designation: 'Désignation',
  montantHT: 'Montant HT',
  tauxTVA: 'Taux TVA (%)',
  montantTVA: 'Montant TVA',
  montantTTC: 'Montant TTC',
  modePaiement: 'Mode de paiement',
  datePaiement: 'Date de paiement',
}

/** Ordre d'affichage dans le formulaire de vérification */
export const FIELD_ORDER: ChampLigne[] = [
  'fournisseur.nom',
  'fournisseur.identifiantFiscal',
  'fournisseur.ice',
  'numFacture',
  'dateFacture',
  'designation',
  'montantHT',
  'tauxTVA',
  'montantTVA',
  'montantTTC',
  'modePaiement',
  'datePaiement',
]

/** Champs d'anomalie (controlerReleve) → champ de formulaire */
export const ANOMALY_FIELD: Record<string, ChampLigne | undefined> = {
  num: 'numFacture',
  des: 'designation',
  mht: 'montantHT',
  tva: 'montantTVA',
  ttc: 'montantTTC',
  tx: 'tauxTVA',
  'refF.if': 'fournisseur.identifiantFiscal',
  'refF.nom': 'fournisseur.nom',
  'refF.ice': 'fournisseur.ice',
  mp: 'modePaiement',
  dpai: 'datePaiement',
  dfac: 'dateFacture',
}

export const MODE_PAIEMENT_LABEL: Record<number, string> = {
  1: 'Espèces',
  2: 'Chèque',
  3: 'Prélèvement',
  4: 'Virement',
  5: 'Effets',
  6: 'Compensation',
}

export const TAUX_TVA = [7, 10, 14, 20]

export const SEUIL_CONFIANCE_UI = 0.95

/** Code stable d'un avertissement, utilisé pour l'acceptation explicite */
export const codeAvertissement = (x: { champ: string; message: string }) => `${x.champ}:${x.message}`

export function isChampLigne(v: string): v is ChampLigne {
  return v in FIELD_COLUMN
}
