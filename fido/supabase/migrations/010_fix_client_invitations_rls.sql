-- Fido Phase 10 : fix RLS INSERT pour client_invitations
--
-- Bug : la table `client_invitations` avait RLS activé mais SEULEMENT une
-- policy SELECT pour les staff/owner. Sans policy INSERT, le serveur ne pouvait
-- PAS créer d'invitation même en étant owner → "new row violates RLS".
--
-- Idempotent — peut être rejoué sans effet secondaire.

-- 1. INSERT : staff/owner du même tenant peuvent créer une invitation
drop policy if exists "staff can create invitations" on public.client_invitations;
create policy "staff can create invitations" on public.client_invitations for insert
with check (
  exists (
    select 1 from public.clients c
    join public.profiles p on p.organization_id = c.organization_id
    where c.id = client_invitations.client_id
      and p.id = auth.uid()
      and p.role in ('owner','staff')
  )
);

-- 2. UPDATE : staff/owner du même tenant peuvent régénérer / révoquer
--    (ex. prolonger expires_at, régénérer un token)
drop policy if exists "staff can update invitations" on public.client_invitations;
create policy "staff can update invitations" on public.client_invitations for update
using (
  exists (
    select 1 from public.clients c
    join public.profiles p on p.organization_id = c.organization_id
    where c.id = client_invitations.client_id
      and p.id = auth.uid()
      and p.role in ('owner','staff')
  )
)
with check (
  exists (
    select 1 from public.clients c
    join public.profiles p on p.organization_id = c.organization_id
    where c.id = client_invitations.client_id
      and p.id = auth.uid()
      and p.role in ('owner','staff')
  )
);

-- 3. DELETE : staff/owner peuvent supprimer une invitation non consommée
drop policy if exists "staff can delete invitations" on public.client_invitations;
create policy "staff can delete invitations" on public.client_invitations for delete
using (
  exists (
    select 1 from public.clients c
    join public.profiles p on p.organization_id = c.organization_id
    where c.id = client_invitations.client_id
      and p.id = auth.uid()
      and p.role in ('owner','staff')
  )
);
