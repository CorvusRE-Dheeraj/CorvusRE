-- Land Condition (Module 4) — optional inspection / survey / engineering /
-- environmental reports read by AI (the site-report-extract edge function).
--   site_reports: one row per uploaded report (the file itself stays in
--     public.documents, i.e. Data & Evidence). content_hash is the file's
--     SHA-256, so the same report uploaded twice is recognised, not re-read.
--   site_report_findings: what the AI found, mapped to a land factor, with the
--     page it came from. Nothing counts until the owner reviews it: status
--     starts 'suggested' and becomes 'confirmed' (optionally with the owner's
--     own wording in edited_finding) or 'rejected'. Only confirmed findings
--     feed the module's factor statuses and documentation priority. A finding
--     that differs from a fetched record (FEMA, USGS, CAD) carries the
--     difference in `conflict` — it's shown side by side, never overwrites.
create table if not exists public.site_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  property_id uuid not null references public.properties (id) on delete cascade,
  document_id uuid references public.documents (id) on delete set null,
  file_name text not null,
  content_hash text not null,
  status text not null default 'reading',
  title text,
  report_type text,
  report_date text,
  pages integer,
  summary text,
  unreadable text,
  error text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (property_id, content_hash),
  constraint site_reports_status check (status in ('reading', 'read', 'failed'))
);
create index if not exists site_reports_user_idx on public.site_reports (user_id);

create table if not exists public.site_report_findings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  property_id uuid not null references public.properties (id) on delete cascade,
  report_id uuid not null references public.site_reports (id) on delete cascade,
  factor text not null,
  label text,
  finding text not null,
  details jsonb not null default '[]'::jsonb,
  page integer,
  source_type text,
  confidence text not null default 'Moderate',
  needs_review text,
  conflict text,
  matches_record boolean not null default false,
  content_key text not null,
  status text not null default 'suggested',
  edited_finding text,
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (property_id, content_key),
  constraint site_report_findings_status check (status in ('suggested', 'confirmed', 'rejected')),
  constraint site_report_findings_confidence check (confidence in ('High', 'Moderate', 'Low')),
  constraint site_report_findings_edit_len check (edited_finding is null or length(edited_finding) <= 1000)
);
create index if not exists site_report_findings_user_idx on public.site_report_findings (user_id);
create index if not exists site_report_findings_report_idx on public.site_report_findings (report_id);

alter table public.site_reports enable row level security;
alter table public.site_report_findings enable row level security;

do $do$
declare
  t text;
begin
  foreach t in array array['site_reports', 'site_report_findings'] loop
    execute format('drop policy if exists "Owners manage" on public.%I', t);
    execute format('create policy "Owners manage" on public.%I for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format('drop policy if exists "Admins read" on public.%I', t);
    execute format('create policy "Admins read" on public.%I for select using (public.is_admin())', t);
    execute format('drop policy if exists "Members read" on public.%I', t);
    execute format('create policy "Members read" on public.%I for select using (public.member_access(user_id, property_id, false))', t);
    execute format('drop policy if exists "Property managers write" on public.%I', t);
    execute format('create policy "Property managers write" on public.%I for insert with check (public.member_access(user_id, property_id, true))', t);
    execute format('drop policy if exists "Property managers update" on public.%I', t);
    execute format('create policy "Property managers update" on public.%I for update using (public.member_access(user_id, property_id, true)) with check (public.member_access(user_id, property_id, true))', t);
    execute format('drop policy if exists "Property managers delete" on public.%I', t);
    execute format('create policy "Property managers delete" on public.%I for delete using (public.member_access(user_id, property_id, true))', t);
  end loop;
end
$do$;

-- user_id is always the property's owner, whoever writes the row.
create or replace function public.site_report_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.user_id := (select p.user_id from public.properties p where p.id = new.property_id);
  return new;
end;
$$;
revoke all on function public.site_report_owner() from public;

drop trigger if exists site_reports_owner on public.site_reports;
create trigger site_reports_owner before insert or update on public.site_reports
  for each row execute function public.site_report_owner();
drop trigger if exists site_report_findings_owner on public.site_report_findings;
create trigger site_report_findings_owner before insert or update on public.site_report_findings
  for each row execute function public.site_report_owner();

-- A finding's extracted content is fixed once written: the owner decides
-- (status, their own wording), they don't rewrite what the report said.
create or replace function public.site_report_finding_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (
    new.report_id is distinct from old.report_id or new.factor is distinct from old.factor or
    new.finding is distinct from old.finding or new.details is distinct from old.details or
    new.page is distinct from old.page or new.conflict is distinct from old.conflict or
    new.content_key is distinct from old.content_key
  ) then
    raise exception 'A finding''s extracted content can''t be changed — edit your own wording instead.';
  end if;
  if new.status is distinct from coalesce(old.status, 'suggested') then
    new.decided_at := case when new.status = 'suggested' then null else now() end;
    new.decided_by := case when new.status = 'suggested' then null else auth.uid() end;
  end if;
  return new;
end;
$$;
drop trigger if exists site_report_finding_guard on public.site_report_findings;
create trigger site_report_finding_guard before insert or update on public.site_report_findings
  for each row execute function public.site_report_finding_guard();

grant select, insert, update, delete on public.site_reports to authenticated;
grant select, insert, update, delete on public.site_report_findings to authenticated;
