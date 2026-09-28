-- Fido client invitations
create table if not exists public.client_invitations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists client_invitations_token_idx on public.client_invitations(token_hash);

alter table public.client_invitations enable row level security;

create policy "staff can view invitations" on public.client_invitations for select
using (exists (
  select 1 from public.clients c
  join public.profiles p on p.organization_id = c.organization_id
  where c.id = client_invitations.client_id and p.id = auth.uid() and p.role in ('owner','staff')
));

create or replace function public.claim_client_invitation(invitation_token_hash text, user_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation public.client_invitations;
  client_record public.clients;
  org_id uuid;
  profile_role public.user_role;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select * into invitation
  from public.client_invitations
  where token_hash = invitation_token_hash
    and accepted_at is null
    and expires_at > now()
  limit 1;

  if invitation.id is null then raise exception 'Invitation invalide ou expirée'; end if;
  if lower(coalesce(auth.jwt()->>'email','')) <> lower(invitation.email) then
    raise exception 'Cette invitation est liée à une autre adresse e-mail';
  end if;

  select * into client_record from public.clients where id = invitation.client_id;
  if client_record.id is null then raise exception 'Client introuvable'; end if;

  org_id := client_record.organization_id;
  insert into public.profiles(id, organization_id, full_name, role)
  values (auth.uid(), org_id, nullif(trim(user_name), ''), 'client')
  on conflict (id) do update set organization_id = excluded.organization_id, full_name = excluded.full_name, role = 'client';

  update public.clients set profile_id = auth.uid(), status = 'active' where id = invitation.client_id;
  update public.client_invitations set accepted_at = now() where id = invitation.id;
  return invitation.client_id;
end;
$$;

grant execute on function public.claim_client_invitation(text, text) to authenticated;
