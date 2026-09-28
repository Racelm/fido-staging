-- Fido Phase 3: normalize client status constraints and invitation-safe signup behavior.

-- The original phase migration created an active/inactive check before invited status existed.
-- Remove the restrictive checks and keep one canonical lifecycle constraint.
alter table public.clients drop constraint if exists clients_status_check;
alter table public.clients drop constraint if exists clients_status_check1;

do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.clients'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%status%'
  loop
    execute format('alter table public.clients drop constraint if exists %I', c.conname);
  end loop;
end $$;

alter table public.clients
  add constraint clients_status_check
  check (status in ('active', 'invited', 'inactive'));

-- Invitation signups must not accidentally create an empty cabinet.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org uuid;
  cabinet_name text;
  user_name text;
begin
  cabinet_name := nullif(trim(new.raw_user_meta_data->>'cabinet_name'), '');
  user_name := coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1));

  if cabinet_name is null then
    return new;
  end if;

  insert into public.organizations(name)
  values (cabinet_name)
  returning id into new_org;

  insert into public.profiles(id, organization_id, full_name, role)
  values (new.id, new_org, user_name, 'owner')
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Ensure the latest owner-bootstrap trigger is the active one.
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
