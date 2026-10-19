-- Marketing Admin: a separate staff role with its own CRM, campaigns, follow-ups
-- and AI workspace (apps/pt/src/routes/marketing.tsx).
--
-- Access model:
--   * Super Admin  = profiles.is_admin (unchanged; sees everything, incl. Marketing).
--   * Marketing Admin = profiles.marketing_admin. Gets the marketing_* tables only.
--     It is NOT is_admin, so every existing admin-only policy (protests,
--     documents, filings, case data) keeps refusing it — case/legal data stays out.
--   * Only a Super Admin can grant or remove the role (set_marketing_admin).
--
-- One record per person: marketing_leads is keyed by email; beta signups and
-- registered users are folded into it by marketing_sync_leads(), which also
-- keeps stage/registered/paying in step with the real accounts — nobody types
-- the same person twice.

alter table public.profiles add column if not exists marketing_admin boolean not null default false;
-- profiles uses per-column UPDATE grants; this column is deliberately not granted.

create or replace function public.is_marketing_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_admin or p.marketing_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;
grant execute on function public.is_marketing_admin() to anon, authenticated;

create or replace function public.set_marketing_admin(target uuid, enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if not public.is_admin() then
    raise exception 'Only a Super Admin can change marketing access' using errcode = '42501';
  end if;
  update public.profiles set marketing_admin = enabled where id = target returning email into v_email;
  if not found then
    raise exception 'No such user';
  end if;
  insert into public.admin_audit_log (actor_id, actor_email, action, target_user_id, target_email, detail)
  values (
    auth.uid(),
    (select email from public.profiles where id = auth.uid()),
    case when enabled then 'grant_marketing_admin' else 'revoke_marketing_admin' end,
    target,
    v_email,
    case when enabled then 'Marketing Admin access granted' else 'Marketing Admin access removed' end
  );
end;
$$;
revoke all on function public.set_marketing_admin(uuid, boolean) from public, anon;
grant execute on function public.set_marketing_admin(uuid, boolean) to authenticated;

-- ── Leads (prospect profiles) ──────────────────────────────────────────────
create table if not exists public.marketing_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  full_name text,
  email text,
  email_key text generated always as (nullif(lower(trim(email)), '')) stored,
  phone text,
  company text,
  source text not null default 'manual'
    check (source in ('manual', 'beta_signup', 'registered', 'referral', 'website', 'import', 'event')),
  stage text not null default 'new'
    check (stage in ('new', 'contacted', 'interested', 'registered', 'customer', 'lost')),
  -- property the lead is about (marketing facts only — no case data)
  property_address text,
  county text,
  property_type text,
  appraised_value numeric,
  protest_deadline date,
  owner_names text,
  -- links back to the real records it was folded from
  profile_id uuid references public.profiles(id) on delete set null,
  beta_lead_id uuid,
  tags text[] not null default '{}',
  notes text,
  ai_summary text,
  ai_summary_at timestamptz,
  last_contacted_at timestamptz,
  unsubscribed_at timestamptz,
  unsubscribe_token uuid not null default gen_random_uuid(),
  assigned_to uuid references public.profiles(id) on delete set null
);
create unique index if not exists marketing_leads_email_key on public.marketing_leads (email_key);
create unique index if not exists marketing_leads_profile on public.marketing_leads (profile_id) where profile_id is not null;
create unique index if not exists marketing_leads_unsub on public.marketing_leads (unsubscribe_token);
create index if not exists marketing_leads_stage on public.marketing_leads (stage);

-- ── Communication history / activity ──────────────────────────────────────
create table if not exists public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  channel text not null default 'email' check (channel in ('email', 'sms')),
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'scheduled', 'sending', 'sent', 'paused')),
  -- {stages:[], counties:[], propertyTypes:[], leadIds:[]}
  audience jsonb not null default '{}'::jsonb,
  subject text,
  body text,
  scheduled_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  sent_at timestamptz,
  paused_at timestamptz,
  -- {targeted, sent, failed}
  stats jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.marketing_activities (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lead_id uuid references public.marketing_leads(id) on delete cascade,
  campaign_id uuid references public.marketing_campaigns(id) on delete set null,
  kind text not null check (kind in ('note', 'email', 'sms', 'call', 'stage', 'ai', 'follow_up', 'campaign')),
  summary text not null,
  body text,
  created_by uuid references public.profiles(id) on delete set null
);
create index if not exists marketing_activities_lead on public.marketing_activities (lead_id, created_at desc);
create index if not exists marketing_activities_campaign on public.marketing_activities (campaign_id);
create index if not exists marketing_activities_recent on public.marketing_activities (created_at desc);

create table if not exists public.marketing_followups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lead_id uuid not null references public.marketing_leads(id) on delete cascade,
  due_at timestamptz not null,
  channel text not null default 'email' check (channel in ('email', 'sms', 'call', 'task')),
  subject text,
  message text,
  status text not null default 'pending' check (status in ('pending', 'done', 'skipped')),
  sequence_name text,
  sequence_step int,
  ai_generated boolean not null default false,
  completed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null
);
create index if not exists marketing_followups_due on public.marketing_followups (status, due_at);
create index if not exists marketing_followups_lead on public.marketing_followups (lead_id);

create table if not exists public.marketing_ai_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  scope text not null default 'workspace',
  instruction text not null,
  result text,
  lead_id uuid references public.marketing_leads(id) on delete set null,
  campaign_id uuid references public.marketing_campaigns(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null
);
create index if not exists marketing_ai_runs_recent on public.marketing_ai_runs (scope, created_at desc);

-- Everything above is marketing-admin only.
do $$
declare t text;
begin
  foreach t in array array['marketing_leads','marketing_activities','marketing_campaigns','marketing_followups','marketing_ai_runs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "Marketing admins manage %s" on public.%I', t, t);
    execute format('create policy "Marketing admins manage %s" on public.%I for all to authenticated using ((select public.is_marketing_admin())) with check ((select public.is_marketing_admin()))', t, t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;
drop trigger if exists marketing_leads_touch on public.marketing_leads;
create trigger marketing_leads_touch before update on public.marketing_leads for each row execute function public.touch_updated_at();
drop trigger if exists marketing_campaigns_touch on public.marketing_campaigns;
create trigger marketing_campaigns_touch before update on public.marketing_campaigns for each row execute function public.touch_updated_at();

-- ── Sync: fold beta signups + registered users into leads ─────────────────
-- Paying = a property or BPP account with a paid status (same rule as
-- property_is_paid()). County is the appraisal district's county.
create or replace function public.marketing_sync_leads()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_beta int := 0;
  v_users int := 0;
begin
  if not public.is_marketing_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  insert into public.marketing_leads (full_name, email, company, source, beta_lead_id, created_at, notes)
  select b.full_name, b.work_email, b.company, 'beta_signup', b.id, b.created_at,
         nullif(concat_ws(' · ', nullif(b.area_of_interest, ''), nullif(b.use_case, '')), '')
  from public.beta_leads b
  where nullif(trim(b.work_email), '') is not null
    and b.work_email not ilike '%@example.com' -- test/CI signups
  on conflict (email_key) do update
    set beta_lead_id = coalesce(marketing_leads.beta_lead_id, excluded.beta_lead_id),
        company = coalesce(marketing_leads.company, excluded.company),
        full_name = coalesce(marketing_leads.full_name, excluded.full_name);
  get diagnostics v_beta = row_count;

  with users as (
    select p.id, p.email, p.phone, p.created_at,
           nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') as full_name,
           p.company_name,
           exists (
             select 1 from public.properties pr
             where pr.user_id = p.id and pr.subscription_status in ('active', 'trialing', 'past_due')
           ) or exists (
             select 1 from public.bpp_accounts ba
             where ba.user_id = p.id and ba.subscription_status in ('active', 'trialing', 'past_due')
           ) as paying,
           top.address, top.cad, top.property_type, top.total_value, top.protest_deadline, top.owner_name
    from public.profiles p
    left join lateral (
      select pr.address, pr.cad, pr.property_type, pr.total_value, pr.protest_deadline, pr.owner_name
      from public.properties pr where pr.user_id = p.id
      order by pr.total_value desc nulls last limit 1
    ) top on true
    where coalesce(p.is_admin, false) = false
      and coalesce(p.marketing_admin, false) = false
      and nullif(trim(p.email), '') is not null
      and p.email not ilike '%@example.com' -- test/CI accounts
  )
  insert into public.marketing_leads (full_name, email, phone, company, source, profile_id, stage, created_at,
                                      property_address, county, property_type, appraised_value, protest_deadline, owner_names)
  select u.full_name, u.email, u.phone, u.company_name, 'registered', u.id,
         case when u.paying then 'customer' else 'registered' end, u.created_at,
         u.address,
         nullif(trim(regexp_replace(coalesce(u.cad, ''), '\s*(central\s+)?appraisal\s+district.*$|\s+cad$', '', 'i')), ''),
         u.property_type, u.total_value, u.protest_deadline, u.owner_name
  from users u
  on conflict (email_key) do update
    set profile_id = excluded.profile_id,
        phone = coalesce(marketing_leads.phone, excluded.phone),
        full_name = coalesce(marketing_leads.full_name, excluded.full_name),
        company = coalesce(marketing_leads.company, excluded.company),
        property_address = coalesce(excluded.property_address, marketing_leads.property_address),
        county = coalesce(excluded.county, marketing_leads.county),
        property_type = coalesce(excluded.property_type, marketing_leads.property_type),
        appraised_value = coalesce(excluded.appraised_value, marketing_leads.appraised_value),
        protest_deadline = coalesce(excluded.protest_deadline, marketing_leads.protest_deadline),
        owner_names = coalesce(excluded.owner_names, marketing_leads.owner_names),
        -- registered/customer follow the real account; a lost lead stays lost
        -- unless they've since paid.
        stage = case
          when excluded.stage = 'customer' then 'customer'
          when marketing_leads.stage = 'customer' then 'registered'
          when marketing_leads.stage in ('new', 'contacted', 'interested') then 'registered'
          else marketing_leads.stage
        end;
  get diagnostics v_users = row_count;

  return jsonb_build_object('betaSignups', v_beta, 'registeredUsers', v_users, 'syncedAt', now());
end;
$$;
revoke all on function public.marketing_sync_leads() from public, anon;
grant execute on function public.marketing_sync_leads() to authenticated;

-- ── Unsubscribe (public, one-click link in every marketing email) ─────────
create or replace function public.marketing_unsubscribe(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  update public.marketing_leads set unsubscribed_at = coalesce(unsubscribed_at, now())
   where unsubscribe_token = p_token returning id into v_id;
  if v_id is null then return false; end if;
  insert into public.marketing_activities (lead_id, kind, summary) values (v_id, 'note', 'Unsubscribed from marketing email');
  return true;
end;
$$;
revoke all on function public.marketing_unsubscribe(uuid) from public;
grant execute on function public.marketing_unsubscribe(uuid) to anon, authenticated;
