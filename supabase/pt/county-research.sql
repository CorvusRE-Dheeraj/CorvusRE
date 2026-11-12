-- The centralized county research engine's cache (2026-11-12): one row per
-- county + topic (supabase/pt/functions/_shared/county-research-topics.ts —
-- arbitration, court_appeal, bpp_rendition, …), read from official sources by
-- retrieve-county-procedures ({"countyCode","topic"}). Public facts, shared by
-- every user; written only by the function (service role). Refreshed after
-- 30 days (a failed read after 1 day).
create table if not exists public.county_research (
  county_code text not null,
  topic text not null,
  county text not null,
  research jsonb,
  retrieved_at timestamptz not null default now(),
  primary key (county_code, topic)
);
alter table public.county_research enable row level security;
drop policy if exists "Signed-in users read county research" on public.county_research;
create policy "Signed-in users read county research" on public.county_research
  for select to authenticated using (true);
revoke all on public.county_research from anon;
grant select on public.county_research to authenticated;
grant all on public.county_research to service_role;
