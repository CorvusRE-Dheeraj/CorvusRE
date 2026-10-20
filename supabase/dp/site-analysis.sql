-- Site Data: grading, floodplain and ingress/egress analyses (2026-10-20).
-- The raw public data behind them (FEMA flood zones, USGS elevations, Census
-- roads), fetched by the site-analysis edge function and interpreted in the app.
alter table public.projects add column if not exists site_analysis jsonb;
alter table public.design_requests add column if not exists site_analysis jsonb;
