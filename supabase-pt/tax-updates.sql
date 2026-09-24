-- Texas Tax Law & Updates: the weekly report archive and the official pages it is
-- built from. Applied to the live database and mirrored here (the schema.sql
-- convention). Reports are written only by the generate-tax-updates edge function
-- (service role); signed-in users read published ones.

create table if not exists public.tax_update_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null unique,
  -- comptroller | legislature | rules | county | assessor
  kind text not null,
  -- e.g. 'Dallas County' for a county source; null = statewide.
  county text,
  enabled boolean not null default true,
  note text,
  -- The page text at the last weekly check, so the next run can send the model only
  -- what CHANGED (see generate-tax-updates).
  last_text text,
  last_checked_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.tax_update_sources add column if not exists last_text text;
alter table public.tax_update_sources add column if not exists last_checked_at timestamptz;

create table if not exists public.tax_update_reports (
  id uuid primary key default gen_random_uuid(),
  -- Monday of the week the report covers; one report per week (regenerating replaces it).
  week_start date not null unique,
  title text not null,
  summary text not null default '',
  -- Array of updates — see TaxUpdate in src/lib/tax-updates.ts.
  updates jsonb not null default '[]'::jsonb,
  -- Every page checked, with whether it could be read: [{name,url,county,ok,note}]
  sources jsonb not null default '[]'::jsonb,
  status text not null default 'published' check (status in ('published', 'draft')),
  model text,
  generated_at timestamptz not null default now()
);

alter table public.tax_update_sources enable row level security;
alter table public.tax_update_reports enable row level security;

drop policy if exists "Signed-in users read published tax reports" on public.tax_update_reports;
create policy "Signed-in users read published tax reports"
  on public.tax_update_reports for select
  to authenticated
  using (status = 'published');

drop policy if exists "Admins read all tax reports" on public.tax_update_reports;
create policy "Admins read all tax reports"
  on public.tax_update_reports for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Admins manage tax sources" on public.tax_update_sources;
create policy "Admins manage tax sources"
  on public.tax_update_sources for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Explicit grants (Supabase stops auto-granting Data API access to new tables).
grant select on public.tax_update_reports to authenticated;
grant select, insert, update, delete on public.tax_update_reports to service_role;
grant select, insert, update, delete on public.tax_update_sources to authenticated;
grant select, insert, update, delete on public.tax_update_sources to service_role;

-- The pages the weekly job reads. Official sources only. Collin CAD currently
-- answers automated requests with a 403, so it is listed but disabled.
insert into public.tax_update_sources (name, url, kind, county, enabled, note) values
  ('Texas Comptroller — Property Tax Assistance', 'https://comptroller.texas.gov/taxes/property-tax/', 'comptroller', null, true, null),
  ('Texas Comptroller — Protests & appeals', 'https://comptroller.texas.gov/taxes/property-tax/protests/', 'comptroller', null, true, null),
  ('Texas Register (Secretary of State)', 'https://www.sos.state.tx.us/texreg/index.shtml', 'rules', null, true, null),
  ('Texas Administrative Code — Title 34, Ch. 9 (Property Tax)', 'https://texreg.sos.state.tx.us/public/readtac$ext.ViewTAC?tac_view=4&ti=34&pt=1&ch=9', 'rules', null, true, null),
  ('Texas Legislature Online', 'https://capitol.texas.gov/', 'legislature', null, true, null),
  ('Dallas Central Appraisal District', 'https://www.dallascad.org/', 'county', 'Dallas County', true, null),
  ('Denton Central Appraisal District', 'https://www.dentoncad.com/', 'county', 'Denton County', true, null),
  ('Tarrant Appraisal District', 'https://www.tad.org/', 'county', 'Tarrant County', true, null),
  ('Harris Central Appraisal District', 'https://hcad.org/', 'county', 'Harris County', true, null),
  ('Travis Central Appraisal District', 'https://traviscad.org/', 'county', 'Travis County', true, null),
  ('Bexar Appraisal District', 'https://www.bcad.org/', 'county', 'Bexar County', true, null),
  ('Fort Bend Central Appraisal District', 'https://www.fbcad.org/', 'county', 'Fort Bend County', true, null),
  ('Williamson Central Appraisal District', 'https://www.wcad.org/', 'county', 'Williamson County', true, null),
  ('Collin Central Appraisal District', 'https://www.collincad.org/', 'county', 'Collin County', false, 'Blocks automated requests (HTTP 403).')
on conflict (url) do nothing;

-- Reports a person generates from the tab ("Generate update report"): a snapshot
-- of that week's report, kept per user, newest 10 (pruned by the client).
create table if not exists public.tax_update_user_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  -- { taxYear, report: TaxReport } — see SavedTaxReport in src/lib/tax-updates.ts.
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists tax_update_user_reports_user_idx
  on public.tax_update_user_reports (user_id, created_at desc);
alter table public.tax_update_user_reports enable row level security;

drop policy if exists "Users manage their own tax update reports" on public.tax_update_user_reports;
create policy "Users manage their own tax update reports"
  on public.tax_update_user_reports for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.tax_update_user_reports to authenticated;
grant select, insert, update, delete on public.tax_update_user_reports to service_role;
