/**
 * Tiwizi – Phase 1 : Relevé des déductions TVA (SIMPL-TVA, mode EDI)
 *
 * Génère le fichier XML du relevé des déductions + l'archive .zip à déposer
 * par le fiduciaire dans SIMPL-TVA (menu « Envoi EDI », profil « Rédacteur »).
 *
 * Structure basée sur le cahier des charges EDI SIMPL-TVA (DGI) :
 *   DeclarationReleveDeduction
 *     identifiantFiscal, annee, periode, regime
 *     releveDeductions
 *       rd*: ord, num, des, mht, tva, ttc, refF{if,nom,ice}, tx, prorata, mp{id}, dpai, dfac
 *
 * ⚠️ Avant mise en production : télécharger la dernière version du cahier des
 * charges + XML d'exemple sur tax.gov.ma et vérifier l'ordre/les balises.
 * La version utilisée est tracée dans SPEC_VERSION.
 *
 * Sans dépendance externe (ZIP écrit par ./zip). À utiliser côté serveur uniquement.
 */
import { createZip } from "./zip";
import { codeAvertissement } from "./fields";
import { createHash } from "node:crypto";

export const SPEC_VERSION = "SIMPL-TVA RD v2 (ord,num,des,mht,tva,ttc,refF,tx,prorata,mp,dpai,dfac)";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** 1 = mensuel, 2 = trimestriel */
export type RegimeTva = 1 | 2;

/** Codes mode de paiement DGI */
export enum ModePaiement {
  Especes = 1,
  Cheque = 2,
  Prelevement = 3,
  Virement = 4,
  Effets = 5,
  Compensation = 6,
}

export const TAUX_TVA_AUTORISES = [7, 10, 14, 20] as const;

export interface EnteteReleve {
  /** IF du contribuable (client du fiduciaire) */
  identifiantFiscal: string;
  annee: number;
  /** 1–12 si mensuel, 1–4 si trimestriel */
  periode: number;
  regime: RegimeTva;
}

export interface Fournisseur {
  identifiantFiscal: string;
  nom: string;
  /** ICE : 15 chiffres */
  ice: string;
}

export interface LigneDeduction {
  numFacture: string;
  designation: string;
  montantHT: number;
  montantTVA: number;
  montantTTC: number;
  tauxTVA: number;
  /** % de déduction (100 par défaut) */
  prorata?: number;
  fournisseur: Fournisseur;
  modePaiement: ModePaiement;
  /** AAAA-MM-JJ */
  datePaiement: string;
  /** AAAA-MM-JJ */
  dateFacture: string;
  /** Origine des données (lecture PDF / OCR) */
  extraction?: Extraction;
  /** Validation humaine par le fiduciaire */
  validation?: Validation;
}

/** Champs contrôlables d'une ligne (pour la confiance d'extraction) */
export type ChampLigne =
  | "numFacture" | "designation" | "montantHT" | "montantTVA" | "montantTTC" | "tauxTVA"
  | "fournisseur.identifiantFiscal" | "fournisseur.nom" | "fournisseur.ice"
  | "modePaiement" | "datePaiement" | "dateFacture";

export interface Extraction {
  /** Référence du PDF source dans le stockage Tiwizi */
  pdfId: string;
  /** Confiance 0–1 par champ lu automatiquement ; champ absent = saisi à la main */
  confiance: Partial<Record<ChampLigne, number>>;
  /** Champs déjà vérifiés/corrigés à la main par le fiduciaire */
  champsConfirmes?: ChampLigne[];
}

export interface Validation {
  validePar: string; // id utilisateur du fiduciaire
  valideLe: string; // ISO
  /** Empreinte des données au moment de la validation */
  empreinte: string;
  /** Codes d'avertissement acceptés explicitement (voir codeAvertissement) */
  avertissementsAcceptes: string[];
}

/** Seuil sous lequel un champ lu du PDF doit être confirmé à la main */
export const SEUIL_CONFIANCE = 0.95;

export interface Anomalie {
  niveau: "erreur" | "avertissement";
  ligne?: number; // index 1-based dans le relevé
  champ: string;
  message: string;
}

/* ------------------------------------------------------------------ */
/* Contrôles                                                           */
/* ------------------------------------------------------------------ */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const round2 = (n: number) => Math.round(n * 100) / 100;

function bornesPeriode(e: EnteteReleve): { debut: string; fin: string } {
  const moisDebut = e.regime === 1 ? e.periode : (e.periode - 1) * 3 + 1;
  const moisFin = e.regime === 1 ? e.periode : moisDebut + 2;
  const pad = (n: number) => String(n).padStart(2, "0");
  const dernierJour = new Date(Date.UTC(e.annee, moisFin, 0)).getUTCDate();
  return {
    debut: `${e.annee}-${pad(moisDebut)}-01`,
    fin: `${e.annee}-${pad(moisFin)}-${pad(dernierJour)}`,
  };
}

export function controlerReleve(entete: EnteteReleve, lignes: LigneDeduction[]): Anomalie[] {
  const a: Anomalie[] = [];
  const err = (champ: string, message: string, ligne?: number) =>
    a.push({ niveau: "erreur", champ, message, ligne });
  const warn = (champ: string, message: string, ligne?: number) =>
    a.push({ niveau: "avertissement", champ, message, ligne });

  // En-tête
  if (!/^\d{1,15}$/.test(entete.identifiantFiscal)) err("identifiantFiscal", "IF du contribuable invalide (chiffres uniquement)");
  if (entete.annee < 2000 || entete.annee > 2100) err("annee", "Année invalide");
  if (entete.regime !== 1 && entete.regime !== 2) err("regime", "Régime doit être 1 (mensuel) ou 2 (trimestriel)");
  const maxPeriode = entete.regime === 1 ? 12 : 4;
  if (!Number.isInteger(entete.periode) || entete.periode < 1 || entete.periode > maxPeriode)
    err("periode", `Période doit être entre 1 et ${maxPeriode}`);
  if (lignes.length === 0) warn("releveDeductions", "Aucune ligne de déduction pour cette période");

  const { debut, fin } = bornesPeriode(entete);
  const doublons = new Set<string>();

  lignes.forEach((l, i) => {
    const n = i + 1;
    if (!l.numFacture?.trim()) err("num", "Numéro de facture manquant", n);
    if (!l.designation?.trim()) err("des", "Désignation manquante", n);

    // Fournisseur
    if (!/^\d{1,15}$/.test(l.fournisseur.identifiantFiscal)) err("refF.if", "IF fournisseur invalide", n);
    if (!/^\d{15}$/.test(l.fournisseur.ice)) err("refF.ice", "ICE fournisseur doit contenir 15 chiffres", n);
    if (!l.fournisseur.nom?.trim()) err("refF.nom", "Nom fournisseur manquant", n);

    // Montants
    if (!(l.montantHT > 0)) err("mht", "Montant HT doit être > 0", n);
    if (!TAUX_TVA_AUTORISES.includes(l.tauxTVA as (typeof TAUX_TVA_AUTORISES)[number]))
      err("tx", `Taux TVA ${l.tauxTVA}% non autorisé`, n);
    if (Math.abs(round2(l.montantHT + l.montantTVA) - round2(l.montantTTC)) > 0.01)
      err("ttc", "TTC ≠ HT + TVA", n);
    const tvaTheorique = round2((l.montantHT * l.tauxTVA) / 100);
    if (Math.abs(tvaTheorique - round2(l.montantTVA)) > 1)
      warn("tva", `TVA (${l.montantTVA}) diffère de HT × taux (${tvaTheorique})`, n);
    const prorata = l.prorata ?? 100;
    if (prorata <= 0 || prorata > 100) err("prorata", "Prorata doit être entre 0 et 100", n);

    // Paiement & dates
    if (!Object.values(ModePaiement).includes(l.modePaiement)) err("mp", "Mode de paiement invalide", n);
    if (!DATE_RE.test(l.datePaiement)) err("dpai", "Date de paiement manquante ou invalide (AAAA-MM-JJ)", n);
    if (!DATE_RE.test(l.dateFacture)) err("dfac", "Date de facture invalide (AAAA-MM-JJ)", n);
    if (DATE_RE.test(l.datePaiement) && (l.datePaiement < debut || l.datePaiement > fin))
      warn("dpai", `Paiement hors période déclarée (${debut} → ${fin}) : déduction à vérifier`, n);
    if (l.modePaiement === ModePaiement.Especes && l.montantTTC > 5000)
      warn("mp", "Paiement en espèces > 5 000 DH : vérifier la déductibilité", n);

    const cle = `${l.fournisseur.identifiantFiscal}|${l.numFacture.trim()}`;
    if (doublons.has(cle)) warn("num", "Facture en double (même fournisseur, même numéro)", n);
    doublons.add(cle);

    // Lecture PDF : tout champ lu avec une confiance insuffisante doit être confirmé à la main
    if (l.extraction) {
      const confirmes = new Set(l.extraction.champsConfirmes ?? []);
      for (const [champ, c] of Object.entries(l.extraction.confiance) as [ChampLigne, number][]) {
        if (c < SEUIL_CONFIANCE && !confirmes.has(champ))
          err(champ, `Lu sur le PDF avec une confiance de ${Math.round(c * 100)} % : à vérifier et confirmer`, n);
      }
    }
  });

  return a;
}

/* ------------------------------------------------------------------ */
/* Validation par le fiduciaire                                        */
/* ------------------------------------------------------------------ */

/** Code stable d'un avertissement, utilisé pour l'acceptation explicite (défini dans ./fields, sûr côté client) */
export { codeAvertissement };

/** Empreinte des données fiscales d'une ligne (hors extraction/validation) */
export function empreinteLigne(l: LigneDeduction): string {
  const donnees = [
    l.numFacture.trim(), l.designation.trim(), round2(l.montantHT), round2(l.montantTVA), round2(l.montantTTC),
    l.tauxTVA, l.prorata ?? 100, l.fournisseur.identifiantFiscal, l.fournisseur.nom.trim(), l.fournisseur.ice,
    l.modePaiement, l.datePaiement, l.dateFacture,
  ];
  return createHash("sha256").update(JSON.stringify(donnees)).digest("hex");
}

/**
 * Le fiduciaire valide une ligne. Refusé s'il reste une erreur ou un
 * avertissement non accepté explicitement.
 */
export function validerLigne(
  entete: EnteteReleve,
  toutesLesLignes: LigneDeduction[],
  index: number,
  utilisateurId: string,
  avertissementsAcceptes: string[] = []
): { ok: true; ligne: LigneDeduction } | { ok: false; anomalies: Anomalie[] } {
  const anomalies = controlerReleve(entete, toutesLesLignes).filter((x) => x.ligne === index + 1);
  const acceptes = new Set(avertissementsAcceptes);
  const bloquantes = anomalies.filter(
    (x) => x.niveau === "erreur" || !acceptes.has(codeAvertissement(x))
  );
  if (bloquantes.length) return { ok: false, anomalies: bloquantes };

  const ligne = toutesLesLignes[index];
  return {
    ok: true,
    ligne: {
      ...ligne,
      validation: {
        validePar: utilisateurId,
        valideLe: new Date().toISOString(),
        empreinte: empreinteLigne(ligne),
        avertissementsAcceptes: [...acceptes],
      },
    },
  };
}

/** Une ligne est exportable si elle est validée ET n'a pas changé depuis */
export function estValidee(l: LigneDeduction): boolean {
  return !!l.validation && l.validation.empreinte === empreinteLigne(l);
}

/* ------------------------------------------------------------------ */
/* Génération XML                                                      */
/* ------------------------------------------------------------------ */

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const m = (n: number) => round2(n).toFixed(2);

export function genererXml(entete: EnteteReleve, lignes: LigneDeduction[]): string {
  const rds = lignes
    .map(
      (l, i) => `    <rd>
      <ord>${i + 1}</ord>
      <num>${esc(l.numFacture.trim())}</num>
      <des>${esc(l.designation.trim())}</des>
      <mht>${m(l.montantHT)}</mht>
      <tva>${m(l.montantTVA)}</tva>
      <ttc>${m(l.montantTTC)}</ttc>
      <refF>
        <if>${esc(l.fournisseur.identifiantFiscal)}</if>
        <nom>${esc(l.fournisseur.nom.trim())}</nom>
        <ice>${esc(l.fournisseur.ice)}</ice>
      </refF>
      <tx>${m(l.tauxTVA)}</tx>
      <prorata>${m(l.prorata ?? 100)}</prorata>
      <mp>
        <id>${l.modePaiement}</id>
      </mp>
      <dpai>${l.datePaiement}</dpai>
      <dfac>${l.dateFacture}</dfac>
    </rd>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<DeclarationReleveDeduction>
  <identifiantFiscal>${esc(entete.identifiantFiscal)}</identifiantFiscal>
  <annee>${entete.annee}</annee>
  <periode>${entete.periode}</periode>
  <regime>${entete.regime}</regime>
  <releveDeductions>
${rds}
  </releveDeductions>
</DeclarationReleveDeduction>
`;
}

export function nomFichier(e: EnteteReleve): string {
  const p = e.regime === 1 ? `M${String(e.periode).padStart(2, "0")}` : `T${e.periode}`;
  return `RD_${e.identifiantFiscal}_${e.annee}_${p}`;
}

export interface ResultatExport {
  ok: boolean;
  anomalies: Anomalie[];
  nomZip?: string;
  zip?: Uint8Array;
  xml?: string;
  /** SHA-256 du XML exporté, à archiver (piste d'audit) */
  empreinteXml?: string;
}

/** Tout ce qui empêche l'export (lignes non validées/modifiées, erreurs, avertissements non acceptés) */
export function anomaliesBloquantes(entete: EnteteReleve, lignes: LigneDeduction[]): Anomalie[] {
  const anomalies = controlerReleve(entete, lignes);
  const bloquantes: Anomalie[] = [];

  lignes.forEach((l, i) => {
    if (!l.validation)
      bloquantes.push({ niveau: "erreur", ligne: i + 1, champ: "validation", message: "Ligne non validée par le fiduciaire" });
    else if (!estValidee(l))
      bloquantes.push({ niveau: "erreur", ligne: i + 1, champ: "validation", message: "Données modifiées après validation : à revalider" });
  });

  for (const x of anomalies) {
    if (x.niveau === "erreur") bloquantes.push(x);
    else {
      const acceptes = x.ligne ? lignes[x.ligne - 1]?.validation?.avertissementsAcceptes ?? [] : [];
      if (!acceptes.includes(codeAvertissement(x))) bloquantes.push(x);
    }
  }
  return bloquantes;
}

/**
 * Contrôle → XML → ZIP. Export refusé tant que :
 *  - une ligne n'est pas validée par le fiduciaire, ou a été modifiée depuis ;
 *  - il reste une erreur ;
 *  - un avertissement n'a pas été accepté explicitement lors de la validation.
 */
export async function exporterReleve(entete: EnteteReleve, lignes: LigneDeduction[]): Promise<ResultatExport> {
  const bloquantes = anomaliesBloquantes(entete, lignes);
  if (bloquantes.length) return { ok: false, anomalies: bloquantes };

  const xml = genererXml(entete, lignes);
  const base = nomFichier(entete);
  const bytes = createZip([{ name: `${base}.xml`, data: new TextEncoder().encode(xml) }]);
  const empreinteXml = createHash("sha256").update(xml).digest("hex");
  return { ok: true, anomalies: [], nomZip: `${base}.zip`, zip: bytes, xml, empreinteXml };
}

/* ------------------------------------------------------------------ */
/* Synthèse TVA (aide à la saisie EFI dans SIMPL-TVA)                  */
/* ------------------------------------------------------------------ */

export interface LigneVente {
  montantHT: number;
  tauxTVA: number;
  montantTVA: number;
}

export interface SyntheseTva {
  collecteeParTaux: Record<string, { ht: number; tva: number }>;
  totalCollectee: number;
  totalDeductible: number;
  /** > 0 : TVA due ; < 0 : crédit de TVA */
  soldeNet: number;
}

export function syntheseTva(ventesEncaissees: LigneVente[], deductions: LigneDeduction[]): SyntheseTva {
  const collecteeParTaux: SyntheseTva["collecteeParTaux"] = {};
  for (const v of ventesEncaissees) {
    const k = `${v.tauxTVA}%`;
    collecteeParTaux[k] ??= { ht: 0, tva: 0 };
    collecteeParTaux[k].ht = round2(collecteeParTaux[k].ht + v.montantHT);
    collecteeParTaux[k].tva = round2(collecteeParTaux[k].tva + v.montantTVA);
  }
  const totalCollectee = round2(Object.values(collecteeParTaux).reduce((s, x) => s + x.tva, 0));
  const totalDeductible = round2(deductions.reduce((s, l) => s + (l.montantTVA * (l.prorata ?? 100)) / 100, 0));
  return { collecteeParTaux, totalCollectee, totalDeductible, soldeNet: round2(totalCollectee - totalDeductible) };
}
