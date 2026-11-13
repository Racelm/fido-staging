-- =====================================================================
-- 011 — Relances automatiques des clients (documents manquants)
-- ---------------------------------------------------------------------
-- Chaque mois, une demande récurrente « Factures d'achat et de vente –
-- <mois> » est créée pour chaque client actif. Tant qu'elle est en
-- statut 'pending', le cron /api/cron/document-reminders relance le
-- client par paliers DANS Tiwizi (notifications + bandeau de l'espace
-- client, aucun e-mail), puis alerte le cabinet.
--
-- Arrêt automatique : dès qu'un document est déposé, le trigger existant
-- mark_request_received passe la demande en 'received' → plus de relance.
--
-- Par défaut les relances sont DÉSACTIVÉES (enabled = false) : rien
-- n'est envoyé tant que le cabinet ne les active pas dans Paramètres.
-- =====================================================================

-- 1. Réglages par cabinet ------------------------------------------------
create table if not exists public.reminder_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  enabled boolean not null default false,
  -- Jour du mois M+1 avant lequel les pièces du mois M doivent être déposées
  due_day smallint not null default 10 check (due_day between 1 and 28),
  -- Jours relatifs à l'échéance pour la relance (J-3) et le retard (J+3)
  before_days smallint not null default 3 check (before_days between 1 and 15),
  overdue_days smallint not null default 3 check (overdue_days between 1 and 15),
  -- Jours après l'échéance où le cabinet est alerté (plus de mail au client)
  escalate_days smallint not null default 7 check (escalate_days between 2 and 30),
  updated_at timestamptz not null default now(),
  constraint reminder_settings_order_check check (escalate_days > overdue_days)
);

alter table public.reminder_settings enable row level security;

drop policy if exists "members can view reminder settings" on public.reminder_settings;
create policy "members can view reminder settings" on public.reminder_settings for select
using (public.is_org_member(organization_id));

drop policy if exists "members can insert reminder settings" on public.reminder_settings;
create policy "members can insert reminder settings" on public.reminder_settings for insert
with check (public.is_org_member(organization_id));

drop policy if exists "members can update reminder settings" on public.reminder_settings;
create policy "members can update reminder settings" on public.reminder_settings for update
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

-- 2. Pause par client -----------------------------------------------------
alter table public.clients
  add column if not exists reminders_paused boolean not null default false;

-- 3. Suivi des relances sur les demandes ----------------------------------
alter table public.document_requests
  add column if not exists is_recurring boolean not null default false,
  add column if not exists period date,                 -- 1er jour du mois concerné
  add column if not exists reminder_stage smallint not null default 0,
  -- 0 = rien envoyé, 1 = annonce, 2 = J-3, 3 = jour J, 4 = retard
  add column if not exists last_reminded_at timestamptz,
  add column if not exists escalated_at timestamptz;

-- Une seule demande récurrente par client et par mois (idempotence du cron)
create unique index if not exists document_requests_recurring_uniq
  on public.document_requests(client_id, period)
  where is_recurring;

create index if not exists document_requests_reminders_idx
  on public.document_requests(organization_id, status, due_date)
  where is_recurring;

-- 4. Journal des envois ---------------------------------------------------
create table if not exists public.reminder_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  request_id uuid not null references public.document_requests(id) on delete cascade,
  stage smallint not null,           -- 1..4 = client, 5 = alerte cabinet
  channel text not null default 'in_app',
  recipient text,                    -- profile_id destinataire (in_app)
  ok boolean not null,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists reminder_log_org_idx on public.reminder_log(organization_id, created_at desc);
create index if not exists reminder_log_request_idx on public.reminder_log(request_id);

alter table public.reminder_log enable row level security;

drop policy if exists "members can view reminder log" on public.reminder_log;
create policy "members can view reminder log" on public.reminder_log for select
using (public.is_org_member(organization_id));
-- Écriture uniquement par le cron (service role, contourne la RLS).
