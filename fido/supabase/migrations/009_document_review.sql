-- Fido Phase 9 : revue des documents (approuvé / à revoir)
-- Idempotent — peut être rejoué sans effet secondaire.

-- 1. Enum review_status --------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'document_review_status') then
    create type public.document_review_status as enum (
      'pending_review',
      'approved',
      'rejected'
    );
  end if;
end $$;

-- 2. Colonnes sur documents ---------------------------------------------
alter table public.documents
  add column if not exists review_status public.document_review_status not null default 'pending_review',
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text;

create index if not exists documents_review_status_idx on public.documents(review_status);

-- 3. Audit automatique sur revue ----------------------------------------
create or replace function public.audit_on_document_review()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.review_status is distinct from old.review_status then
    insert into public.audit_events(organization_id, actor_id, action, entity_type, entity_id, meta)
    values (
      new.organization_id,
      auth.uid(),
      case new.review_status
        when 'approved' then 'document.approve'
        when 'rejected' then 'document.reject'
        else 'document.review_reset'
      end,
      'document',
      new.id,
      jsonb_build_object(
        'name', new.name,
        'client_id', new.client_id,
        'old_status', old.review_status,
        'new_status', new.review_status,
        'note', new.review_note
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists audit_document_review on public.documents;
create trigger audit_document_review
after update of review_status on public.documents
for each row execute procedure public.audit_on_document_review();

-- 4. Policy UPDATE : staff/owner uniquement -----------------------------
-- La table documents a déjà une policy "staff can update documents" (migration 005).
-- Rien à ajouter : les clients ne peuvent PAS revoir leurs propres documents.
