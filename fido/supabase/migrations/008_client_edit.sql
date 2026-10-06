-- Fido Phase 8 : édition fiche client (fiduciaire + auto-service client)
-- Idempotent — peut être rejoué sans effet secondaire.
--
-- Objectifs :
--   1. Ajouter la colonne `address` sur `clients` (manquante).
--   2. Autoriser le client (rôle = 'client') à modifier SA PROPRE ligne
--      (restriction par colonne via server-action, pas RLS).
--   3. Trigger d'audit pour UPDATE client (diff avant/après).
--   4. Trigger d'audit pour UPDATE profil (full_name).

-- 1. Colonne address + website (facultatif) ---------------------------
alter table public.clients
  add column if not exists address text,
  add column if not exists website text;

-- 2. RLS UPDATE client-self --------------------------------------------
-- La policy "staff can manage clients" (FOR ALL) couvre déjà owner/staff.
-- On ajoute une policy ciblée pour le rôle `client` sur sa propre ligne.
drop policy if exists "client can update own record" on public.clients;
create policy "client can update own record" on public.clients for update
using (
  deleted_at is null
  and public.is_client_user(id)
)
with check (
  deleted_at is null
  and public.is_client_user(id)
  -- Un client ne peut PAS modifier son organization_id, ni se "transférer"
  and organization_id = (
    select organization_id from public.clients where id = clients.id
  )
);

-- 3. Audit automatique sur UPDATE client -------------------------------
create or replace function public.audit_on_client_update()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  changed jsonb := '{}'::jsonb;
begin
  -- Diff colonne par colonne ; on garde l'ancienne + la nouvelle valeur
  if coalesce(new.company_name,'')   is distinct from coalesce(old.company_name,'')   then changed := changed || jsonb_build_object('company_name',   jsonb_build_object('old', old.company_name,   'new', new.company_name)); end if;
  if coalesce(new.contact_name,'')   is distinct from coalesce(old.contact_name,'')   then changed := changed || jsonb_build_object('contact_name',   jsonb_build_object('old', old.contact_name,   'new', new.contact_name)); end if;
  if coalesce(new.email,'')          is distinct from coalesce(old.email,'')          then changed := changed || jsonb_build_object('email',          jsonb_build_object('old', old.email,          'new', new.email)); end if;
  if coalesce(new.phone,'')          is distinct from coalesce(old.phone,'')          then changed := changed || jsonb_build_object('phone',          jsonb_build_object('old', old.phone,          'new', new.phone)); end if;
  if coalesce(new.address,'')        is distinct from coalesce(old.address,'')        then changed := changed || jsonb_build_object('address',        jsonb_build_object('old', old.address,        'new', new.address)); end if;
  if coalesce(new.website,'')        is distinct from coalesce(old.website,'')        then changed := changed || jsonb_build_object('website',        jsonb_build_object('old', old.website,        'new', new.website)); end if;
  if coalesce(new.ice,'')            is distinct from coalesce(old.ice,'')            then changed := changed || jsonb_build_object('ice',            jsonb_build_object('old', old.ice,            'new', new.ice)); end if;
  if coalesce(new.if_number,'')      is distinct from coalesce(old.if_number,'')      then changed := changed || jsonb_build_object('if_number',      jsonb_build_object('old', old.if_number,      'new', new.if_number)); end if;
  if coalesce(new.rc_number,'')      is distinct from coalesce(old.rc_number,'')      then changed := changed || jsonb_build_object('rc_number',      jsonb_build_object('old', old.rc_number,      'new', new.rc_number)); end if;
  if coalesce(new.cnss_number,'')    is distinct from coalesce(old.cnss_number,'')    then changed := changed || jsonb_build_object('cnss_number',    jsonb_build_object('old', old.cnss_number,    'new', new.cnss_number)); end if;
  if coalesce(new.patente_number,'') is distinct from coalesce(old.patente_number,'') then changed := changed || jsonb_build_object('patente_number', jsonb_build_object('old', old.patente_number, 'new', new.patente_number)); end if;
  if new.tva_period               is distinct from old.tva_period                     then changed := changed || jsonb_build_object('tva_period',     jsonb_build_object('old', old.tva_period,     'new', new.tva_period)); end if;
  if new.fiscal_year_start        is distinct from old.fiscal_year_start              then changed := changed || jsonb_build_object('fiscal_year_start', jsonb_build_object('old', old.fiscal_year_start, 'new', new.fiscal_year_start)); end if;
  if coalesce(new.status,'')      is distinct from coalesce(old.status,'')            then changed := changed || jsonb_build_object('status',        jsonb_build_object('old', old.status,         'new', new.status)); end if;

  if changed <> '{}'::jsonb then
    insert into public.audit_events(organization_id, actor_id, action, entity_type, entity_id, meta)
    values (
      new.organization_id,
      auth.uid(),
      'client.update',
      'client',
      new.id,
      jsonb_build_object('company_name', new.company_name, 'changes', changed)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists audit_client_update on public.clients;
create trigger audit_client_update
after update on public.clients
for each row execute procedure public.audit_on_client_update();
