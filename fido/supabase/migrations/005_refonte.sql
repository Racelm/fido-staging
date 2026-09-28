-- =====================================================================
-- Fido — Migration 005 : Refonte sécurité + fonctionnalités fiduciaires
-- =====================================================================
-- Applique les corrections critiques (C4, C5, C7), ajoute les tables
-- d'audit / versionnage, la catégorisation documentaire, le soft-delete
-- et resserre les policies storage.
--
-- IDEMPOTENT : sûre à exécuter plusieurs fois.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Extensions et types
-- ---------------------------------------------------------------------
create extension if not exists pgcrypto;

-- Catégories documentaires standard fiduciaire Maroc
do $$
begin
  if not exists (select 1 from pg_type where typname = 'document_category') then
    create type public.document_category as enum (
      'piece_comptable',
      'facture_achat',
      'facture_vente',
      'releve_bancaire',
      'contrat',
      'statuts',
      'proces_verbal',
      'cin',
      'registre_commerce',
      'ice_if',
      'cnss',
      'tva',
      'is_ir',
      'autre'
    );
  end if;
end $$;

-- Périodicité TVA (utilisé sur clients)
do $$
begin
  if not exists (select 1 from pg_type where typname = 'tva_period') then
    create type public.tva_period as enum ('mensuel', 'trimestriel', 'exonere');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Colonnes fiduciaires + soft-delete + limites
-- ---------------------------------------------------------------------
alter table public.clients
  add column if not exists ice text,
  add column if not exists if_number text,
  add column if not exists rc_number text,
  add column if not exists cnss_number text,
  add column if not exists patente_number text,
  add column if not exists fiscal_year_start date,
  add column if not exists tva_period public.tva_period,
  add column if not exists deleted_at timestamptz;

create index if not exists clients_deleted_idx on public.clients(deleted_at);

alter table public.documents
  add column if not exists category public.document_category not null default 'autre',
  add column if not exists version integer not null default 1,
  add column if not exists deleted_at timestamptz;

create index if not exists documents_deleted_idx on public.documents(deleted_at);
create index if not exists documents_category_idx on public.documents(category);

alter table public.document_requests
  add column if not exists category public.document_category not null default 'autre';

-- Contraintes taille/MIME côté DB (défense en profondeur)
alter table public.documents
  drop constraint if exists documents_size_check;
alter table public.documents
  add constraint documents_size_check
  check (size_bytes is null or size_bytes <= 26214400); -- 25 MB

-- MIME whitelist (pdf, images courantes, bureautique)
alter table public.documents
  drop constraint if exists documents_mime_check;
alter table public.documents
  add constraint documents_mime_check
  check (
    mime_type is null or mime_type in (
      'application/pdf',
      'image/jpeg', 'image/png', 'image/webp', 'image/heic',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv', 'text/plain',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    )
  );

-- ---------------------------------------------------------------------
-- 2. Table document_versions (historique complet)
-- ---------------------------------------------------------------------
create table if not exists public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  version integer not null,
  name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (document_id, version)
);

create index if not exists document_versions_doc_idx on public.document_versions(document_id, version desc);

alter table public.document_versions enable row level security;

drop policy if exists "members can view versions" on public.document_versions;
create policy "members can view versions" on public.document_versions for select
using (public.is_org_member(organization_id) or public.is_client_user(client_id));

drop policy if exists "authorized can insert versions" on public.document_versions;
create policy "authorized can insert versions" on public.document_versions for insert
with check (
  uploaded_by = auth.uid()
  and (public.is_org_member(organization_id) or public.is_client_user(client_id))
);

-- Snapshot automatique : à chaque insert d'un document, on stocke la version courante.
create or replace function public.snapshot_document_version()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.document_versions(
    document_id, organization_id, client_id, version, name,
    storage_path, mime_type, size_bytes, uploaded_by
  ) values (
    new.id, new.organization_id, new.client_id, new.version, new.name,
    new.storage_path, new.mime_type, new.size_bytes, new.uploaded_by
  );
  return new;
end;
$$;

drop trigger if exists document_version_snapshot on public.documents;
create trigger document_version_snapshot
after insert on public.documents
for each row execute procedure public.snapshot_document_version();

-- ---------------------------------------------------------------------
-- 3. Journal d'audit (loi 09-08 / Conseil de l'Ordre)
-- ---------------------------------------------------------------------
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,          -- ex: 'document.upload', 'document.download', 'client.create'
  entity_type text not null,     -- ex: 'document', 'client', 'message', 'invitation'
  entity_id uuid,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_org_idx on public.audit_events(organization_id, created_at desc);
create index if not exists audit_events_entity_idx on public.audit_events(entity_type, entity_id);

alter table public.audit_events enable row level security;

-- Owners voient tout l'audit de leur organisation ; staff voit aussi.
drop policy if exists "org staff can read audit" on public.audit_events;
create policy "org staff can read audit" on public.audit_events for select
using (public.is_org_member(organization_id));

-- Insertion via SECURITY DEFINER uniquement — pas d'accès direct anon/authenticated.
-- (Aucune policy INSERT créée volontairement.)

create or replace function public.log_audit_event(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_organization_id uuid,
  p_meta jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare new_id uuid;
begin
  insert into public.audit_events(organization_id, actor_id, action, entity_type, entity_id, meta)
  values (p_organization_id, auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_meta, '{}'::jsonb))
  returning id into new_id;
  return new_id;
end;
$$;

grant execute on function public.log_audit_event(text, text, uuid, uuid, jsonb) to authenticated;

-- Triggers automatiques d'audit
create or replace function public.audit_on_document_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.audit_events(organization_id, actor_id, action, entity_type, entity_id, meta)
  values (
    new.organization_id, new.uploaded_by, 'document.upload', 'document', new.id,
    jsonb_build_object(
      'name', new.name, 'category', new.category, 'version', new.version,
      'size_bytes', new.size_bytes, 'mime_type', new.mime_type
    )
  );
  return new;
end;
$$;

drop trigger if exists audit_document_insert on public.documents;
create trigger audit_document_insert
after insert on public.documents
for each row execute procedure public.audit_on_document_insert();

create or replace function public.audit_on_client_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.audit_events(organization_id, actor_id, action, entity_type, entity_id, meta)
  values (new.organization_id, auth.uid(), 'client.create', 'client', new.id,
          jsonb_build_object('company_name', new.company_name));
  return new;
end;
$$;

drop trigger if exists audit_client_insert on public.clients;
create trigger audit_client_insert
after insert on public.clients
for each row execute procedure public.audit_on_client_insert();

create or replace function public.audit_on_request_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.audit_events(organization_id, actor_id, action, entity_type, entity_id, meta)
  values (new.organization_id, new.created_by, 'request.create', 'document_request', new.id,
          jsonb_build_object('title', new.title, 'client_id', new.client_id, 'due_date', new.due_date));
  return new;
end;
$$;

drop trigger if exists audit_request_insert on public.document_requests;
create trigger audit_request_insert
after insert on public.document_requests
for each row execute procedure public.audit_on_request_insert();

-- ---------------------------------------------------------------------
-- 4. Fixes RLS (C4, C5, C7)
-- ---------------------------------------------------------------------

-- 4.a documents INSERT : ne plus faire confiance à uploaded_by côté client.
drop policy if exists "authenticated users can upload documents" on public.documents;
create policy "authenticated users can upload documents" on public.documents for insert
with check (
  uploaded_by = auth.uid()
  and (
    (public.is_org_member(organization_id))
    or (public.is_client_user(client_id))
  )
);

-- 4.b documents SELECT : masquer les soft-deleted par défaut
drop policy if exists "members can view documents" on public.documents;
create policy "members can view documents" on public.documents for select
using (
  deleted_at is null
  and (public.is_org_member(organization_id) or public.is_client_user(client_id))
);

-- 4.c documents UPDATE : seuls owner/staff peuvent modifier
drop policy if exists "staff can update documents" on public.documents;
create policy "staff can update documents" on public.documents for update
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

-- 4.d clients SELECT : filtre soft-delete
drop policy if exists "members can view clients" on public.clients;
create policy "members can view clients" on public.clients for select
using (
  deleted_at is null
  and (public.is_org_member(organization_id) or public.is_client_user(id))
);

-- 4.e messages : sender_id doit correspondre à auth.uid ET l'utilisateur doit appartenir au tenant
drop policy if exists "members can send messages" on public.messages;
create policy "members can send messages" on public.messages for insert
with check (
  sender_id = auth.uid()
  and (
    -- Staff/owner : profile.organization_id doit matcher l'org du client
    (
      exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.role in ('owner','staff')
          and p.organization_id = messages.organization_id
      )
      and exists (
        select 1 from public.clients c
        where c.id = messages.client_id
          and c.organization_id = messages.organization_id
      )
    )
    or
    -- Client : le profil client doit être rattaché à ce client
    exists (
      select 1 from public.clients c
      join public.profiles p on p.id = c.profile_id
      where c.id = messages.client_id
        and c.organization_id = messages.organization_id
        and p.id = auth.uid()
        and p.role = 'client'
    )
  )
);

-- 4.f storage.objects INSERT : contraindre le chemin {organization_id}/{client_id}/*
-- (Reprise + durcissement de la policy 003 : on refuse les inserts d'un client dans le path d'un autre.)
drop policy if exists "Fido document upload access" on storage.objects;
create policy "Fido document upload access" on storage.objects for insert
with check (
  bucket_id = 'documents'
  and auth.role() = 'authenticated'
  and public.safe_uuid((storage.foldername(name))[1]) is not null
  and public.safe_uuid((storage.foldername(name))[2]) is not null
  and (
    -- Staff : org member ET le client appartient bien à cette org
    (
      public.is_org_member(public.safe_uuid((storage.foldername(name))[1]))
      and exists (
        select 1 from public.clients c
        where c.id = public.safe_uuid((storage.foldername(name))[2])
          and c.organization_id = public.safe_uuid((storage.foldername(name))[1])
      )
    )
    or
    -- Client : le sous-dossier client doit être le sien, dans la bonne org
    (
      public.is_client_user(public.safe_uuid((storage.foldername(name))[2]))
      and exists (
        select 1 from public.clients c
        where c.id = public.safe_uuid((storage.foldername(name))[2])
          and c.organization_id = public.safe_uuid((storage.foldername(name))[1])
      )
    )
  )
);

-- 4.g storage.objects SELECT (idem, en lecture)
drop policy if exists "Fido document read access" on storage.objects;
create policy "Fido document read access" on storage.objects for select
using (
  bucket_id = 'documents'
  and public.safe_uuid((storage.foldername(name))[1]) is not null
  and (
    public.is_org_member(public.safe_uuid((storage.foldername(name))[1]))
    or public.is_client_user(public.safe_uuid((storage.foldername(name))[2]))
  )
);

-- 4.h storage.objects DELETE : uniquement staff/owner
drop policy if exists "Fido document delete access" on storage.objects;
create policy "Fido document delete access" on storage.objects for delete
using (
  bucket_id = 'documents'
  and public.safe_uuid((storage.foldername(name))[1]) is not null
  and public.is_org_member(public.safe_uuid((storage.foldername(name))[1]))
);

-- ---------------------------------------------------------------------
-- 5. Casser les cascades destructrices (soft-delete)
-- ---------------------------------------------------------------------
-- Ne plus supprimer physiquement les documents/requêtes quand un client
-- est supprimé — on soft-delete côté application via deleted_at.
-- On conserve toutefois les FKs on delete cascade sur `organizations`
-- (suppression volontaire d'un cabinet = suppression complète).

alter table public.document_requests
  drop constraint if exists document_requests_client_id_fkey,
  add constraint document_requests_client_id_fkey
    foreign key (client_id) references public.clients(id) on delete restrict;

alter table public.documents
  drop constraint if exists documents_client_id_fkey,
  add constraint documents_client_id_fkey
    foreign key (client_id) references public.clients(id) on delete restrict;

alter table public.messages
  drop constraint if exists messages_client_id_fkey,
  add constraint messages_client_id_fkey
    foreign key (client_id) references public.clients(id) on delete restrict;

-- Aide : fonction pour archiver un client (soft-delete)
create or replace function public.archive_client(target_client uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.clients c
    join public.profiles p on p.organization_id = c.organization_id
    where c.id = target_client and p.id = auth.uid() and p.role in ('owner','staff')
  ) then
    raise exception 'Not authorized';
  end if;
  update public.clients set deleted_at = now() where id = target_client and deleted_at is null;
  update public.documents set deleted_at = now() where client_id = target_client and deleted_at is null;
  insert into public.audit_events(organization_id, actor_id, action, entity_type, entity_id, meta)
  select organization_id, auth.uid(), 'client.archive', 'client', target_client, '{}'::jsonb
  from public.clients where id = target_client;
end;
$$;

grant execute on function public.archive_client(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Trigger : incrémenter la version quand un document du même client
--    est ré-uploadé avec le même nom (versionnement).
-- ---------------------------------------------------------------------
create or replace function public.bump_document_version()
returns trigger language plpgsql security definer set search_path = public
as $$
declare last_version int;
begin
  select coalesce(max(d.version), 0) into last_version
  from public.documents d
  where d.client_id = new.client_id
    and d.name = new.name
    and d.deleted_at is null
    and d.id <> new.id;
  if last_version >= 1 then
    new.version := last_version + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists document_version_bump on public.documents;
create trigger document_version_bump
before insert on public.documents
for each row execute procedure public.bump_document_version();
