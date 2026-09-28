-- Fido initial data model
-- Run this file once in the Supabase SQL editor.

create extension if not exists pgcrypto;

create type public.user_role as enum ('owner', 'staff', 'client');
create type public.document_status as enum ('pending', 'received', 'processed');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  full_name text,
  role public.user_role not null default 'client',
  created_at timestamptz not null default now()
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid unique references public.profiles(id) on delete set null,
  company_name text not null,
  contact_name text,
  email text,
  phone text,
  created_at timestamptz not null default now()
);

create table public.document_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null,
  description text,
  status public.document_status not null default 'pending',
  due_date date,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  request_id uuid references public.document_requests(id) on delete set null,
  name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  body text not null,
  created_at timestamptz not null default now()
);

create index clients_org_idx on public.clients(organization_id);
create index requests_client_idx on public.document_requests(client_id);
create index documents_client_idx on public.documents(client_id);
create index messages_client_idx on public.messages(client_id);

create or replace function public.is_org_member(target_org uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and organization_id = target_org);
$$;

create or replace function public.is_client_user(target_client uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.clients c
    join public.profiles p on p.id = c.profile_id
    where c.id = target_client and p.id = auth.uid() and p.role = 'client'
  );
$$;

create or replace function public.create_cabinet(cabinet_name text, user_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare new_org uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then
    return (select organization_id from public.profiles where id = auth.uid());
  end if;
  insert into public.organizations(name) values (cabinet_name) returning id into new_org;
  insert into public.profiles(id, organization_id, full_name, role)
    values (auth.uid(), new_org, user_name, 'owner');
  return new_org;
end;
$$;

grant execute on function public.create_cabinet(text, text) to authenticated;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.document_requests enable row level security;
alter table public.documents enable row level security;
alter table public.messages enable row level security;

create policy "members can view organization" on public.organizations for select using (public.is_org_member(id));
create policy "users can view own profile" on public.profiles for select using (id = auth.uid() or public.is_org_member(organization_id));

create policy "members can view clients" on public.clients for select
using (public.is_org_member(organization_id) or public.is_client_user(id));
create policy "staff can manage clients" on public.clients for all
using (public.is_org_member(organization_id) and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner','staff')))
with check (public.is_org_member(organization_id) and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner','staff')));

create policy "members can view requests" on public.document_requests for select
using (public.is_org_member(organization_id) or public.is_client_user(client_id));
create policy "staff can create requests" on public.document_requests for insert
with check (public.is_org_member(organization_id) and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner','staff')));
create policy "staff or client can update request" on public.document_requests for update
using (public.is_org_member(organization_id) or public.is_client_user(client_id))
with check (public.is_org_member(organization_id) or public.is_client_user(client_id));

create policy "members can view documents" on public.documents for select
using (public.is_org_member(organization_id) or public.is_client_user(client_id));
create policy "authenticated users can upload documents" on public.documents for insert
with check (public.is_org_member(organization_id) or public.is_client_user(client_id));

create policy "members can view messages" on public.messages for select
using (public.is_org_member(organization_id) or public.is_client_user(client_id));
create policy "members can send messages" on public.messages for insert
with check (sender_id = auth.uid() and (public.is_org_member(organization_id) or public.is_client_user(client_id)));

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

create policy "Fido document read access" on storage.objects for select
using (
  bucket_id = 'documents' and exists (
    select 1 from public.documents d
    where d.storage_path = name
      and (public.is_org_member(d.organization_id) or public.is_client_user(d.client_id))
  )
);
create policy "Fido document upload access" on storage.objects for insert
with check (bucket_id = 'documents' and auth.role() = 'authenticated');
