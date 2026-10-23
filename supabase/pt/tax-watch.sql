-- Texas Property Tax Regulatory Watch (2026-10-23): the Texas Tax Updates
-- report is now built DAILY (was weekly) from official sources, and every
-- material change for commercial owners — filing deadlines, protest
-- procedures, evidence requirements, hearings, representation rules — raises
-- an alert for the CorvusPT team with what changed, the effective date, the
-- owner impact, what it means for CorvusPT's owner-managed platform, the
-- recommended action and the official source. Alerts are staff-only; the
-- customer-facing tab never shows the internal CorvusPT notes.

-- more official sources: ARB rules, the Comptroller's proposed/adopted rules,
-- and the official forms (notice of protest, agent appointment, ARB forms)
insert into public.tax_update_sources (name, url, kind, county, enabled, note) values
  ('Texas Comptroller — Appraisal Review Boards', 'https://comptroller.texas.gov/taxes/property-tax/arb/', 'comptroller', null, true, 'ARB rules, training and hearing procedures'),
  ('Texas Comptroller — Property tax rules (proposed & adopted)', 'https://comptroller.texas.gov/taxes/property-tax/rules/', 'rules', null, true, 'Comptroller rule proposals and adoptions with dates'),
  ('Texas Comptroller — Property tax forms', 'https://comptroller.texas.gov/taxes/property-tax/forms/', 'comptroller', null, true, 'Notice of protest (50-132), agent appointment (50-162), ARB forms')
on conflict (url) do nothing;

create table if not exists public.tax_update_alerts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  dedup_key text not null unique,
  title text not null,
  area text not null,
  status text not null,
  what_changed text not null,
  effective_date text,
  owner_impact text,
  corvus_impact text,
  recommended_action text,
  counties text[] not null default '{}',
  source_name text not null,
  source_url text not null,
  quote text not null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text
);
create index if not exists tax_update_alerts_created_idx on public.tax_update_alerts (created_at desc);
alter table public.tax_update_alerts enable row level security;
drop policy if exists "Staff read tax alerts" on public.tax_update_alerts;
create policy "Staff read tax alerts" on public.tax_update_alerts for select to authenticated using ((select public.is_staff()));
revoke all on public.tax_update_alerts from anon, authenticated;
grant select on public.tax_update_alerts to authenticated;
grant select, insert, update, delete on public.tax_update_alerts to service_role;

-- staff mark an alert reviewed (who + when + note); nothing else is editable
create or replace function public.review_tax_alert(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'not authorized' using errcode = '42501'; end if;
  update public.tax_update_alerts set reviewed_by = auth.uid(), reviewed_at = now(),
    review_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_id;
  if not found then raise exception 'Alert not found'; end if;
end; $$;
revoke all on function public.review_tax_alert(uuid, text) from public, anon;
grant execute on function public.review_tax_alert(uuid, text) to authenticated;

-- daily instead of Mondays (7am Central)
do $$
declare j bigint;
begin
  select jobid into j from cron.job where jobname = 'generate-tax-updates';
  if j is not null then perform cron.alter_job(j, schedule := '0 12 * * *'); end if;
end $$;
