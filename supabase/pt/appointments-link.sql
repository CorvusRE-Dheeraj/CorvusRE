
-- A standing meeting link (e.g. a Google Meet room) included in every appointment's email and
-- calendar file when no Google host account is connected to create a fresh link per booking.
alter table public.appointment_settings add column if not exists meeting_link text;
