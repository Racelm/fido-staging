-- =====================================================================
-- Fido — Migration 007 : Invitations collaborateurs (staff)
-- =====================================================================
-- Permet au propriétaire du cabinet d'inviter un collaborateur (rôle staff).
-- Flow : owner crée invitation → e-mail avec token → bénéficiaire crée un
-- compte Supabase Auth → RPC claim_staff_invitation attache son profil
-- comme staff dans l'organisation du propriétaire.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Table staff_invitations
-- ---------------------------------------------------------------------
-- Colonnes nullable + defaults : tolérant à différents payloads côté client.
create table if not exists public.staff_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'staff' check (role in ('staff', 'owner')),
  token_hash text,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  used_at timestamptz generated always as (accepted_at) stored,
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists staff_invitations_org_idx on public.staff_invitations(organization_id, created_at desc);
create index if not exists staff_invitations_token_idx on public.staff_invitations(token_hash) where accepted_at is null;
create index if not exists staff_invitations_email_idx on public.staff_invitations(email);

-- ---------------------------------------------------------------------
-- 2. RLS
-- ---------------------------------------------------------------------
alter table public.staff_invitations enable row level security;

-- Lecture : owner et staff de l'org peuvent voir leurs invitations
drop policy if exists "org members read staff invitations" on public.staff_invitations;
create policy "org members read staff invitations" on public.staff_invitations for select
using (public.is_org_member(organization_id));

-- Insertion : UNIQUEMENT les owners
drop policy if exists "owners create staff invitations" on public.staff_invitations;
create policy "owners create staff invitations" on public.staff_invitations for insert
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'owner'
      and p.organization_id = staff_invitations.organization_id
  )
);

-- Update : owners de la même org (pour révoquer / étendre expiration)
drop policy if exists "owners update staff invitations" on public.staff_invitations;
create policy "owners update staff invitations" on public.staff_invitations for update
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'owner'
      and p.organization_id = staff_invitations.organization_id
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'owner'
      and p.organization_id = staff_invitations.organization_id
  )
);

-- Delete : owners seulement
drop policy if exists "owners delete staff invitations" on public.staff_invitations;
create policy "owners delete staff invitations" on public.staff_invitations for delete
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'owner'
      and p.organization_id = staff_invitations.organization_id
  )
);

-- ---------------------------------------------------------------------
-- 3. RPC claim_staff_invitation
-- ---------------------------------------------------------------------
-- Appelée par le bénéficiaire une fois son compte Supabase Auth créé.
-- Vérifie le token, l'expiration, attache le profil à l'organisation
-- avec rôle 'staff', marque l'invitation acceptée.
-- ---------------------------------------------------------------------
create or replace function public.claim_staff_invitation(
  invitation_token_hash text,
  user_name text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_invitation public.staff_invitations;
  v_profile_exists boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_invitation
  from public.staff_invitations
  where token_hash = invitation_token_hash
    and accepted_at is null
    and expires_at > now()
  limit 1;

  if not found then
    raise exception 'Invitation introuvable ou expirée';
  end if;

  -- Crée ou met à jour le profil : rôle 'staff' dans l'org cible
  select exists(select 1 from public.profiles where id = auth.uid()) into v_profile_exists;

  if v_profile_exists then
    update public.profiles
    set role = 'staff',
        organization_id = v_invitation.organization_id,
        full_name = coalesce(nullif(trim(user_name), ''), full_name, v_invitation.full_name)
    where id = auth.uid();
  else
    insert into public.profiles(id, role, organization_id, full_name)
    values (
      auth.uid(),
      'staff',
      v_invitation.organization_id,
      coalesce(nullif(trim(user_name), ''), v_invitation.full_name)
    );
  end if;

  -- Marque l'invitation comme acceptée
  update public.staff_invitations
  set accepted_at = now()
  where id = v_invitation.id;

  -- Audit
  insert into public.audit_events(organization_id, actor_id, action, entity_type, entity_id, meta)
  values (
    v_invitation.organization_id,
    auth.uid(),
    'staff.join',
    'staff_invitation',
    v_invitation.id,
    jsonb_build_object('email', v_invitation.email)
  );

  return v_invitation.organization_id;
end;
$$;

grant execute on function public.claim_staff_invitation(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Audit trigger (invitation créée)
-- ---------------------------------------------------------------------
create or replace function public.audit_on_staff_invitation()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.audit_events(organization_id, actor_id, action, entity_type, entity_id, meta)
  values (
    new.organization_id, new.invited_by, 'staff.invite', 'staff_invitation', new.id,
    jsonb_build_object('email', new.email, 'role', new.role)
  );
  return new;
end;
$$;

drop trigger if exists audit_staff_invitation_insert on public.staff_invitations;
create trigger audit_staff_invitation_insert
after insert on public.staff_invitations
for each row execute procedure public.audit_on_staff_invitation();
