-- CorvusDP — database schema.
-- Run once in a fresh Supabase project: Project > SQL Editor > New query > paste > Run.
-- Safe to re-run (idempotent: `if not exists`, `add column if not exists`, `drop policy if exists`).
--
-- Credentials (email + hashed password) live in Supabase's built-in auth.users.
-- Everything below is app-owned data keyed off that.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists company_name text;
alter table public.profiles add column if not exists is_admin boolean not null default false;

alter table public.profiles enable row level security;

drop policy if exists "own profile: select" on public.profiles;
create policy "own profile: select" on public.profiles for select using (auth.uid() = id);

drop policy if exists "own profile: update" on public.profiles;
create policy "own profile: update" on public.profiles for update using (auth.uid() = id);

-- RLS gates rows, not columns — without this a signed-in user could set their
-- own is_admin. Only the harmless self-service fields stay client-writable.
revoke update on public.profiles from authenticated;
grant update (first_name, last_name, phone, company_name) on public.profiles to authenticated;

-- Admin check usable inside other tables' policies without recursing into
-- profiles' own RLS (security definer).
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

drop policy if exists "admin: read all profiles" on public.profiles;
create policy "admin: read all profiles" on public.profiles for select using (public.is_admin());

-- Auto-create a profile row on signup. first_name/last_name/phone/company_name
-- are passed from the sign-up form via supabase.auth.signUp options.data.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, first_name, last_name, phone, company_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    new.raw_user_meta_data ->> 'phone',
    new.raw_user_meta_data ->> 'company_name'
  );

  begin
    insert into public.terms_acceptances (user_id, email, terms_version, privacy_version, source)
    values (
      new.id,
      new.email,
      coalesce(new.raw_user_meta_data ->> 'terms_version', 'unknown'),
      coalesce(new.raw_user_meta_data ->> 'privacy_version', 'unknown'),
      'signup'
    );
  exception when others then null;
  end;

  -- Claim any anonymous project/design/lead rows created in this browser
  -- session before the account existed (session_id passed via options.data).
  begin
    update public.projects
      set user_id = new.id
      where user_id is null
        and session_id is not null
        and session_id = new.raw_user_meta_data ->> 'session_id';
    update public.design_requests
      set user_id = new.id
      where user_id is null
        and session_id is not null
        and session_id = new.raw_user_meta_data ->> 'session_id';
  exception when others then null;
  end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- terms_acceptances
-- ---------------------------------------------------------------------------
create table if not exists public.terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  email text,
  terms_version text not null,
  privacy_version text not null,
  source text not null default 'signup',
  accepted_at timestamptz not null default now()
);
alter table public.terms_acceptances enable row level security;
drop policy if exists "own acceptances: select" on public.terms_acceptances;
create policy "own acceptances: select" on public.terms_acceptances
  for select using (auth.uid() = user_id or public.is_admin());

-- ---------------------------------------------------------------------------
-- leads — anonymous drop-offs from the analysis flow (PRD 1.1.7.N / 2.1.2)
-- ---------------------------------------------------------------------------
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  session_id text,
  track text,                       -- 'permitting' | 'design'
  email text,
  name text,
  company text,
  property jsonb,
  project jsonb,
  design jsonb,
  intent_score int not null default 0,
  status text not null default 'new',
  created_at timestamptz not null default now()
);
alter table public.leads enable row level security;

-- The pre-signup flow runs as the anon role — allow it to record a lead, but
-- never to read them back. Staff read them in the admin panel.
drop policy if exists "anyone: insert lead" on public.leads;
create policy "anyone: insert lead" on public.leads for insert with check (true);
drop policy if exists "admin: manage leads" on public.leads;
create policy "admin: manage leads" on public.leads for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- projects — one per permitting analysis (PRD 2.1.1)
-- ---------------------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  session_id text,
  track text not null default 'permitting',
  name text,
  address text,
  city text,
  county text,
  state text default 'TX',
  jurisdiction text,
  jurisdiction_level text,
  zoning text,
  zoning_category text,
  intent text,
  sector text,
  lot_size text,
  building_area text,
  floors text,
  existing_use text,
  proposed_use text,
  feasibility_status text,
  complexity_level text,
  stage text not null default 'analysis',
  analysis jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.projects enable row level security;

drop policy if exists "own projects: all" on public.projects;
create policy "own projects: all" on public.projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "admin: read projects" on public.projects;
create policy "admin: read projects" on public.projects for select using (public.is_admin());

-- ---------------------------------------------------------------------------
-- child tables of projects — RLS via the owning project
-- ---------------------------------------------------------------------------
create or replace function public.owns_project(pid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (select 1 from public.projects p where p.id = pid and p.user_id = auth.uid())
      or public.is_admin();
$$;

create table if not exists public.project_permits (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  permit_key text not null,
  name text not null,
  category text not null,
  status text not null default 'identified',   -- identified|preparing|submitted|under_review|comments|resubmitted|approved
  agency text,
  submitted_at timestamptz,
  approved_at timestamptz,
  approval_doc_url text,
  permit_number text,
  expiry_date date,
  review_round int not null default 0,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.project_permits enable row level security;
drop policy if exists "project permits: all" on public.project_permits;
create policy "project permits: all" on public.project_permits
  for all using (public.owns_project(project_id)) with check (public.owns_project(project_id));

create table if not exists public.project_checklist_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  permit_key text,
  label text not null,
  grp text not null default 'Supporting',
  required boolean not null default true,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.project_checklist_items enable row level security;
drop policy if exists "checklist: all" on public.project_checklist_items;
create policy "checklist: all" on public.project_checklist_items
  for all using (public.owns_project(project_id)) with check (public.owns_project(project_id));

create table if not exists public.project_notifications (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null default 'update',
  title text not null,
  body text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.project_notifications enable row level security;
drop policy if exists "notifications: all" on public.project_notifications;
create policy "notifications: all" on public.project_notifications
  for all using (public.owns_project(project_id)) with check (public.owns_project(project_id));

create table if not exists public.project_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  category text not null default 'General',
  storage_path text,
  note text,
  created_at timestamptz not null default now()
);
alter table public.project_documents enable row level security;
drop policy if exists "documents: all" on public.project_documents;
create policy "documents: all" on public.project_documents
  for all using (public.owns_project(project_id)) with check (public.owns_project(project_id));

create table if not exists public.city_communications (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  channel text not null default 'email',        -- email|phone|meeting|portal
  department text,
  summary text not null,
  next_follow_up date,
  proactive_push boolean not null default false,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.city_communications enable row level security;
drop policy if exists "city comms: all" on public.city_communications;
create policy "city comms: all" on public.city_communications
  for all using (public.owns_project(project_id)) with check (public.owns_project(project_id));

create table if not exists public.review_comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  permit_key text,
  original text not null,
  plain_language text,
  why_it_matters text,
  required_action text,
  responsible text,
  priority text not null default 'medium',       -- low|medium|high|critical
  status text not null default 'open',           -- open|in_progress|addressed|closed
  created_at timestamptz not null default now()
);
alter table public.review_comments enable row level security;
drop policy if exists "review comments: all" on public.review_comments;
create policy "review comments: all" on public.review_comments
  for all using (public.owns_project(project_id)) with check (public.owns_project(project_id));

-- ---------------------------------------------------------------------------
-- design_requests — Design milestone (PRD 1.2 / 2.2)
-- ---------------------------------------------------------------------------
create table if not exists public.design_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  session_id text,
  address text,
  city text,
  county text,
  scope text,
  sector text,
  building_area text,
  floors text,
  rooms text,
  functional_requirements text,
  special_requirements text,
  brief jsonb,
  stage text not null default 'brief',
  created_at timestamptz not null default now()
);
alter table public.design_requests enable row level security;
drop policy if exists "own design: all" on public.design_requests;
create policy "own design: all" on public.design_requests
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "admin: read design" on public.design_requests;
create policy "admin: read design" on public.design_requests for select using (public.is_admin());

-- ---------------------------------------------------------------------------
-- admin_audit_log
-- ---------------------------------------------------------------------------
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  actor_email text,
  action text not null,
  target text,
  detail text,
  created_at timestamptz not null default now()
);
alter table public.admin_audit_log enable row level security;
drop policy if exists "admin: audit" on public.admin_audit_log;
create policy "admin: audit" on public.admin_audit_log for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Storage bucket for uploaded project documents (private).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('project-docs', 'project-docs', false)
on conflict (id) do nothing;

drop policy if exists "project docs: owner rw" on storage.objects;
create policy "project docs: owner rw" on storage.objects for all
  to authenticated
  using (bucket_id = 'project-docs' and (owner = auth.uid() or public.is_admin()))
  with check (bucket_id = 'project-docs' and owner = auth.uid());

-- ---------------------------------------------------------------------------
-- PRD gap-fill additions (2026-09-09) — all idempotent.
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists notification_prefs jsonb not null default
  '{"email":true,"sms":false,"in_app":true,"weekly":true,"permit_status":true}'::jsonb;

-- re-grant to include the new self-service column
revoke update on public.profiles from authenticated;
grant update (first_name, last_name, phone, company_name, notification_prefs) on public.profiles to authenticated;

alter table public.terms_acceptances add column if not exists user_agent text;

alter table public.project_permits add column if not exists current_reviewer text;
alter table public.project_permits add column if not exists est_next_update date;

alter table public.project_checklist_items add column if not exists kind text not null default 'submission';
  -- 'submission' (city-specific per permit) | 'pre_app' (pre-application checklist)

alter table public.design_requests add column if not exists site_area text;
alter table public.design_requests add column if not exists approved_at timestamptz;
alter table public.design_requests add column if not exists consultation_requested_at timestamptz;

-- Engagement / "proceed with professional assistance" (PRD 1.1.19).
create table if not exists public.engagement_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  track text not null default 'permitting',
  scope_summary text,
  note text,
  status text not null default 'requested',
  created_at timestamptz not null default now()
);
alter table public.engagement_requests enable row level security;
drop policy if exists "own engagement: all" on public.engagement_requests;
create policy "own engagement: all" on public.engagement_requests
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "admin: read engagement" on public.engagement_requests;
create policy "admin: read engagement" on public.engagement_requests for select using (public.is_admin());

-- Capture the request user-agent on the signup terms acceptance (PRD 1.1.7.M).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, first_name, last_name, phone, company_name)
  values (
    new.id, new.email,
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    new.raw_user_meta_data ->> 'phone',
    new.raw_user_meta_data ->> 'company_name'
  );

  begin
    insert into public.terms_acceptances (user_id, email, terms_version, privacy_version, source, user_agent)
    values (
      new.id, new.email,
      coalesce(new.raw_user_meta_data ->> 'terms_version', 'unknown'),
      coalesce(new.raw_user_meta_data ->> 'privacy_version', 'unknown'),
      'signup',
      new.raw_user_meta_data ->> 'user_agent'
    );
  exception when others then null;
  end;

  begin
    update public.projects set user_id = new.id
      where user_id is null and session_id is not null
        and session_id = new.raw_user_meta_data ->> 'session_id';
    update public.design_requests set user_id = new.id
      where user_id is null and session_id is not null
        and session_id = new.raw_user_meta_data ->> 'session_id';
  exception when others then null;
  end;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Transactional email infrastructure (2026-09-14) — welcome email, permit
-- status-change / engagement-request email, permit-renewal reminders, and a
-- weekly digest, all sent via Resend from Edge Functions. Idempotent.
-- ---------------------------------------------------------------------------

-- Welcome email: send-welcome-email claims this atomically
-- (UPDATE ... WHERE welcome_email_sent_at IS NULL) so a user signing in from
-- two tabs, or on every later day, never gets a second welcome email.
alter table public.profiles add column if not exists welcome_email_sent_at timestamptz;

-- Weekly digest: same atomic-claim idea, so the weekly cron sweep is safe to
-- run more than once without double-sending.
alter table public.profiles add column if not exists last_digest_sent_at timestamptz;

-- One flag per notification row so send-notification-email (called once per
-- insert from addNotification) can never double-email the same event even
-- if it's ever retried.
alter table public.project_notifications add column if not exists email_sent_at timestamptz;

-- Permit renewal reminders: one flag per permit so the daily sweep only
-- emails once as a given permit's expiry_date approaches, not once per day
-- the cron happens to run before it.
alter table public.project_permits add column if not exists renewal_reminder_sent_at timestamptz;

-- ---------------------------------------------------------------------------
-- Re-verification pass against the PRD (2026-09-15) — one real gap found:
-- Automatic Lead Conversion (PRD 1.1.7.N) never actually marked a lead row
-- as converted when the same anonymous session went on to sign up, even
-- though the trigger already links that session's projects/design_requests.
-- Idempotent (create or replace).
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, first_name, last_name, phone, company_name)
  values (
    new.id, new.email,
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    new.raw_user_meta_data ->> 'phone',
    new.raw_user_meta_data ->> 'company_name'
  );

  begin
    insert into public.terms_acceptances (user_id, email, terms_version, privacy_version, source, user_agent)
    values (
      new.id, new.email,
      coalesce(new.raw_user_meta_data ->> 'terms_version', 'unknown'),
      coalesce(new.raw_user_meta_data ->> 'privacy_version', 'unknown'),
      'signup',
      new.raw_user_meta_data ->> 'user_agent'
    );
  exception when others then null;
  end;

  begin
    update public.projects set user_id = new.id
      where user_id is null and session_id is not null
        and session_id = new.raw_user_meta_data ->> 'session_id';
    update public.design_requests set user_id = new.id
      where user_id is null and session_id is not null
        and session_id = new.raw_user_meta_data ->> 'session_id';
    -- PRD 1.1.7.N — the same anonymous session converting to an account
    -- marks its lead row(s) converted rather than leaving them "new"
    -- forever in the admin Leads view.
    update public.leads set status = 'converted'
      where status <> 'converted' and session_id is not null
        and session_id = new.raw_user_meta_data ->> 'session_id';
  exception when others then null;
  end;

  return new;
end;
$$;

-- "Task - AI Logs and Outputs" (PRD, end of the design-admin section): every
-- AI call's input and output must be stored so staff can review results.
-- Written by the Edge Functions themselves via the service-role key (see
-- supabase/functions/_shared/ai-log.ts), so no insert policy is needed for
-- any client role — only admins ever read this table.
create table if not exists public.ai_logs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,               -- feasibility_summary|design_narrative|review_comment_translation|assistant_chat
  user_id uuid references auth.users (id) on delete set null,
  input jsonb not null,
  output jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.ai_logs enable row level security;
drop policy if exists "admin: read ai logs" on public.ai_logs;
create policy "admin: read ai logs" on public.ai_logs for select using (public.is_admin());
