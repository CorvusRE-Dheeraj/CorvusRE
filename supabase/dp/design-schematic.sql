-- Design module: AI schematic plan (2026-10-20, survey step 4).
-- The concept layouts generated for a design request (validated against the
-- confirmed site geometry before they're saved) and which one is selected.
alter table public.design_requests
  add column if not exists schematic jsonb;
