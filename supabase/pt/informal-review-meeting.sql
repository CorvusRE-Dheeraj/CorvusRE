-- How the owner joins the informal review: the video link, the phone number to
-- call or the address to go to. The owner types them, or Corvus AI picks the
-- video link / dial-in up from the county's email (county-mail-inbound).
alter table public.protests add column if not exists informal_review_link text;
alter table public.protests add column if not exists informal_review_phone text;
alter table public.protests add column if not exists informal_review_location text;
alter table public.protests add column if not exists informal_review_link_source text;
alter table public.protests drop constraint if exists protests_informal_review_link_check;
alter table public.protests add constraint protests_informal_review_link_check
  check (informal_review_link is null or informal_review_link ~* '^https://');
alter table public.protests drop constraint if exists protests_informal_review_link_source_check;
alter table public.protests add constraint protests_informal_review_link_source_check
  check (informal_review_link_source is null or informal_review_link_source in ('owner', 'county_email'));
