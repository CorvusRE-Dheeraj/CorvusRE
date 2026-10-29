-- How the owner joins the formal ARB hearing — same as the informal review's
-- (informal-review-meeting.sql): the video link and the number to call, typed
-- by the owner or read off the district's email. hearing_location (the address)
-- and hearing_mode already exist.
alter table public.protests add column if not exists hearing_link text;
alter table public.protests add column if not exists hearing_phone text;
alter table public.protests add column if not exists hearing_link_source text;
alter table public.protests drop constraint if exists protests_hearing_link_check;
alter table public.protests add constraint protests_hearing_link_check
  check (hearing_link is null or hearing_link ~* '^https://');
alter table public.protests drop constraint if exists protests_hearing_link_source_check;
alter table public.protests add constraint protests_hearing_link_source_check
  check (hearing_link_source is null or hearing_link_source in ('owner', 'county_email'));
