# Fido — Refonte 2026-01

Documentation de la refonte appliquée à `github.com/Racelm/Fido` pour
préparer un test réel avec un fiduciaire marocain. Cette refonte couvre
les 8 points critiques (C1–C8) du diagnostic initial et ajoute les
fonctionnalités fiduciaires attendues (audit, versionnement,
catégorisation, soft-delete).

---

## 1. Ce qui a changé

### Sécurité (KO avant le fiduciaire)

| Réf. | Fichier | Correctif |
|------|---------|-----------|
| C1 | `middleware.ts` + `lib/supabase/middleware.ts` | **Auth réactivée**. Redirige les non-connectés vers `/login`, les clients vers `/client`, les staff vers `/`. |
| C2 | `app/page.tsx` | **Vrai tableau de bord** basé sur les données de l’organisation. Plus de redirection `/demo`. |
| C3 | `app/login/page.tsx` + `app/login/LoginForm.tsx` + `app/signup/page.tsx` | **Login + signup** réels via Server Actions. Le compte cabinet crée automatiquement l’organisation (trigger Supabase). |
| C4 | `supabase/migrations/005_refonte.sql` | Policy `documents INSERT` durcie : `uploaded_by = auth.uid()` **obligatoire**. |
| C5 | idem | Policy storage `documents/*` : contraint le chemin `{organization_id}/{client_id}/*` et vérifie que le client appartient à l’organisation. |
| C6 | `supabase/migrations/002a_*.sql`, `002b_*.sql` | Migrations renommées pour un ordre alphabétique déterministe. Bug `$…$` de `003` corrigé. |
| C7 | `supabase/migrations/005_refonte.sql` | Policy `messages INSERT` combinée : le rôle **ET** l’appartenance au tenant sont vérifiés en une seule expression. |
| C8 | `.env.example` | Variables d’environnement documentées. `SUPABASE_SERVICE_ROLE_KEY` isolée. |

### Fonctionnalités fiduciaires (§3 + §4 du diagnostic)

| Feature | Où |
|---------|----|
| **Journal d’audit** (loi 09-08 / Conseil de l’Ordre) | Table `audit_events` + triggers auto + page `/audit` (owner only). Actions loguées : `document.upload`, `document.download`, `client.create`, `client.archive`, `invitation.create`, `request.create`. |
| **Versionnement documents** | Table `document_versions` + triggers `bump_document_version` (BEFORE INSERT) et `snapshot_document_version` (AFTER INSERT). Un ré-upload avec le même nom incrémente automatiquement `version`. |
| **Soft-delete** | Colonnes `deleted_at` sur `clients` et `documents`. Policies SELECT filtrent `deleted_at IS NULL`. RPC `archive_client()` remplace `DELETE`. FKs client → documents/messages/requests passent en `ON DELETE RESTRICT`. |
| **Catégorisation documentaire** | Enum `document_category` (14 valeurs : pièce comptable, facture achat/vente, relevé bancaire, contrat, statuts, PV, CIN, RC, ICE/IF, CNSS, TVA, IS/IR, autre). Colonne `category` sur `documents` et `document_requests`. Sélecteur dans `ClientUpload`. |
| **Bulk upload + drag & drop** | `app/client/ClientUpload.tsx` refait — dropzone HTML5 native, multi-fichiers, résultats par fichier. |
| **Limites MIME / taille** | Contraintes DB `documents_size_check` (25 Mo) et `documents_mime_check` (whitelist). Doublé côté client et Server Action `validateUploadServerSide`. |
| **Champs fiduciaires** | Sur `clients` : `ice`, `if_number`, `rc_number`, `cnss_number`, `patente_number`, `fiscal_year_start`, `tva_period` (mensuel/trimestriel/exonéré). |
| **Rate limiting** | `lib/rate-limit.ts` + Server Action `acceptInvitation` : 10 tentatives / 5 min / IP sur `/invite/[token]`. |
| **E-mails transactionnels** | `lib/email.ts` + intégration proxy Emergent Resend. Templates : invitation, document reçu, nouveau message. **Guardrails G1–G5 portés** depuis le playbook (pas de form/input, HTTPS strict, pas d’impersonation, no open relay, transactionnel uniquement). |
| **Seed** | `scripts/seed.ts` — 1 cabinet fictif + 3 clients marocains + 5 demandes chacun. Requiert `SUPABASE_SERVICE_ROLE_KEY`. |

### Non-régressions

- `next build` : 14 routes compilent en mode standard (server-rendered on demand).
- `tsc --noEmit` : 0 erreur.
- Helper `firstRel` (`lib/rel.ts`) normalise les jointures Supabase (relations to-one typées comme array).

---

## 2. Déploiement rapide

```bash
# 1. Cloner / dézipper puis :
cd fido
pnpm install

# 2. Créer un projet Supabase, récupérer URL / anon / service role keys
cp .env.example .env.local
# Renseigner NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_APP_URL,
# EMERGENT_EMAIL_KEY, EMAIL_FROM_NAME (=Fido), EMAIL_REPLY_TO.

# 3. Migrations (via Supabase CLI ou SQL editor, dans cet ordre)
#    - supabase/schema.sql
#    - 002a_phase1_clients.sql
#    - 002b_client_invitations.sql
#    - 003_production_workflow.sql
#    - 004_hardening.sql
#    - 20260911000000_phase1_auth.sql
#    - 005_refonte.sql

# 4. Seed
pnpm dlx tsx scripts/seed.ts

# 5. Dev
pnpm dev

# 6. Prod
pnpm build && pnpm start
```

### Hébergement

Hostinger + Next.js 15 SSR n’est pas idéal. Recommandation :

- **Staging** : Vercel Preview (déploiement automatique depuis GitHub).
- **Production** : Vercel ou VPS Node (Contabo / Hetzner) avec PM2/Nginx. Hostinger fonctionne mais on paie le prix côté DX et cold-start.

---

## 3. Ce qui reste à faire (post-test fiduciaire)

Ordre de priorité recommandé :

1. **2FA** (owner/staff) via Supabase Auth MFA — obligatoire dès qu’on manipule des données comptables réelles.
2. **Virus scan** upload : Edge Function Supabase déclenchée sur `documents INSERT`, appel ClamAV / VirusTotal, marquage `documents.scan_status`.
3. **Retention & export loi 09-08** : bouton « export toutes mes données » côté client (JSON + fichiers zip), et « anonymisation » côté owner.
4. **Notifications e-mail owner/staff** temps réel (actuellement best-effort avec service role).
5. **i18n FR/AR** : préparer `next-intl` structure. La direction RTL sur mobile est cruciale au Maroc.
6. **Échéances fiscales DGI** (TVA, IS acomptes, IR, CNSS, taxe pro) : table `fiscal_deadlines` + reminders.
7. **Portail client mobile-first** : refonte UX orientée « une action à la fois » (WhatsApp culture).

---

## 4. Plan de test fiduciaire (rappel §6 du diagnostic)

Setup : 1 owner + 1 staff + 2 clients réels, staging Vercel, projet Supabase dédié.

| # | Scénario | Critère |
|---|----------|---------|
| T1 | Signup cabinet → invitation client → signup client | Sans handbook, en < 5 min |
| T2 | Staff crée 3 demandes avec échéance | Toutes visibles côté client |
| T3 | Client upload PDF → staff voit → marque « received » puis « processed » | Flow complet |
| T4 | Client A essaie d’accéder à un doc du client B (URL manipulée) | **KO absolu si ça leake** |
| T5 | Staff cabinet A essaie d’accéder aux clients cabinet B | **KO absolu si ça leake** |
| T6 | Upload 50 Mo / .exe / .zip | Message clair côté UI, pas de 500 |
| T7 | Ré-upload du même nom | `version` incrémentée, ancien conservé |
| T8 | Message client → notification staff | Reçue en < 30 s |
| T9 | Password reset + expiration session | Fonctionnel |
| T10 | Upload mobile depuis Android + iOS Safari (photo caméra) | Fluide |
| T11 | 3G throttling | Pas de timeout, feedback UI |
| T12 | Archivage d’un client | Documents conservés, ne réapparaissent pas dans les listes |

**Format session** : 60–90 min, vous observez sans intervenir, prenez des notes,
15 min de debrief à la fin.

---

## 5. Points ouverts (à trancher)

1. **DGI / SIMPL / DAMANCOM / OMPIC** : intégrations natives (roadmap 2027) ou l’outil reste un pur outil de collaboration ? Réponse impacte le modèle de données (`fiscal_deadlines`, `damancom_declarations`).
2. **Hosting production** : Vercel vs VPS Node.js. Notre recommandation : Vercel, sauf contrainte souveraineté (données au Maroc).
3. **Langue** : FR only pour le premier test. Prévoir dossier `messages/` compatible `next-intl` dès qu’un client MENA arabophone est identifié.

---

## 6. Références rapides

- Table policies actives : `select * from pg_policies where schemaname='public' or (schemaname='storage' and tablename='objects') order by schemaname, tablename;`
- Consulter l’audit : `select action, entity_type, meta, created_at from public.audit_events order by created_at desc limit 50;`
- Test path storage : `select storage.foldername('11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/abc.pdf');` → doit rendre `{11111111-1111-..., 22222222-...}`.

Bon test !
