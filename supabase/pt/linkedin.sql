-- LinkedIn daily posting (2026-10-25). Corvus AI drafts a post every posting
-- day from real data (Texas tax updates, deadlines, protest tips, CorvusPT
-- features); Marketing reviews, edits and approves; approved posts publish at
-- their scheduled time through LinkedIn's official Posts API (no scraping or
-- browser automation). Posting as a person uses the self-serve "Share on
-- LinkedIn" product; posting as the company page needs LinkedIn's Community
-- Management API approval — both are supported once connected.
--
--   linkedin_connections  OAuth tokens (service role only — never readable by
--                         clients); linkedin_status() exposes the safe parts
--   linkedin_oauth_states CSRF state for the connect flow
--   linkedin_posts        the content calendar: draft → approved → posted
--   linkedin_settings     posting days/time, tone, link, default hashtags
-- Automations (automation_permissions, changed only by Super Admin approval):
--   linkedin_daily_drafts   AI writes the upcoming drafts (on)
--   linkedin_auto_publish   approved posts go out at their time (on)
--   linkedin_auto_approve   AI drafts publish WITHOUT human review (off)

create table if not exists public.linkedin_connections (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  connected_by uuid references public.profiles(id) on delete set null,
  account_type text not null check (account_type in ('person', 'organization')),
  author_urn text not null,
  display_name text,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  scopes text,
  active boolean not null default true,
  last_error text
);
alter table public.linkedin_connections enable row level security;
-- no policies: clients can't read tokens at all
revoke all on public.linkedin_connections from anon, authenticated;
grant select, insert, update, delete on public.linkedin_connections to service_role;

create table if not exists public.linkedin_oauth_states (
  state text primary key,
  staff_id uuid not null,
  created_at timestamptz not null default now()
);
alter table public.linkedin_oauth_states enable row level security;
revoke all on public.linkedin_oauth_states from anon, authenticated;
grant select, insert, update, delete on public.linkedin_oauth_states to service_role;

create table if not exists public.linkedin_settings (
  id int primary key default 1 check (id = 1),
  post_days text[] not null default '{mon,tue,wed,thu,fri}',
  post_time text not null default '09:00',
  timezone text not null default 'America/Chicago',
  tone text not null default 'Helpful, plain-spoken expert for Texas commercial property owners — confident, never salesy.',
  cta_url text not null default 'https://corvusre.com/corvuspt/',
  default_hashtags text[] not null default '{TexasPropertyTax,CommercialRealEstate,PropertyTax}',
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.linkedin_settings (id) values (1) on conflict do nothing;
alter table public.linkedin_settings enable row level security;
drop policy if exists "Marketing reads LinkedIn settings" on public.linkedin_settings;
create policy "Marketing reads LinkedIn settings" on public.linkedin_settings for select to authenticated using ((select public.is_marketing_admin()));
drop policy if exists "Marketing updates LinkedIn settings" on public.linkedin_settings;
create policy "Marketing updates LinkedIn settings" on public.linkedin_settings for update to authenticated
  using ((select public.is_marketing_admin())) with check ((select public.is_marketing_admin()));
revoke all on public.linkedin_settings from anon, authenticated;
grant select, update on public.linkedin_settings to authenticated;
grant select, insert, update on public.linkedin_settings to service_role;

create table if not exists public.linkedin_posts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  scheduled_for timestamptz not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'posting', 'posted', 'failed', 'skipped')),
  theme text not null default 'custom',
  topic text,
  body text not null,
  hashtags text[] not null default '{}',
  link_url text,
  source_note text,
  ai_generated boolean not null default false,
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  posted_at timestamptz,
  linkedin_urn text,
  post_url text,
  error text,
  attempts int not null default 0
);
create index if not exists linkedin_posts_due_idx on public.linkedin_posts (status, scheduled_for);
alter table public.linkedin_posts enable row level security;
drop policy if exists "Marketing reads LinkedIn posts" on public.linkedin_posts;
create policy "Marketing reads LinkedIn posts" on public.linkedin_posts for select to authenticated using ((select public.is_marketing_admin()));
drop policy if exists "Marketing writes LinkedIn drafts" on public.linkedin_posts;
create policy "Marketing writes LinkedIn drafts" on public.linkedin_posts for insert to authenticated
  with check ((select public.is_marketing_admin()) and status in ('draft', 'approved'));
-- a published post can't be edited here (it's live on LinkedIn)
drop policy if exists "Marketing edits unpublished LinkedIn posts" on public.linkedin_posts;
create policy "Marketing edits unpublished LinkedIn posts" on public.linkedin_posts for update to authenticated
  using ((select public.is_marketing_admin()) and status in ('draft', 'approved', 'failed', 'skipped'))
  with check ((select public.is_marketing_admin()) and status in ('draft', 'approved', 'skipped'));
drop policy if exists "Marketing deletes unpublished LinkedIn posts" on public.linkedin_posts;
create policy "Marketing deletes unpublished LinkedIn posts" on public.linkedin_posts for delete to authenticated
  using ((select public.is_marketing_admin()) and status in ('draft', 'skipped', 'failed'));
revoke all on public.linkedin_posts from anon, authenticated;
grant select, insert, update, delete on public.linkedin_posts to authenticated;
grant select, insert, update, delete on public.linkedin_posts to service_role;
drop trigger if exists linkedin_posts_touch on public.linkedin_posts;
create trigger linkedin_posts_touch before update on public.linkedin_posts for each row execute function public.touch_updated_at();

-- approving stamps who approved it (and when); un-approving clears it
create or replace function public.linkedin_post_approval() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    new.approved_by := coalesce(auth.uid(), new.approved_by);
    new.approved_at := now();
  elsif new.status = 'draft' and tg_op = 'UPDATE' and old.status = 'approved' then
    new.approved_by := null;
    new.approved_at := null;
  end if;
  return new;
end; $$;
drop trigger if exists linkedin_post_approval on public.linkedin_posts;
create trigger linkedin_post_approval before insert or update on public.linkedin_posts for each row execute function public.linkedin_post_approval();

-- the safe parts of the connection, for the Marketing UI
create or replace function public.linkedin_status()
returns table (connected boolean, account_type text, display_name text, author_urn text, expires_at timestamptz, connected_at timestamptz, last_error text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_marketing_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  return query
    select true, c.account_type, c.display_name, c.author_urn, c.expires_at, c.created_at, c.last_error
    from public.linkedin_connections c where c.active order by c.created_at desc limit 1;
end; $$;
revoke all on function public.linkedin_status() from public, anon;
grant execute on function public.linkedin_status() to authenticated;

insert into public.automation_permissions (key, label, description, enabled) values
  ('linkedin_daily_drafts', 'LinkedIn daily drafts', 'Corvus AI writes a LinkedIn draft for each upcoming posting day (staff review it).', true),
  ('linkedin_auto_publish', 'LinkedIn auto-publish', 'Approved LinkedIn posts go out automatically at their scheduled time.', true),
  ('linkedin_auto_approve', 'LinkedIn posts without review', 'AI drafts are published WITHOUT a person approving each one.', false)
on conflict (key) do nothing;
