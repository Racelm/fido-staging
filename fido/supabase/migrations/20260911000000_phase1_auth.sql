-- Phase 1: authentication, tenant bootstrap and least-privilege role helpers.
-- Apply after supabase/schema.sql. This migration is safe to run once on an existing project.

alter table public.clients add column if not exists status text not null default 'active'
  check (status in ('active', 'inactive'));

-- A client belongs to an organization but is not an internal cabinet member.
create or replace function public.is_org_member(target_org uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and organization_id = target_org
      and role in ('owner', 'staff')
  );
$$;

-- Creates an owner tenant when Supabase Auth creates a new cabinet account.
create or replace function public.handle_new_cabinet_owner()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  new_org uuid;
  cabinet text := nullif(trim(new.raw_user_meta_data ->> 'cabinet_name'), '');
  owner_name text := nullif(trim(new.raw_user_meta_data ->> 'full_name'), '');
begin
  if cabinet is null then return new; end if;
  insert into public.organizations (name) values (cabinet) returning id into new_org;
  insert into public.profiles (id, organization_id, full_name, role)
  values (new.id, new_org, coalesce(owner_name, new.email), 'owner')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_cabinet_owner();

-- Keep the legacy RPC safe for existing accounts; new registrations use the trigger above.
create or replace function public.create_cabinet(cabinet_name text, user_name text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare new_org uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then
    return (select organization_id from public.profiles where id = auth.uid());
  end if;
  if nullif(trim(cabinet_name), '') is null then raise exception 'Cabinet name is required'; end if;
  insert into public.organizations(name) values (trim(cabinet_name)) returning id into new_org;
  insert into public.profiles(id, organization_id, full_name, role)
    values (auth.uid(), new_org, nullif(trim(user_name), ''), 'owner');
  return new_org;
end;
$$;
