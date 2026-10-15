# TVA — Relevé des déductions (SIMPL-TVA, mode EDI)

## Mise en place
1. Exécuter `supabase/migrations/011_tva_releve_deductions.sql` dans l'éditeur SQL Supabase (idempotent).
2. Fiche client : renseigner l'**IF** et le **régime TVA** (mensuel / trimestriel).
3. Aucune dépendance npm ajoutée (le ZIP est écrit par `lib/tva/zip.ts`).

## Parcours fiduciaire (`/tva`)
1. Les PDF classés « Facture achat » apparaissent dans « Factures d'achat reçues à saisir ».
2. « Saisir / vérifier » ouvre le PDF à côté du formulaire.
3. Champs lus automatiquement avec une confiance < 95 % : surlignés, à **corriger ou confirmer**.
4. Alertes (paiement hors période, espèces > 5 000 DH, doublon…) : à **accepter une par une**.
5. « Valider la ligne » : signée par l'utilisateur connecté, empreinte SHA-256 stockée.
6. Quand toutes les lignes de la période sont validées : « Générer le fichier .zip » → dépôt sur SIMPL-TVA.

## Garanties en base (pas seulement dans l'interface)
- Toute modification d'une ligne validée **annule sa validation** (trigger `guard_purchase_invoice`).
- Une ligne exportée est **verrouillée** ; seul le propriétaire du cabinet peut annuler un export (motif obligatoire).
- `register_tva_export` refuse l'export si une facture de la période reste « à vérifier » ou si le lot ne correspond pas exactement aux lignes validées.
- Chaque décision est tracée dans `audit_events` (`invoice.validate`, `invoice.reject`, `tva.export`, `tva.export_cancel`).

## À faire
- Moteur de lecture PDF : remplir `extraction_confidence` (clé = champ, valeur 0–1) à la création de la ligne.
- Vérifier le format contre la dernière version du cahier des charges EDI SIMPL-TVA publiée sur tax.gov.ma, puis faire un dépôt test réel.
