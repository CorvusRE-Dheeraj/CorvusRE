-- Evidence the customer has said they can't provide (Module 8 "Document not available").
-- One row per checklist item per property, keyed by the item's slug (evidenceItemSlug in
-- src/lib/evidence-categorize.ts). guidance is the AI's answer from the
-- evidence-unavailable edge function: what the gap means for the case, what can stand in
-- for the document, and how the strategy shifts without it. The checklist itself isn't
-- regenerated — the page overlays these rows on the existing items, so marking an item
-- unavailable never reshuffles the rest of the list. Deleting the row ("I found it")
-- puts the item back to Missing.
create table if not exists public.evidence_unavailable (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  property_id uuid not null references public.properties (id) on delete cascade,
  item_slug text not null,
  item text not null,
  reason text not null,
  reason_note text,
  guidance jsonb,
  marked_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, item_slug),
  constraint evidence_unavailable_reason check (
    reason in ('never_had', 'lost', 'too_slow', 'not_applicable', 'other')
  ),
  constraint evidence_unavailable_note_len check (reason_note is null or length(reason_note) <= 500)
);

create index if not exists evidence_unavailable_user_idx on public.evidence_unavailable (user_id);

alter table public.evidence_unavailable enable row level security;

drop policy if exists "Owners manage their unavailable evidence" on public.evidence_unavailable;
create policy "Owners manage their unavailable evidence"
  on public.evidence_unavailable for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Admins can view all unavailable evidence" on public.evidence_unavailable;
create policy "Admins can view all unavailable evidence"
  on public.evidence_unavailable for select
  using (public.is_admin());

drop policy if exists "Members read" on public.evidence_unavailable;
create policy "Members read" on public.evidence_unavailable
  for select using (public.member_access(user_id, property_id, false));
drop policy if exists "Property managers write" on public.evidence_unavailable;
create policy "Property managers write" on public.evidence_unavailable
  for insert with check (public.member_access(user_id, property_id, true));
drop policy if exists "Property managers update" on public.evidence_unavailable;
create policy "Property managers update" on public.evidence_unavailable
  for update using (public.member_access(user_id, property_id, true))
  with check (public.member_access(user_id, property_id, true));
drop policy if exists "Property managers delete" on public.evidence_unavailable;
create policy "Property managers delete" on public.evidence_unavailable
  for delete using (public.member_access(user_id, property_id, true));

-- The owner column is always the property's owner, whoever (owner or property
-- manager) writes the row — the browser doesn't send it. The policies above
-- are checked against the row after this runs.
create or replace function public.evidence_unavailable_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.user_id := (select p.user_id from public.properties p where p.id = new.property_id);
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.evidence_unavailable_owner() from public;

drop trigger if exists evidence_unavailable_owner on public.evidence_unavailable;
create trigger evidence_unavailable_owner
  before insert or update on public.evidence_unavailable
  for each row execute function public.evidence_unavailable_owner();

grant select, insert, update, delete on public.evidence_unavailable to authenticated;
