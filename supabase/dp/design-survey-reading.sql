-- Design module: AI survey reading (2026-10-20, survey step 2).
-- survey_reading = what Corvus AI read from the uploaded survey (never edited
-- by hand); site_inputs = what the user confirmed or entered themselves, which
-- always wins over the AI reading. Replacing the survey clears the reading.

alter table public.design_requests
  add column if not exists survey_reading jsonb,
  add column if not exists survey_read_at timestamptz,
  add column if not exists survey_read_error text,
  add column if not exists site_inputs jsonb not null default '{}'::jsonb;
