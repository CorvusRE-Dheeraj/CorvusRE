-- Site-wide switches an admin flips from the CorvusDP staff console
-- (Admin → Settings). Readable by everyone — the app needs them before
-- sign-in (e.g. whether sign-in is required at all); only admins can change
-- them. Applied 2026-11-10.
create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

alter table public.site_settings enable row level security;

drop policy if exists "site settings: read" on public.site_settings;
create policy "site settings: read" on public.site_settings
  for select to anon, authenticated using (true);

drop policy if exists "site settings: admin update" on public.site_settings;
create policy "site settings: admin update" on public.site_settings
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

grant select on public.site_settings to anon, authenticated;
grant update (value, updated_at, updated_by) on public.site_settings to authenticated;

-- Whether every CorvusDP page needs a signed-in user (apps/dp SignedInGate).
-- The dashboard and admin always require sign-in regardless. Starts off
-- (the owner switched the requirement off 2026-11-10).
insert into public.site_settings (key, value)
values ('sign_in_required', 'false'::jsonb)
on conflict (key) do nothing;
