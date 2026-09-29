# Deploy Fido — Guide de mise en production

Ce guide vous mène de zéro à un environnement de test fiduciaire fonctionnel en
~30 minutes. Recommandation : **Vercel + Supabase managé**. Alternatives à la fin.

---

## Prérequis

- Compte **Supabase** ([supabase.com](https://supabase.com), plan Free suffit pour le test)
- Compte **Vercel** ([vercel.com](https://vercel.com), plan Hobby suffit)
- Compte **Emergent** (fourniture de `EMERGENT_EMAIL_KEY` — Resend managé)
- Repo GitHub avec le code Fido pushé (voir §6)
- Node.js 20+ localement (pour tester avant push)

---

## 1. Créer le projet Supabase

1. [Dashboard Supabase](https://supabase.com/dashboard) → **New project**
2. Nom : `fido-staging` · région : `eu-west-2` (Londres, latence acceptable depuis MA) ou `eu-central-1` (Francfort)
3. **DB password** : générez et stockez dans un password manager
4. Attendez ~2 minutes que le projet soit prêt

### Récupérer les clés
Dans **Project Settings → API** :
- `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
- `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` → `SUPABASE_SERVICE_ROLE_KEY` (⚠️ jamais dans le client, jamais dans Git)

---

## 2. Exécuter les migrations

Deux options :

### Option A — SQL Editor (rapide, manuel)
Dans **SQL Editor** → **New query**, coller et exécuter les fichiers **dans cet ordre exact** :

1. `supabase/schema.sql`
2. `supabase/migrations/002a_phase1_clients.sql`
3. `supabase/migrations/002b_client_invitations.sql`
4. `supabase/migrations/003_production_workflow.sql`
5. `supabase/migrations/004_hardening.sql`
6. `supabase/migrations/005_refonte.sql`
7. `supabase/migrations/006_fiscal_deadlines.sql`
8. `supabase/migrations/20260911000000_phase1_auth.sql`

### Option B — Supabase CLI (idempotent, versionné)
```bash
npm i -g supabase
supabase link --project-ref <your-project-ref>
supabase db push
```

### Vérification
Après migrations, dans SQL editor :
```sql
select tablename from pg_tables where schemaname='public' order by tablename;
-- Doit inclure : audit_events, client_invitations, clients, document_requests,
--                document_versions, documents, fiscal_deadlines, messages,
--                organizations, profiles
```

---

## 3. Bucket Storage `documents`

`supabase/schema.sql` crée déjà le bucket. Si ce n’est pas fait, dans **Storage → New bucket** :
- Nom : `documents`
- Public : **non** (privé)

Les policies RLS sur `storage.objects` sont créées par `005_refonte.sql`.

---

## 4. Seed de données de test

En local avec `.env.local` renseigné :

```bash
pnpm install
pnpm dlx tsx scripts/seed.ts
```

Ceci crée :
- 1 owner : `demo-cabinet@fido.local` / `Fido-Demo-2026!`
- 3 clients marocains (Casablanca, Rabat)
- 5 demandes documentaires par client
- ~30 échéances fiscales par client (TVA + IS + IR + CNSS + taxe pro)

---

## 5. Pusher le code sur GitHub

Depuis le dossier `fido/` :
```bash
git init
git add .
git commit -m "chore: Fido refonte 2026-01"
git branch -M main
git remote add origin https://github.com/<votre-org>/fido.git
git push -u origin main
```

Le fichier `.gitignore` livré exclut déjà `.env.local` et `node_modules`.

---

## 6. Déployer sur Vercel

### 6.1 Créer le projet
1. [Vercel dashboard](https://vercel.com/new) → **Import Git Repository**
2. Sélectionnez le repo GitHub `fido`
3. **Framework Preset** : Next.js (détecté automatiquement)
4. **Root Directory** : `./` (racine du repo)
5. Ne cliquez PAS encore sur **Deploy** — d’abord les env vars.

### 6.2 Variables d’environnement (Settings → Environment Variables)
Ajoutez pour **Production** et **Preview** :

| Nom | Valeur | Note |
|-----|--------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxx.supabase.co` | Étape 1 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` | Étape 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | Étape 1 · **Sensitive** |
| `NEXT_PUBLIC_APP_URL` | `https://fido-staging-xxx.vercel.app` | Après premier deploy, revenir mettre l’URL réelle |
| `EMERGENT_EMAIL_KEY` | `ek_...` | Fourni par Emergent · **Sensitive** |
| `EMAIL_FROM_NAME` | `Fido` |  |
| `EMAIL_REPLY_TO` | `contact@votre-cabinet.ma` | optionnel |
| `CRON_SECRET` | (chaîne aléatoire 32+ car) | Générez avec `openssl rand -hex 32` · **Sensitive** |

### 6.3 Premier déploiement
Cliquez sur **Deploy**. ~2 min plus tard vous avez une URL du type
`https://fido-<hash>.vercel.app`.

**Retournez dans Environment Variables** et mettez à jour `NEXT_PUBLIC_APP_URL`
avec l’URL réelle, puis **Redeploy**.

### 6.4 Vérifier le cron
Vercel détecte `vercel.json` automatiquement. Dans **Settings → Cron Jobs** vous
devez voir :
- Path: `/api/cron/deadline-reminders`
- Schedule: `0 8 * * *` (08:00 UTC quotidien)

Test manuel (avec `CRON_SECRET` connu) :
```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://<votre-url>.vercel.app/api/cron/deadline-reminders
```
Réponse attendue :
```json
{ "ok": true, "processed": 0, "reminders_sent": { "client": 0, "staff": 0 }, "errors": [], "target_date": "..." }
```

---

## 7. Configurer Supabase Auth

Dans **Authentication → URL Configuration** :
- **Site URL** : `https://<votre-url>.vercel.app`
- **Redirect URLs** : `https://<votre-url>.vercel.app/**`

Dans **Authentication → Providers → Email** :
- **Confirm email** : à décider selon votre besoin. Pour un test rapide, **désactiver**.
  Pour un test plus réel, **activer** (les invitations demanderont confirmation).

---

## 8. Test rapide bout en bout

1. Ouvrez `https://<votre-url>.vercel.app/login`
2. Connectez-vous : `demo-cabinet@fido.local` / `Fido-Demo-2026!`
3. Vous atterrissez sur le tableau de bord — 3 clients visibles
4. Cliquez sur `Échéances` — vous devez voir ~90 échéances (30 × 3 clients)
5. Ouvrez un client → générez une invitation → suivez le lien dans un navigateur privé → créez un compte client
6. Uploadez un PDF → vérifiez côté staff qu’il apparaît dans `Documents`

---

## 9. Checklist test fiduciaire

- [ ] Site URL Supabase Auth mis à jour avec URL Vercel
- [ ] `NEXT_PUBLIC_APP_URL` env var alignée avec URL Vercel
- [ ] Email invitation reçu (vérifier avec une vraie adresse)
- [ ] Migration 006 appliquée : `select count(*) from public.fiscal_deadlines` > 0 après seed
- [ ] Cron job listé dans Vercel Settings → Cron Jobs
- [ ] Test manuel du cron avec `curl` retourne `ok:true`
- [ ] Test T4/T5 (multi-tenant) : essayer d’accéder à un doc d’un autre cabinet retourne bien 403/404

---

## Alternatives d’hébergement

### Hostinger (VPS Node)
Faisable mais moins agréable :
- SSH sur le VPS, installer Node 20+ et pnpm, git clone
- `pnpm install && pnpm build`
- Service systemd + reverse-proxy Nginx sur port 3000
- Configurer un cron shell pour appeler l’endpoint `/api/cron/deadline-reminders`
- SSL via certbot

### VPS Contabo / Hetzner
Identique à Hostinger mais bien moins cher (€3–5/mois) et plus performant.

### Supabase pg_cron (souverain, alternative à Vercel Cron)
Dans SQL editor :
```sql
create extension if not exists pg_cron;
select cron.schedule(
  'fido-daily-reminders',
  '0 8 * * *',
  $$
    select net.http_post(
      'https://<votre-url>.vercel.app/api/cron/deadline-reminders',
      headers => jsonb_build_object('Authorization', 'Bearer <votre CRON_SECRET>')
    );
  $$
);
```
Utile si vous voulez piloter les crons depuis Supabase plutôt que Vercel.

---

## Sécurité — checklist finale

- [ ] `SUPABASE_SERVICE_ROLE_KEY` n’est **jamais** committée
- [ ] `.env.local` dans `.gitignore` (vérifié)
- [ ] Aucun endpoint API non protégé (sauf `/api/cron/*` protégé par `CRON_SECRET`)
- [ ] Session Supabase Auth activée (middleware fait `getUser()` sur chaque requête)
- [ ] RLS active sur toutes les tables (`select tablename, rowsecurity from pg_tables where schemaname='public';`)
- [ ] Storage bucket `documents` en **privé**
- [ ] Supabase Auth "Confirm email" activé pour production (invitations vérifiées)
