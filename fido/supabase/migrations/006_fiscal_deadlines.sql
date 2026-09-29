-- =====================================================================
-- Fido — Migration 006 : Échéances fiscales DGI/CNSS Maroc + rappels
-- =====================================================================
-- Modèle d'échéances par client, auto-générées selon `clients.tva_period`
-- et `clients.fiscal_year_start`. Utilisées par le cron de rappels.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Enum type d'obligation
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'fiscal_obligation_type') then
    create type public.fiscal_obligation_type as enum (
      'tva_mensuel',
      'tva_trimestriel',
      'is_acompte',
      'is_solde',
      'ir_professionnel',
      'cnss_mensuel',
      'taxe_professionnelle'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'fiscal_deadline_status') then
    create type public.fiscal_deadline_status as enum (
      'pending',
      'completed',
      'skipped'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Table fiscal_deadlines
-- ---------------------------------------------------------------------
create table if not exists public.fiscal_deadlines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  obligation public.fiscal_obligation_type not null,
  period_label text not null,          -- ex: 'TVA 2026-Q1', 'CNSS 2026-03', 'IS Acompte 1/2026'
  due_date date not null,              -- date limite légale
  status public.fiscal_deadline_status not null default 'pending',
  reminded_at timestamptz,             -- horodate du dernier rappel envoyé
  completed_at timestamptz,
  completed_by uuid references public.profiles(id),
  notes text,
  created_at timestamptz not null default now(),
  unique (client_id, obligation, period_label)
);

create index if not exists fiscal_deadlines_due_idx on public.fiscal_deadlines(due_date, status);
create index if not exists fiscal_deadlines_client_idx on public.fiscal_deadlines(client_id, due_date);
create index if not exists fiscal_deadlines_org_idx on public.fiscal_deadlines(organization_id, due_date);

alter table public.fiscal_deadlines enable row level security;

drop policy if exists "members can view deadlines" on public.fiscal_deadlines;
create policy "members can view deadlines" on public.fiscal_deadlines for select
using (
  public.is_org_member(organization_id)
  or public.is_client_user(client_id)
);

drop policy if exists "staff can insert deadlines" on public.fiscal_deadlines;
create policy "staff can insert deadlines" on public.fiscal_deadlines for insert
with check (public.is_org_member(organization_id));

drop policy if exists "staff can update deadlines" on public.fiscal_deadlines;
create policy "staff can update deadlines" on public.fiscal_deadlines for update
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

drop policy if exists "staff can delete deadlines" on public.fiscal_deadlines;
create policy "staff can delete deadlines" on public.fiscal_deadlines for delete
using (public.is_org_member(organization_id));

-- ---------------------------------------------------------------------
-- 3. RPC : générer 12 mois d'échéances pour un client
-- ---------------------------------------------------------------------
-- Règles Maroc (indicatif, à ajuster avec l'expert-comptable) :
--   TVA mensuel : dernier jour du mois suivant (déclaration + paiement avant le 20 du mois suivant en pratique DGI SIMPL).
--     On prend le 20 du mois M+1 comme deadline.
--   TVA trimestriel : le 20 du mois suivant la fin du trimestre.
--   IS acomptes : 4 acomptes (31 mars, 30 juin, 30 septembre, 31 décembre).
--     On simplifie : 31/03, 30/06, 30/09, 31/12 de l'exercice.
--   IS solde : 3 mois après clôture de l'exercice (31 mars N+1 si exercice civil).
--   IR pro : 1er avril N+1 (déclaration annuelle des revenus).
--   CNSS mensuel : dernier jour du mois suivant (déclaration DAMANCOM avant le 10, paiement avant fin de mois).
--     On prend le dernier jour du mois M+1.
--   Taxe professionnelle : 30 juin (annuelle).
--
-- IDEMPOTENT via ON CONFLICT DO NOTHING (unique client_id, obligation, period_label).
-- ---------------------------------------------------------------------
create or replace function public.generate_fiscal_deadlines_for_client(
  target_client uuid,
  year_ref int default extract(year from now())::int
) returns int
language plpgsql security definer set search_path = public
as $$
declare
  c record;
  mois int;
  trimestre int;
  fiscal_start date;
  fiscal_year int;
  inserted int := 0;
  tmp_date date;
begin
  select
    c1.id,
    c1.organization_id,
    c1.tva_period,
    coalesce(c1.fiscal_year_start, make_date(year_ref, 1, 1)) as fys
  into c
  from public.clients c1
  where c1.id = target_client
    and c1.deleted_at is null;

  if not found then return 0; end if;

  -- Autorisation : owner/staff de l'org, ou système (auth.uid null via service role)
  if auth.uid() is not null and not public.is_org_member(c.organization_id) then
    raise exception 'Not authorized';
  end if;

  fiscal_start := c.fys;
  fiscal_year := extract(year from fiscal_start)::int;

  -- TVA
  if c.tva_period = 'mensuel' then
    for mois in 1..12 loop
      tmp_date := make_date(fiscal_year, mois, 1);
      insert into public.fiscal_deadlines(
        organization_id, client_id, obligation, period_label, due_date
      ) values (
        c.organization_id, target_client, 'tva_mensuel',
        to_char(tmp_date, 'YYYY-MM') || ' TVA',
        (tmp_date + interval '1 month' + interval '19 days')::date
      ) on conflict do nothing;
      if found then inserted := inserted + 1; end if;
    end loop;
  elsif c.tva_period = 'trimestriel' then
    for trimestre in 1..4 loop
      tmp_date := make_date(fiscal_year, (trimestre - 1) * 3 + 1, 1);
      insert into public.fiscal_deadlines(
        organization_id, client_id, obligation, period_label, due_date
      ) values (
        c.organization_id, target_client, 'tva_trimestriel',
        fiscal_year || '-T' || trimestre || ' TVA',
        (tmp_date + interval '3 months' + interval '19 days')::date
      ) on conflict do nothing;
      if found then inserted := inserted + 1; end if;
    end loop;
  end if;

  -- IS Acomptes (4 fois par an, dernier jour de chaque trimestre)
  for trimestre in 1..4 loop
    insert into public.fiscal_deadlines(
      organization_id, client_id, obligation, period_label, due_date
    ) values (
      c.organization_id, target_client, 'is_acompte',
      'IS Acompte ' || trimestre || '/' || fiscal_year,
      (make_date(fiscal_year, trimestre * 3, 1) + interval '1 month - 1 day')::date
    ) on conflict do nothing;
    if found then inserted := inserted + 1; end if;
  end loop;

  -- IS solde : 3 mois après clôture (fiscal_start + 12 mois + 3 mois - 1 jour)
  insert into public.fiscal_deadlines(
    organization_id, client_id, obligation, period_label, due_date
  ) values (
    c.organization_id, target_client, 'is_solde',
    'IS Solde ' || fiscal_year,
    (fiscal_start + interval '15 months - 1 day')::date
  ) on conflict do nothing;
  if found then inserted := inserted + 1; end if;

  -- IR pro : 1er avril N+1
  insert into public.fiscal_deadlines(
    organization_id, client_id, obligation, period_label, due_date
  ) values (
    c.organization_id, target_client, 'ir_professionnel',
    'IR Pro ' || fiscal_year,
    make_date(fiscal_year + 1, 4, 1)
  ) on conflict do nothing;
  if found then inserted := inserted + 1; end if;

  -- CNSS mensuel (dernier jour du mois M+1)
  for mois in 1..12 loop
    tmp_date := make_date(fiscal_year, mois, 1);
    insert into public.fiscal_deadlines(
      organization_id, client_id, obligation, period_label, due_date
    ) values (
      c.organization_id, target_client, 'cnss_mensuel',
      to_char(tmp_date, 'YYYY-MM') || ' CNSS',
      (tmp_date + interval '2 months - 1 day')::date
    ) on conflict do nothing;
    if found then inserted := inserted + 1; end if;
  end loop;

  -- Taxe professionnelle : 30 juin annuelle
  insert into public.fiscal_deadlines(
    organization_id, client_id, obligation, period_label, due_date
  ) values (
    c.organization_id, target_client, 'taxe_professionnelle',
    'Taxe Pro ' || fiscal_year,
    make_date(fiscal_year, 6, 30)
  ) on conflict do nothing;
  if found then inserted := inserted + 1; end if;

  return inserted;
end;
$$;

grant execute on function public.generate_fiscal_deadlines_for_client(uuid, int) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Vue "à venir" pour l'UI (échéances non complétées à moins de 60 jours)
-- ---------------------------------------------------------------------
create or replace view public.upcoming_deadlines as
select
  fd.*,
  c.company_name,
  c.email as client_email
from public.fiscal_deadlines fd
join public.clients c on c.id = fd.client_id and c.deleted_at is null
where fd.status = 'pending'
  and fd.due_date <= (current_date + interval '60 days');

grant select on public.upcoming_deadlines to authenticated;
