-- Fido Phase 2: production workflow hardening
-- Safe to run after schema.sql + existing phase migrations.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_recipient_idx on public.notifications(recipient_id, read_at, created_at desc);
create index if not exists notifications_org_idx on public.notifications(organization_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "users can view own notifications" on public.notifications;
create policy "users can view own notifications" on public.notifications for select
using (recipient_id = auth.uid());

drop policy if exists "users can update own notifications" on public.notifications;
create policy "users can update own notifications" on public.notifications for update
using (recipient_id = auth.uid())
with check (recipient_id = auth.uid());

create or replace function public.safe_uuid(value text)
returns uuid
language plpgsql immutable
as $$
begin
  return value::uuid;
exception when others then
  return null;
end;
$$;

create or replace function public.notify_request_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  client_profile uuid;
begin
  select profile_id into client_profile from public.clients where id = new.client_id;
  if client_profile is not null then
    insert into public.notifications(organization_id, recipient_id, type, title, body, entity_type, entity_id)
    values (new.organization_id, client_profile, 'document_request', 'Nouveau document demandé', new.title, 'document_request', new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists document_request_notification on public.document_requests;
create trigger document_request_notification
after insert on public.document_requests
for each row execute procedure public.notify_request_created();

create or replace function public.mark_request_received()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.request_id is not null then
    update public.document_requests
    set status = 'received'
    where id = new.request_id
      and client_id = new.client_id
      and status = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists document_received_request_status on public.documents;
create trigger document_received_request_status
after insert on public.documents
for each row execute procedure public.mark_request_received();

-- Replace the broad storage insert policy with tenant-aware paths:
drop policy if exists "Fido document upload access" on storage.objects;
create policy "Fido document upload access" on storage.objects for insert
with check (
  bucket_id = 'documents'
  and auth.role() = 'authenticated'
  and (
    (
      public.is_org_member(public.safe_uuid((storage.foldername(name))[1]))
      and (storage.foldername(name))[2] is not null
    )
    or
    (
      public.is_client_user(public.safe_uuid((storage.foldername(name))[2]))
      and (storage.foldername(name))[1] is not null
    )
  )
);

drop policy if exists "Fido document read access" on storage.objects;
create policy "Fido document read access" on storage.objects for select
using (
  bucket_id = 'documents'
  and (
    public.is_org_member(public.safe_uuid((storage.foldername(name))[1]))
    or public.is_client_user(public.safe_uuid((storage.foldername(name))[2]))
  )
);

create or replace function public.safe_uuid(value text)
returns uuid
language plpgsql immutable
as $$
begin
  return value::uuid;
exception when others then
  return null;
end;
$$;

create index if not exists documents_request_idx on public.documents(request_id, created_at desc);
create index if not exists requests_org_status_idx on public.document_requests(organization_id, status, due_date);
create index if not exists messages_org_created_idx on public.messages(organization_id, created_at desc);

-- Prevent accidentally trusting a client-supplied organization id when a document is inserted.
create or replace function public.validate_document_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare c_org uuid;
begin
  select organization_id into c_org from public.clients where id = new.client_id;
  if c_org is null or c_org <> new.organization_id then
    raise exception 'Invalid client organization';
  end if;
  if new.uploaded_by <> auth.uid() then
    raise exception 'Invalid uploader';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_document_tenant_trigger on public.documents;
create trigger validate_document_tenant_trigger
before insert on public.documents
for each row execute procedure public.validate_document_tenant();


create or replace function public.notify_document_received()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications(organization_id, recipient_id, type, title, body, entity_type, entity_id)
  select new.organization_id, p.id, 'document_received', 'Nouveau document reçu',
         new.name, 'document', new.id
  from public.profiles p
  where p.organization_id = new.organization_id
    and p.role in ('owner','staff')
    and p.id <> new.uploaded_by;
  return new;
end;
$$;

drop trigger if exists document_received_notification on public.documents;
create trigger document_received_notification
after insert on public.documents
for each row execute procedure public.notify_document_received();

create or replace function public.notify_message_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.profiles p where p.id = new.sender_id and p.role = 'client') then
    insert into public.notifications(organization_id, recipient_id, type, title, body, entity_type, entity_id)
    select new.organization_id, p.id, 'message', 'Nouveau message client',
           left(new.body, 140), 'client', new.client_id
    from public.profiles p
    where p.organization_id = new.organization_id
      and p.role in ('owner','staff');
  end if;
  return new;
end;
$$;

drop trigger if exists message_notification on public.messages;
create trigger message_notification
after insert on public.messages
for each row execute procedure public.notify_message_created();
