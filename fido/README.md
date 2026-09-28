# Fido

Plateforme SaaS de collaboration fiduciaires ↔ clients (Maroc).

> **État** : Refonte 2026-01 appliquée — voir [`docs/REFONTE.md`](docs/REFONTE.md) pour le détail des corrections critiques (C1–C8) et des ajouts fonctionnels (audit, versioning, catégorisation, soft-delete).

## Stack

- Next.js 15 (App Router) + TypeScript + React 19
- Supabase (Auth, Postgres, Storage)
- E-mail transactionnel : proxy Emergent (Resend)

## Fonctionnalités

- Signup cabinet + invitation clients par lien signé (7 jours)
- Authentification complète (Supabase Auth SSR)
- Tableau de bord cabinet + espace client dédié
- Demandes documentaires avec catégories & échéances
- Upload sécurisé (drag & drop, bulk, limites MIME/taille DB-enforced)
- Versionnement automatique des documents (même nom → v2, v3…)
- Messagerie multi-tenant strict (RLS combinée)
- Journal d’audit `audit_events` accessible aux owners (traçabilité loi 09-08)
- Rate-limiting sur `/invite/[token]`

## Démarrage

```bash
pnpm install
cp .env.example .env.local
# renseigner les variables Supabase et EMERGENT_EMAIL_KEY

# Exécuter les migrations dans Supabase (ordre alphabétique) :
#   supabase/schema.sql
#   supabase/migrations/002a_phase1_clients.sql
#   supabase/migrations/002b_client_invitations.sql
#   supabase/migrations/003_production_workflow.sql
#   supabase/migrations/004_hardening.sql
#   supabase/migrations/20260911000000_phase1_auth.sql
#   supabase/migrations/005_refonte.sql

# Seed de test (1 cabinet, 3 clients, 5 demandes chacun)
pnpm dlx tsx scripts/seed.ts

pnpm dev
```

Puis <http://localhost:3000>.

Compte owner du seed :  
`demo-cabinet@fido.local` / `Fido-Demo-2026!`

## Structure

```
app/
  page.tsx            → Tableau de bord cabinet
  login/              → Login (Server Action)
  signup/             → Signup cabinet
  clients/            → Liste + détail client (staff)
  client/             → Espace client (mono-client)
  documents/          → Vue globale documents (staff)
  requests/           → Vue globale demandes (staff)
  messages/           → Vue globale messages (staff)
  notifications/      → Notifications utilisateur
  audit/              → Journal audit (owner only)
  invite/[token]/     → Onboarding client via lien signé
  settings/           → Paramètres cabinet
  actions/            → Server actions (auth, clients, documents,
                        invitations, invite, messages, requests)

lib/
  supabase/           → Client SSR + browser + middleware helper
  email.ts            → Envoi transactionnel + guardrails
  rate-limit.ts       → Limiteur en mémoire
  rel.ts              → Helper jointures Supabase

supabase/
  schema.sql          → Modèle de base (organizations, profiles, clients,
                        documents, document_requests, messages)
  migrations/         → Ordre alphabétique déterministe

scripts/
  seed.ts             → Seed d’un cabinet fictif marocain

docs/
  REFONTE.md          → Documentation détaillée de la refonte
```
