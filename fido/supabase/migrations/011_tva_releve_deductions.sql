-- =====================================================================
-- Tiwizi — Migration 011 : Relevé des déductions TVA (SIMPL-TVA, EDI)
-- =====================================================================
-- Principe : aucune ligne ne quitte Tiwizi sans validation explicite du
-- fiduciaire. Les garanties sont posées EN BASE (pas seulement dans l'UI) :
--   * toute modification d'une facture validée annule sa validation ;
--   * une facture exportée est verrouillée ;
--   * l'export n'est enregistré que si TOUTES les factures de la période
--     sont validées (fonction register_tva_export).
--
-- IDEMPOTENT : sûre à exécuter plusieurs fois.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Types
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'invoice_review_status') then
    create type public.invoice_review_status as enum ('a_verifier', 'valide', 'rejete');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Référentiel fournisseurs (par client) — IF/ICE vérifiés une fois
-- ---------------------------------------------------------------------
create table if not exists public.tva_suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  name text not null check (length(btrim(name)) > 0),
  if_number text not null check (if_number ~ '^\d{1,15}$'),
  ice text not null check (ice ~ '^\d{15}$'),
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (client_id, ice)
);

create index if not exists tva_suppliers_client_idx on public.tva_suppliers(client_id);

alter table public.tva_suppliers enable row level security;

drop policy if exists "staff manage suppliers" on public.tva_suppliers;
create policy "staff manage suppliers" on public.tva_suppliers for all
using (public.is_org_member(organization_id))
with check (
  public.is_org_member(organization_id)
  and exists (select 1 from public.clients c where c.id = client_id and c.organization_id = tva_suppliers.organization_id)
);

-- ---------------------------------------------------------------------
-- 2. Exports (piste d'audit des fichiers déposés sur SIMPL-TVA)
-- ---------------------------------------------------------------------
create table if not exists public.tva_exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  annee integer not null check (annee between 2000 and 2100),
  periode integer not null check (periode between 1 and 12),
  regime smallint not null check (regime in (1, 2)),
  line_count integer not null,
  total_tva_deductible numeric(14,2) not null,
  xml_sha256 text not null check (xml_sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text not null,
  exported_by uuid not null references public.profiles(id),
  exported_at timestamptz not null default now(),
  cancelled_by uuid references public.profiles(id),
  cancelled_at timestamptz,
  cancel_reason text,
  check (regime = 1 or periode <= 4)
);

create index if not exists tva_exports_client_idx on public.tva_exports(client_id, annee, periode);

alter table public.tva_exports enable row level security;

drop policy if exists "staff read exports" on public.tva_exports;
create policy "staff read exports" on public.tva_exports for select
using (public.is_org_member(organization_id));
-- Pas de policy INSERT/UPDATE : uniquement via les fonctions SECURITY DEFINER ci-dessous.

-- ---------------------------------------------------------------------
-- 3. Factures d'achat (lignes du relevé des déductions)
-- ---------------------------------------------------------------------
create table if not exists public.purchase_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  document_id uuid references public.documents(id) on delete restrict, -- PDF source
  supplier_id uuid references public.tva_suppliers(id) on delete set null,

  -- Données fiscales (copiées : la ligne reste figée même si le référentiel change)
  supplier_name text,
  supplier_if text,
  supplier_ice text,
  invoice_number text,
  designation text,
  invoice_date date,
  amount_ht numeric(14,2),
  tva_rate numeric(5,2) check (tva_rate is null or tva_rate in (7, 10, 14, 20)),
  amount_tva numeric(14,2),
  amount_ttc numeric(14,2),
  prorata numeric(5,2) not null default 100 check (prorata > 0 and prorata <= 100),
  payment_mode smallint check (payment_mode is null or payment_mode between 1 and 6),
  payment_date date,

  -- Lecture PDF
  extraction_confidence jsonb not null default '{}'::jsonb,
  confirmed_fields text[] not null default '{}',

  -- Validation fiduciaire
  status public.invoice_review_status not null default 'a_verifier',
  validated_by uuid references public.profiles(id) on delete set null,
  validated_at timestamptz,
  validation_hash text,
  accepted_warnings text[] not null default '{}',
  rejection_note text,

  export_id uuid references public.tva_exports(id) on delete restrict,

  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  -- Une ligne validée doit être complète et signée
  constraint purchase_invoices_valide_complete check (
    status <> 'valide' or (
      validated_by is not null and validated_at is not null and validation_hash is not null
      and supplier_name is not null and supplier_if ~ '^\d{1,15}$' and supplier_ice ~ '^\d{15}$'
      and invoice_number is not null and designation is not null and invoice_date is not null
      and amount_ht > 0 and tva_rate is not null and amount_tva is not null and amount_ttc is not null
      and abs(amount_ht + amount_tva - amount_ttc) <= 0.01
      and payment_mode is not null and payment_date is not null
    )
  ),
  -- Seule une ligne validée peut être exportée
  constraint purchase_invoices_export_valide check (export_id is null or status = 'valide')
);

create index if not exists purchase_invoices_period_idx
  on public.purchase_invoices(client_id, payment_date) where deleted_at is null;
create index if not exists purchase_invoices_status_idx on public.purchase_invoices(organization_id, status);
create index if not exists purchase_invoices_document_idx on public.purchase_invoices(document_id);

alter table public.purchase_invoices enable row level security;

drop policy if exists "staff read invoices" on public.purchase_invoices;
create policy "staff read invoices" on public.purchase_invoices for select
using (public.is_org_member(organization_id) and deleted_at is null);

drop policy if exists "staff insert invoices" on public.purchase_invoices;
create policy "staff insert invoices" on public.purchase_invoices for insert
with check (
  public.is_org_member(organization_id)
  and created_by = auth.uid()
  and status = 'a_verifier'
  and export_id is null
  and exists (select 1 from public.clients c where c.id = client_id and c.organization_id = purchase_invoices.organization_id)
);

drop policy if exists "staff update invoices" on public.purchase_invoices;
create policy "staff update invoices" on public.purchase_invoices for update
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));
-- Pas de DELETE : soft-delete via deleted_at.

-- ---------------------------------------------------------------------
-- 4. Garde-fous en base
-- ---------------------------------------------------------------------
create or replace function public.guard_purchase_invoice()
returns trigger language plpgsql security definer set search_path = public
as $$
declare fiscal_changed boolean;
begin
  fiscal_changed :=
       new.supplier_name  is distinct from old.supplier_name
    or new.supplier_if    is distinct from old.supplier_if
    or new.supplier_ice   is distinct from old.supplier_ice
    or new.invoice_number is distinct from old.invoice_number
    or new.designation    is distinct from old.designation
    or new.invoice_date   is distinct from old.invoice_date
    or new.amount_ht      is distinct from old.amount_ht
    or new.tva_rate       is distinct from old.tva_rate
    or new.amount_tva     is distinct from old.amount_tva
    or new.amount_ttc     is distinct from old.amount_ttc
    or new.prorata        is distinct from old.prorata
    or new.payment_mode   is distinct from old.payment_mode
    or new.payment_date   is distinct from old.payment_date
    or new.client_id      is distinct from old.client_id
    or new.organization_id is distinct from old.organization_id;

  -- 4.a Facture exportée : verrouillée (seule l'annulation d'export la libère)
  if old.export_id is not null and new.export_id is not distinct from old.export_id then
    if fiscal_changed or new.status is distinct from old.status or new.deleted_at is distinct from old.deleted_at
       or new.document_id is distinct from old.document_id then
      raise exception 'Facture déjà exportée vers SIMPL-TVA : annulez l''export avant toute modification.';
    end if;
  end if;

  -- 4.b export_id ne se pose que via register_tva_export / se retire via cancel_tva_export
  if new.export_id is distinct from old.export_id
     and coalesce(current_setting('tiwizi.tva_export', true), '') <> 'on' then
    raise exception 'Le rattachement à un export est réservé à la procédure d''export.';
  end if;

  -- 4.c Toute modification fiscale annule la validation
  if fiscal_changed and old.status = 'valide' then
    new.status := 'a_verifier';
    new.validated_by := null;
    new.validated_at := null;
    new.validation_hash := null;
    new.accepted_warnings := '{}';
  end if;

  -- 4.d La validation est signée par l'utilisateur courant
  if new.status = 'valide' and old.status is distinct from 'valide' then
    if new.validated_by is distinct from auth.uid() then
      raise exception 'La validation doit être faite par l''utilisateur connecté.';
    end if;
    new.validated_at := now();
  end if;

  if new.status <> 'valide' then
    new.validated_by := null;
    new.validated_at := null;
    new.validation_hash := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists purchase_invoice_guard on public.purchase_invoices;
create trigger purchase_invoice_guard
before update on public.purchase_invoices
for each row execute procedure public.guard_purchase_invoice();

-- Audit des décisions
create or replace function public.audit_purchase_invoice()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_events(organization_id, actor_id, action, entity_type, entity_id, meta)
    values (new.organization_id, auth.uid(), 'invoice.create', 'purchase_invoice', new.id,
            jsonb_build_object('client_id', new.client_id, 'document_id', new.document_id));
  elsif new.status is distinct from old.status then
    insert into public.audit_events(organization_id, actor_id, action, entity_type, entity_id, meta)
    values (new.organization_id, auth.uid(),
            case new.status when 'valide' then 'invoice.validate'
                            when 'rejete' then 'invoice.reject'
                            else 'invoice.review_reset' end,
            'purchase_invoice', new.id,
            jsonb_build_object('client_id', new.client_id, 'invoice_number', new.invoice_number,
                               'old_status', old.status, 'new_status', new.status,
                               'hash', new.validation_hash, 'accepted_warnings', new.accepted_warnings,
                               'note', new.rejection_note));
  end if;
  return new;
end;
$$;

drop trigger if exists purchase_invoice_audit on public.purchase_invoices;
create trigger purchase_invoice_audit
after insert or update on public.purchase_invoices
for each row execute procedure public.audit_purchase_invoice();

-- ---------------------------------------------------------------------
-- 5. Bornes de période (déduction au mois du paiement)
-- ---------------------------------------------------------------------
create or replace function public.tva_period_bounds(p_annee int, p_periode int, p_regime int,
                                                    out debut date, out fin date)
language plpgsql immutable
as $$
begin
  if p_regime = 1 then
    debut := make_date(p_annee, p_periode, 1);
    fin := (debut + interval '1 month' - interval '1 day')::date;
  else
    debut := make_date(p_annee, (p_periode - 1) * 3 + 1, 1);
    fin := (debut + interval '3 months' - interval '1 day')::date;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Enregistrement atomique d'un export
-- ---------------------------------------------------------------------
create or replace function public.register_tva_export(
  p_client_id uuid,
  p_annee int,
  p_periode int,
  p_regime int,
  p_invoice_ids uuid[],
  p_xml_sha256 text,
  p_storage_path text,
  p_total_tva_deductible numeric
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid;
  v_debut date;
  v_fin date;
  v_expected uuid[];
  v_export uuid;
begin
  select c.organization_id into v_org from public.clients c where c.id = p_client_id and c.deleted_at is null;
  if v_org is null or not public.is_org_member(v_org) then
    raise exception 'Accès refusé.';
  end if;

  select debut, fin into v_debut, v_fin from public.tva_period_bounds(p_annee, p_periode, p_regime);

  -- Aucune facture de la période ne doit rester à vérifier
  if exists (
    select 1 from public.purchase_invoices
    where client_id = p_client_id and deleted_at is null and status = 'a_verifier'
      and payment_date between v_debut and v_fin
  ) then
    raise exception 'Des factures de la période ne sont pas encore validées.';
  end if;

  -- Le lot exporté = exactement les factures validées, non exportées, de la période
  select coalesce(array_agg(id order by id), '{}') into v_expected
  from public.purchase_invoices
  where client_id = p_client_id and deleted_at is null and status = 'valide'
    and export_id is null and payment_date between v_debut and v_fin;

  if v_expected is distinct from (select coalesce(array_agg(x order by x), '{}') from unnest(p_invoice_ids) x) then
    raise exception 'Le lot exporté ne correspond pas aux factures validées de la période. Rechargez la page.';
  end if;
  if cardinality(v_expected) = 0 then
    raise exception 'Aucune facture validée à exporter pour cette période.';
  end if;

  insert into public.tva_exports(organization_id, client_id, annee, periode, regime, line_count,
                                 total_tva_deductible, xml_sha256, storage_path, exported_by)
  values (v_org, p_client_id, p_annee, p_periode, p_regime, cardinality(v_expected),
          p_total_tva_deductible, p_xml_sha256, p_storage_path, auth.uid())
  returning id into v_export;

  perform set_config('tiwizi.tva_export', 'on', true);
  update public.purchase_invoices set export_id = v_export where id = any(v_expected);
  perform set_config('tiwizi.tva_export', 'off', true);

  insert into public.audit_events(organization_id, actor_id, action, entity_type, entity_id, meta)
  values (v_org, auth.uid(), 'tva.export', 'tva_export', v_export,
          jsonb_build_object('client_id', p_client_id, 'annee', p_annee, 'periode', p_periode,
                             'regime', p_regime, 'lines', cardinality(v_expected), 'sha256', p_xml_sha256));
  return v_export;
end;
$$;

grant execute on function public.register_tva_export(uuid, int, int, int, uuid[], text, text, numeric) to authenticated;

-- Annulation d'un export (propriétaire du cabinet uniquement) — libère les factures
create or replace function public.cancel_tva_export(p_export_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.tva_exports where id = p_export_id and cancelled_at is null;
  if v_org is null then raise exception 'Export introuvable ou déjà annulé.'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and organization_id = v_org and role = 'owner') then
    raise exception 'Seul le propriétaire du cabinet peut annuler un export.';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Motif d''annulation obligatoire.'; end if;

  update public.tva_exports
     set cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = p_reason
   where id = p_export_id;

  perform set_config('tiwizi.tva_export', 'on', true);
  update public.purchase_invoices set export_id = null where export_id = p_export_id;
  perform set_config('tiwizi.tva_export', 'off', true);

  insert into public.audit_events(organization_id, actor_id, action, entity_type, entity_id, meta)
  values (v_org, auth.uid(), 'tva.export_cancel', 'tva_export', p_export_id, jsonb_build_object('reason', p_reason));
end;
$$;

grant execute on function public.cancel_tva_export(uuid, text) to authenticated;
