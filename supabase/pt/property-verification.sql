-- Property & document verification (2026-10-26).
--
-- Before this, the values on an uploaded notice (owner, account, address,
-- land/improvement/total value) were copied straight onto a new property with
-- no independent check, so an AI-made or edited "notice" was accepted as-is.
-- Now every property is checked against the county (CAD) record, and any
-- uploaded document is also inspected for AI-generation / editing signs, by
-- the verify-property edge function (service role — the only writer of these
-- columns). Anything that doesn't match, is missing, or looks made/changed is
-- flagged for staff review and nothing about it is approved on its own.
--
--   pending       not checked yet (every new property, and after any edit to
--                 its identity or values) — held
--   verified      matches the county record (or staff approved it)
--   needs_review  flagged — held until staff approve or reject
--   rejected      staff rejected it — held
--   test          flagged, but the owner is an admin account: dummy documents
--                 are allowed for admins only; labelled "Test" everywhere and
--                 skipped by automatic jobs
--
-- "Held" = the database refuses signing a protest form or marking a protest
-- filed for that property, and auto-refile skips it. The customer can still
-- see their analysis.

alter table public.properties add column if not exists verification_status text not null default 'pending'
  check (verification_status in ('pending', 'verified', 'needs_review', 'rejected', 'test'));
alter table public.properties add column if not exists verification_flags jsonb not null default '[]';
alter table public.properties add column if not exists verification_checked_at timestamptz;
alter table public.properties add column if not exists verification_reviewed_by uuid references auth.users (id) on delete set null;
alter table public.properties add column if not exists verification_reviewed_at timestamptz;
alter table public.properties add column if not exists verification_note text;

alter table public.documents add column if not exists verification_status text
  check (verification_status in ('pending', 'verified', 'needs_review', 'rejected', 'test', 'not_required'));
alter table public.documents add column if not exists verification_flags jsonb not null default '[]';
alter table public.documents add column if not exists verification_checked_at timestamptz;

-- The verification columns aren't in the column grants (insert/update) for
-- authenticated, so a client can't write them. These triggers also put a
-- property back to 'pending' whenever a client changes what was verified.
create or replace function public.property_verification_reset() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user = 'service_role' or (select auth.role()) = 'service_role' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.verification_status := 'pending';
    new.verification_flags := '[]';
    new.verification_checked_at := null;
    new.verification_reviewed_by := null;
    new.verification_reviewed_at := null;
    new.verification_note := null;
  elsif (new.owner_name, new.account_number, new.cad, new.address, new.land_value,
         new.improvement_value, new.total_value, new.tax_year)
        is distinct from
        (old.owner_name, old.account_number, old.cad, old.address, old.land_value,
         old.improvement_value, old.total_value, old.tax_year) then
    new.verification_status := 'pending';
    new.verification_checked_at := null;
    new.verification_reviewed_by := null;
    new.verification_reviewed_at := null;
  end if;
  return new;
end; $$;
drop trigger if exists property_verification_reset on public.properties;
create trigger property_verification_reset before insert or update on public.properties
  for each row execute function public.property_verification_reset();

create or replace function public.document_verification_reset() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user = 'service_role' or (select auth.role()) = 'service_role' then
    return new;
  end if;
  new.verification_status := 'pending';
  new.verification_flags := '[]';
  new.verification_checked_at := null;
  return new;
end; $$;
drop trigger if exists document_verification_reset on public.documents;
create trigger document_verification_reset before insert on public.documents
  for each row execute function public.document_verification_reset();

-- Why a property is held, or null when it may proceed.
create or replace function public.property_hold_reason(p_property_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select case p.verification_status
    when 'pending' then 'This property is still being checked against the county record.'
    when 'needs_review' then 'This property is under review — some details don''t match the county record yet.'
    when 'rejected' then 'This property''s documents were not accepted. Please contact support.'
    else null end
  from public.properties p where p.id = p_property_id;
$$;
revoke all on function public.property_hold_reason(uuid) from public, anon;
grant execute on function public.property_hold_reason(uuid) to authenticated, service_role;

-- Signing a protest form / marking a protest filed waits for the check.
create or replace function public.enforce_property_hold() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_property uuid;
  v_reason text;
begin
  if current_user = 'service_role' or (select auth.role()) = 'service_role' then
    return new;
  end if;
  if tg_table_name = 'protests' then
    if new.status is not distinct from old.status or new.status <> 'filed' then return new; end if;
    v_property := new.property_id;
  else -- protest_form_submissions: only when a signature is (re)applied
    if new.signed_at is null or (tg_op = 'UPDATE' and new.signed_at is not distinct from old.signed_at) then
      return new;
    end if;
    select property_id into v_property from public.protests where id = new.protest_id;
  end if;
  if v_property is null then return new; end if; -- BPP protests have no property
  v_reason := public.property_hold_reason(v_property);
  if v_reason is not null then
    raise exception '%', v_reason using errcode = 'P0001';
  end if;
  return new;
end; $$;
drop trigger if exists enforce_property_hold on public.protests;
create trigger enforce_property_hold before update of status on public.protests
  for each row execute function public.enforce_property_hold();
drop trigger if exists enforce_property_hold on public.protest_form_submissions;
create trigger enforce_property_hold before insert or update on public.protest_form_submissions
  for each row execute function public.enforce_property_hold();

-- Staff decision on a flagged property (Operations → Verification).
create or replace function public.review_property_verification(
  p_property_id uuid, p_decision text, p_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_operations_admin()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_decision not in ('verified', 'rejected') then
    raise exception 'decision must be verified or rejected';
  end if;
  if p_decision = 'rejected' and coalesce(trim(p_note), '') = '' then
    raise exception 'Add a note saying why it was rejected.';
  end if;
  update public.properties
     set verification_status = p_decision,
         verification_reviewed_by = auth.uid(),
         verification_reviewed_at = now(),
         verification_note = nullif(trim(p_note), '')
   where id = p_property_id;
  -- the property's checked documents follow the decision
  update public.documents
     set verification_status = p_decision
   where property_id = p_property_id
     and verification_status in ('needs_review', 'pending', 'verified', 'rejected');
end; $$;
revoke all on function public.review_property_verification(uuid, text, text) from public, anon;
grant execute on function public.review_property_verification(uuid, text, text) to authenticated;
