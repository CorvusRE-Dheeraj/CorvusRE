
-- Google Meet links for appointments. Each booking creates a Google Calendar event (with a
-- Meet link) on the host's Google account; Google emails the invite to everyone. The host is
-- an admin who has connected Google Calendar (Settings → Connect Google Calendar) and
-- chosen "Use my Google account" on the Admin → Appointments tab. Until one is chosen,
-- bookings still work and fall back to the emailed calendar file.
alter table public.appointments add column if not exists google_event_id text;
alter table public.appointments add column if not exists meet_link text;

create table if not exists public.appointment_settings (
  id boolean primary key default true check (id),
  host_user_id uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.appointment_settings (id) values (true) on conflict (id) do nothing;
alter table public.appointment_settings enable row level security;

drop policy if exists "Admins manage appointment settings" on public.appointment_settings;
create policy "Admins manage appointment settings"
  on public.appointment_settings for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete on public.appointment_settings to authenticated;
grant select, insert, update, delete on public.appointment_settings to service_role;
