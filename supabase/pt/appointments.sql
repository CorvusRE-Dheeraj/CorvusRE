-- "Schedule a Call or Virtual Meeting" (Contact Us). Applied to the live database and
-- mirrored in schema.sql. Nobody reads or writes these from the public site: visitors
-- see open slots and book only through the appointment-slots / book-appointment edge
-- functions (service role). Admins read and manage them from the Admin dashboard,
-- through the RLS policies below.
--
-- Rules live in code (supabase/functions/_shared/appointment-rules.ts): Mon–Fri
-- 10 AM–2 PM Central, 60-minute visits, 2 days' notice, no federal holidays, 2 hours
-- between visits. book_appointment() re-checks the parts that must be race-proof
-- (no double booking, the 2-hour gap, admin blocks) under a lock.

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  -- Set when a signed-in customer booked; visitors are identified by email only.
  user_id uuid references auth.users (id) on delete set null,
  name text not null,
  email text not null,
  phone text,
  -- 'call' = phone call, 'virtual' = video meeting
  meeting_type text not null default 'call' check (meeting_type in ('call', 'virtual')),
  notes text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'booked' check (status in ('booked', 'cancelled')),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);
create index if not exists appointments_start_idx on public.appointments (start_at);
-- The same start can never be booked twice while it is active.
create unique index if not exists appointments_active_start_uniq
  on public.appointments (start_at) where status = 'booked';
alter table public.appointments enable row level security;

drop policy if exists "Admins manage appointments" on public.appointments;
create policy "Admins manage appointments"
  on public.appointments for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Days or single time slots an admin has closed (holidays are built in; this is for
-- everything else — vacations, one-off closures). slot = null blocks the whole day.
create table if not exists public.appointment_blocks (
  id uuid primary key default gen_random_uuid(),
  block_date date not null,
  slot text check (slot in ('10:00', '11:00', '12:00', '13:00')),
  note text,
  created_at timestamptz not null default now()
);
create unique index if not exists appointment_blocks_uniq
  on public.appointment_blocks (block_date, coalesce(slot, 'all-day'));
alter table public.appointment_blocks enable row level security;

drop policy if exists "Admins manage appointment blocks" on public.appointment_blocks;
create policy "Admins manage appointment blocks"
  on public.appointment_blocks for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete on public.appointments to authenticated;
grant select, insert, update, delete on public.appointments to service_role;
grant select, insert, update, delete on public.appointment_blocks to authenticated;
grant select, insert, update, delete on public.appointment_blocks to service_role;

-- Books one visit, refusing a double booking, a visit within 2 hours of another, or a
-- blocked day/slot. Called by the book-appointment edge function (service role) after
-- it has checked weekday/hours/holiday/notice.
create or replace function public.book_appointment(
  p_name text,
  p_email text,
  p_phone text,
  p_meeting_type text,
  p_notes text,
  p_user_id uuid,
  p_start timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_local_date date := (p_start at time zone 'America/Chicago')::date;
  v_slot text := to_char(p_start at time zone 'America/Chicago', 'HH24:MI');
begin
  -- One booking at a time, so two people can't take neighbouring slots together.
  perform pg_advisory_xact_lock(hashtext('appointments'));

  if exists (
    select 1 from public.appointment_blocks b
    where b.block_date = v_local_date and (b.slot is null or b.slot = v_slot)
  ) then
    raise exception 'slot_blocked';
  end if;

  -- Start-to-start must be at least 3 hours: 1-hour visit + 2-hour gap.
  if exists (
    select 1 from public.appointments a
    where a.status = 'booked'
      and a.start_at > p_start - interval '3 hours'
      and a.start_at < p_start + interval '3 hours'
  ) then
    raise exception 'slot_taken';
  end if;

  insert into public.appointments (user_id, name, email, phone, meeting_type, notes, start_at, end_at)
  values (p_user_id, p_name, p_email, p_phone, p_meeting_type, p_notes, p_start, p_start + interval '1 hour')
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.book_appointment(text, text, text, text, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.book_appointment(text, text, text, text, text, uuid, timestamptz) to service_role;
