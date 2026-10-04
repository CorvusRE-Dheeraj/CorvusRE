
-- Manage-your-appointment link (reschedule / cancel), sent in the confirmation email.
-- The token is a random secret only the booker has; nothing else identifies the
-- visitor (no login). manage-appointment (edge function, service role) is the only
-- caller.
alter table public.appointments add column if not exists manage_token text;
update public.appointments set manage_token = replace(gen_random_uuid()::text, '-', '') where manage_token is null;
alter table public.appointments alter column manage_token set default replace(gen_random_uuid()::text, '-', '');
alter table public.appointments alter column manage_token set not null;
create unique index if not exists appointments_manage_token_uniq on public.appointments (manage_token);

-- Moves an active, future appointment to a new start time — same protections as
-- book_appointment (blocked days, 2 hours between visits), ignoring the appointment
-- being moved. Returns the previous start so the caller can say what changed.
create or replace function public.reschedule_appointment(p_token text, p_start timestamptz)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appt public.appointments;
  v_local_date date := (p_start at time zone 'America/Chicago')::date;
  v_slot text := to_char(p_start at time zone 'America/Chicago', 'HH24:MI');
begin
  perform pg_advisory_xact_lock(hashtext('appointments'));

  select * into v_appt from public.appointments
   where manage_token = p_token and status = 'booked' and start_at > now();
  if not found then
    raise exception 'not_found';
  end if;

  if exists (
    select 1 from public.appointment_blocks b
    where b.block_date = v_local_date and (b.slot is null or b.slot = v_slot)
  ) then
    raise exception 'slot_blocked';
  end if;

  if exists (
    select 1 from public.appointments a
    where a.status = 'booked' and a.id <> v_appt.id
      and a.start_at > p_start - interval '3 hours'
      and a.start_at < p_start + interval '3 hours'
  ) then
    raise exception 'slot_taken';
  end if;

  update public.appointments
     set start_at = p_start, end_at = p_start + interval '1 hour'
   where id = v_appt.id;
  return v_appt.start_at;
end;
$$;
revoke all on function public.reschedule_appointment(text, timestamptz) from public, anon, authenticated;
grant execute on function public.reschedule_appointment(text, timestamptz) to service_role;
