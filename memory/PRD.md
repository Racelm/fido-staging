# Fido — PRD (Refonte 2026-01)

## Problem statement (verbatim)
Refonte élargie de `github.com/Racelm/Fido` — plateforme de collaboration
fiduciaires ↔ clients au Maroc (Next.js 15 + Supabase). Objectif : corriger
les 8 points critiques C1–C8 (auth désactivée, RLS trop laxistes, migrations
en collision, chemins storage non contraints…) ET ajouter les fonctionnalités
fiduciaires attendues (audit loi 09-08, versionnement, soft-delete,
catégorisation Maroc) pour permettre un test réel avec un fiduciaire.

## Architecture
- **Frontend + Backend** : Next.js 15 App Router + TypeScript + React 19 (unifié SSR)
- **Auth & DB & Storage** : Supabase (Postgres avec RLS multi-tenant)
- **Email** : proxy Emergent (Resend managé) avec guardrails G1–G5
- **Multi-tenant** : par `organizations.id` (cabinets isolés)
- **Rôles** : owner / staff (côté cabinet), client (côté entreprise)

## User personas
- **Fiduciaire owner** : crée son cabinet, invite clients, consulte audit
- **Staff cabinet** : traite les demandes, communique, télécharge
- **Client (dirigeant TPE/PME MA)** : téléverse ses documents, répond aux demandes

## Core requirements
1. Multi-tenant strict (T4/T5 = 0 leak)
2. Auth Supabase SSR complète (login/signup/invite)
3. Upload sécurisé (chemin contraint, MIME/taille whitelistée)
4. Versionnement + soft-delete (pas de perte accidentelle)
5. Audit trail (loi 09-08)
6. Emails transactionnels (invitations)

## What's been implemented (2026-01-28 → 2026-02-04)
- [x] Auth SSR réactivée (middleware, login, signup, invite) — C1/C2/C3
- [x] Fix RLS documents INSERT (uploaded_by = auth.uid) — C4
- [x] Fix RLS storage : chemin `{org}/{client}/*` contraint et cross-check tenant — C5
- [x] Migrations renommées 002a/002b, bug `$…$` dans 003 corrigé — C6
- [x] Fix RLS messages : rôle + tenant en une seule expression — C7
- [x] `.env.example` documenté (URL, anon, service, email, app_url) — C8
- [x] Table `audit_events` + triggers auto + page `/audit`
- [x] Table `document_versions` + auto-bump + snapshot
- [x] Soft-delete `deleted_at` sur clients + documents ; RPC `archive_client`
- [x] Enum `document_category` (14 valeurs MA) + colonne `category`
- [x] Colonnes fiduciaires : ICE, IF, RC, CNSS, patente, exercice, période TVA
- [x] Contraintes DB : taille ≤ 25 Mo, MIME whitelist
- [x] Bulk upload + drag & drop (ClientUpload.tsx)
- [x] `lib/email.ts` avec guardrails G1–G5 + templates invitation / doc reçu / message / rappel échéance
- [x] Rate-limiter (`/invite/[token]` : 10 essais / 5 min / IP)
- [x] Seed script (1 cabinet + 3 clients MA + 5 demandes chacun + ~30 échéances chacun)
- [x] Helper `firstRel` pour normaliser jointures Supabase
- [x] Build Next.js validé (16 routes, 0 erreur TypeScript)
- [x] **Échéances fiscales MA** (migration 006) : table + enums + RPC `generate_fiscal_deadlines_for_client` (TVA / IS acomptes+solde / IR / CNSS / taxe pro) + vue `upcoming_deadlines`
- [x] **Page `/deadlines`** avec pills couleur due-overdue/soon/month/later + action "Marquer traité"
- [x] **ClientForm enrichie** : ICE / IF / RC / CNSS / période TVA / début d'exercice → auto-génération 12 mois d'échéances à la création
- [x] **Cron J-7** `/api/cron/deadline-reminders` : e-mail client + CC staff, protégé par `CRON_SECRET`, marque `reminded_at` (idempotent)
- [x] **`vercel.json`** avec cron quotidien `0 8 * * *`
- [x] **`docs/DEPLOY.md`** : guide complet Vercel + Supabase (30 min)
- [x] **Design "Workspace OS"** : palette violette (#6C5CE7), Plus Jakarta Sans, AppShell + Sidebar partagés, dashboard refait (KPIs colorés, tâches priorisées, rail activités+échéances), toutes pages migrées
- [x] **Staff invitations** (migration 007) : table `staff_invitations` + RLS owner-only + RPC `claim_staff_invitation` + page `/team` + flow `/invite-staff/[token]` + template e-mail + rate-limit + audit
- [x] **Édition fiche client** (migration 008, 2026-02-04) :
  - Colonnes `address` + `website` ajoutées à `clients`
  - RLS UPDATE : staff gère tous les champs ; policy dédiée pour le rôle `client` (self-update) — restriction par colonne côté server-action
  - Trigger `audit_on_client_update` : diff avant/après enregistré dans `audit_events`
  - Server actions `updateClientRecord` (fiduciaire, tous champs incl. statut) + `updateOwnClientProfile` (client, contact uniquement)
  - Pages `/clients/[id]/edit` (fiduciaire) et `/client/profile` (client)
  - Boutons "Modifier la fiche" + lien sidebar "Mes informations"
  - Template e-mail `clientProfileUpdatedTemplate` : notification auto au cabinet quand le client met à jour sa fiche (avec diff par ligne)
- [x] **Revue des documents** (migration 009, 2026-02-04) :
  - Enum `document_review_status` + colonnes `review_status`, `reviewed_by`, `reviewed_at`, `review_note` sur `documents`
  - Default : chaque upload client arrive en `pending_review`
  - Server action `reviewDocument` (owner/staff uniquement) : `approved` / `rejected` / `pending_review`
  - Composants `ReviewBadge` + `ReviewButtons` partagés entre `/documents`, `/clients/[id]` et `/client`
  - Côté client : badge visible + note de rejet affichée en rouge pour correction
  - Trigger `audit_on_document_review` : chaque changement de statut est journalisé
  - **Email auto au client en cas de rejet** : template `documentRejectedTemplate` envoyé via `getClientEmail`+`sendToMany` avec la note du cabinet (best-effort, non bloquant)

## Files touched / created
- `middleware.ts`, `lib/supabase/middleware.ts` (nouveau)
- `app/page.tsx`, `app/login/page.tsx` + `LoginForm.tsx`, `app/signup/*` (nouveau)
- `app/actions/auth.ts`, `.../invitations.ts`, `.../documents.ts`, `.../invite.ts` (nouveau)
- `app/client/ClientUpload.tsx` (refonte)
- `app/audit/page.tsx` (nouveau)
- `app/invite/[token]/page.tsx` (rate-limited)
- `lib/email.ts`, `lib/rate-limit.ts`, `lib/rel.ts` (nouveau)
- `supabase/migrations/005_refonte.sql` (nouveau, 300+ lignes)
- `supabase/migrations/002a_*.sql` + `002b_*.sql` (renommés)
- `supabase/migrations/003_production_workflow.sql` (bug $…$ fixé)
- `scripts/seed.ts` (nouveau)
- `.env.example` (refait)
- `docs/REFONTE.md`, `README.md` (nouveaux/refaits)
- Suppression : `app/demo/` (bypass demo retiré)

## Prioritized backlog (P0 → P2)

**P0 — avant le vrai test fiduciaire**
- Fournir credentials Supabase de staging + faire tourner les 8 migrations + seed
- Configurer `EMERGENT_EMAIL_KEY`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`
- Déployer sur Vercel Preview (guide dans `docs/DEPLOY.md`, Hostinger n’est pas recommandé)

**P1 — après premier retour fiduciaire**
- Antivirus upload (VirusTotal/ClamAV) — reporté à la demande utilisateur
- 2FA (Supabase Auth MFA) pour owner/staff
- Notifications e-mail temps réel enrichies (staff via service role admin API)
- Export loi 09-08 (données + fichiers) et bouton d’anonymisation

**P2 — évolution**
- i18n FR/AR avec RTL (`next-intl`)
- Portail mobile-first optimisé WhatsApp culture
- Intégrations DGI/SIMPL, CNSS/DAMANCOM, OMPIC
- Table `fiscal_deadlines` avec reminders auto (TVA, IS, IR, CNSS, taxe pro)
- Signature électronique documents

## Notes techniques
- Livraison sous `/app/fido/` (Next.js autonome ; l’environnement E1 par défaut React+FastAPI+Mongo n’est pas utilisé).
- Pas de test end-to-end automatisé exécuté ici — pas d’instance Supabase live fournie. Le build Next.js et `tsc --noEmit` passent tous les deux (0 erreur).
- Recommandation d’hébergement : **Vercel** (staging + prod). Hostinger reste possible mais SSR souvent boiteux et cold-start pénibles.
