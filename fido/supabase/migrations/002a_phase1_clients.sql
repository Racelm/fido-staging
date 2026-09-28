-- Fido Phase 1: client lifecycle and signup bootstrap

alter table public.clients
  add column if not exists status text not null default 'active';

alter table public.clients
  add constraint clients_status_check
  check (status in ('active', 'invited', 'inactive'));

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
  cabinet_name := coalesce(nullif(trim(new.raw_user_meta_data->>'cabinet_name'), ''), 'Mon cabinet');
  user_name := coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1));

  insert into public.organizations(name)
  values (cabinet_name)
  returning id into new_org;

  insert into public.profiles(id, organization_id, full_name, role)
  values (new.id, new_org, user_name, 'owner')
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Cabinet owners/staff can create clients. Clients can only read their own client record.
create policy "staff can insert clients" on public.clients for insert
with check (
  public.is_org_member(organization_id)
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('owner','staff')
  )
);
