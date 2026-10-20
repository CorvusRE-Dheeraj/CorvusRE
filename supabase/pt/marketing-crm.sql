-- AI CRM for the Marketing Admin workspace (builds on marketing.sql).
--
--   * Status pipeline: New Lead → Researching → Ready for Outreach → Contacted →
--     Interested → Registered → Subscribed, plus No Response, Not Interested and
--     Do Not Contact. Every status change is written to the lead's history by a
--     trigger (one place, so manual edits, rules and the account sync all agree).
--   * Portfolios: marketing_lead_properties holds every property linked to a
--     lead (same parcel may sit under several leads = co-owners). The lead's
--     primary-property columns and portfolio rollups are maintained by trigger.
--   * Rules (marketing_settings.rules): each rule is auto / suggest / off.
--     Auto rules move the status; suggest rules leave an AI suggestion for staff
--     to accept. Manual changes always win.
--   * Do Not Contact is enforced in the database (no pending email/SMS/call
--     follow-ups) and in the sender (never emailed).
--   * Podio sync proposals wait in marketing_sync_changes until staff approve.
--   * marketing_monitor() (hourly cron via marketing-send process "due") runs the
--     rules and raises notifications for the assigned staff member.

-- ── Statuses ────────────────────────────────────────────────────────────────
alter table public.marketing_leads drop constraint if exists marketing_leads_stage_check;
update public.marketing_leads set stage = case stage when 'customer' then 'subscribed' when 'lost' then 'not_interested' else stage end
 where stage in ('customer', 'lost');
alter table public.marketing_leads add constraint marketing_leads_stage_check check (stage in (
  'new', 'researching', 'ready', 'contacted', 'interested', 'registered', 'subscribed',
  'no_response', 'not_interested', 'do_not_contact'));

alter table public.marketing_leads drop constraint if exists marketing_leads_source_check;
alter table public.marketing_leads add constraint marketing_leads_source_check check (source in (
  'manual', 'beta_signup', 'registered', 'referral', 'website', 'import', 'event', 'podio', 'research'));

create or replace function public.marketing_stage_label(s text) returns text language sql immutable as $$
  select case s
    when 'new' then 'New Lead' when 'researching' then 'Researching' when 'ready' then 'Ready for Outreach'
    when 'contacted' then 'Contacted' when 'interested' then 'Interested' when 'registered' then 'Registered'
    when 'subscribed' then 'Subscribed' when 'no_response' then 'No Response'
    when 'not_interested' then 'Not Interested' when 'do_not_contact' then 'Do Not Contact' else s end;
$$;

-- ── Lead profile columns ────────────────────────────────────────────────────
alter table public.marketing_leads
  add column if not exists city text,
  add column if not exists zip text,
  add column if not exists mailing_address text,
  add column if not exists podio_item_id bigint,
  add column if not exists podio_app_id bigint,
  add column if not exists priority text check (priority in ('high', 'medium', 'low')),
  add column if not exists priority_reason text,
  add column if not exists next_action text,
  add column if not exists next_action_at timestamptz,
  add column if not exists suggested_stage text,
  add column if not exists suggested_stage_reason text,
  add column if not exists suggested_at timestamptz,
  add column if not exists suggestion_dismissed text,
  add column if not exists dnc_reason text,
  add column if not exists dnc_at timestamptz,
  -- {field: {source, detail, confidence (0-1), verified, at}}
  add column if not exists field_sources jsonb not null default '{}'::jsonb,
  -- [{field, message, severity: "info"|"warning"}] — uncertain details for staff to verify
  add column if not exists research_flags jsonb not null default '[]'::jsonb,
  add column if not exists researched_at timestamptz,
  add column if not exists last_engaged_at timestamptz,
  -- portfolio rollups (maintained by trigger from marketing_lead_properties)
  add column if not exists portfolio_count int not null default 0,
  add column if not exists portfolio_value numeric,
  add column if not exists counties text[] not null default '{}',
  add column if not exists cities text[] not null default '{}',
  add column if not exists zips text[] not null default '{}',
  add column if not exists property_types text[] not null default '{}';
create unique index if not exists marketing_leads_podio on public.marketing_leads (podio_app_id, podio_item_id) where podio_item_id is not null;
create index if not exists marketing_leads_assigned on public.marketing_leads (assigned_to);

alter table public.marketing_activities drop constraint if exists marketing_activities_kind_check;
alter table public.marketing_activities add constraint marketing_activities_kind_check check (kind in (
  'note', 'email', 'sms', 'call', 'stage', 'ai', 'follow_up', 'campaign', 'import', 'sync', 'research', 'assign'));
-- What the contact said, when staff log a call/email/meeting. Drives the outcome rules.
alter table public.marketing_activities add column if not exists outcome text
  check (outcome in ('interested', 'not_interested', 'no_answer', 'replied', 'do_not_contact'));

-- ── Properties / portfolios ─────────────────────────────────────────────────
create table if not exists public.marketing_lead_properties (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  lead_id uuid not null references public.marketing_leads(id) on delete cascade,
  address text,
  city text,
  zip text,
  county text,
  cad text,
  account_number text,
  property_type text,
  assessed_value numeric,
  land_value numeric,
  improvement_value numeric,
  prior_value numeric,
  tax_year int,
  owner_name text,
  mailing_address text,
  protest_deadline date,
  source text not null default 'manual' check (source in ('manual', 'import', 'podio', 'cad', 'account', 'research')),
  source_detail text,
  verified boolean not null default false,
  confidence numeric check (confidence between 0 and 1),
  notes text,
  dedupe_key text generated always as (
    case when nullif(trim(account_number), '') is not null
      then 'acct:' || lower(coalesce(county, '')) || ':' || lower(trim(account_number))
      else 'addr:' || regexp_replace(lower(coalesce(address, '')), '[^a-z0-9]', '', 'g') end
  ) stored
);
create unique index if not exists marketing_lead_properties_key on public.marketing_lead_properties (lead_id, dedupe_key);
create index if not exists marketing_lead_properties_acct on public.marketing_lead_properties (dedupe_key);

-- ── Saved segments, Podio review queue, notifications, settings ────────────
create table if not exists public.marketing_segments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  description text,
  -- LeadFilters (apps/pt/src/lib/marketing-crm.ts)
  filters jsonb not null default '{}'::jsonb,
  ai_suggested boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.marketing_sync_changes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  direction text not null check (direction in ('podio_to_crm', 'crm_to_podio')),
  kind text not null check (kind in ('create', 'update', 'link')),
  lead_id uuid references public.marketing_leads(id) on delete cascade,
  podio_app_id bigint,
  podio_item_id bigint,
  title text not null,
  -- [{field, label, from, to, podioExternalId?, podioType?}]
  changes jsonb not null default '[]'::jsonb,
  -- the Podio item as a CRM lead (for creates)
  payload jsonb,
  match_confidence numeric,
  match_reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'applied', 'failed')),
  error text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz
);
create index if not exists marketing_sync_changes_status on public.marketing_sync_changes (status, created_at desc);

create table if not exists public.marketing_notifications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  staff_id uuid not null references public.profiles(id) on delete cascade,
  lead_id uuid references public.marketing_leads(id) on delete cascade,
  kind text not null,
  title text not null,
  detail text,
  dedupe_key text not null unique,
  read_at timestamptz,
  emailed_at timestamptz
);
create index if not exists marketing_notifications_staff on public.marketing_notifications (staff_id, read_at, created_at desc);

create table if not exists public.marketing_settings (
  id int primary key default 1 check (id = 1),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  -- {ruleId: "auto" | "suggest" | "off"}; missing = the rule's default
  rules jsonb not null default '{}'::jsonb,
  inactive_days int not null default 14 check (inactive_days between 3 and 90),
  notify_email boolean not null default true,
  -- {appId, appName, mapping: {externalId: leadField}}
  podio jsonb not null default '{}'::jsonb
);
insert into public.marketing_settings (id) values (1) on conflict do nothing;

do $$
declare t text;
begin
  foreach t in array array['marketing_lead_properties','marketing_segments','marketing_sync_changes','marketing_notifications','marketing_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "Marketing admins manage %s" on public.%I', t, t);
    execute format('create policy "Marketing admins manage %s" on public.%I for all to authenticated using ((select public.is_marketing_admin())) with check ((select public.is_marketing_admin()))', t, t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
revoke delete on public.marketing_settings from authenticated;

drop trigger if exists marketing_lead_properties_touch on public.marketing_lead_properties;
create trigger marketing_lead_properties_touch before update on public.marketing_lead_properties for each row execute function public.touch_updated_at();
drop trigger if exists marketing_segments_touch on public.marketing_segments;
create trigger marketing_segments_touch before update on public.marketing_segments for each row execute function public.touch_updated_at();

-- ── Portfolio rollup ────────────────────────────────────────────────────────
create or replace function public.marketing_rollup_lead(p_lead uuid) returns void
language sql security definer set search_path = public as $$
  update public.marketing_leads l set
    portfolio_count = s.n,
    portfolio_value = s.total,
    counties = s.counties, cities = s.cities, zips = s.zips, property_types = s.types,
    property_address = s.top_address,
    county = s.top_county,
    property_type = s.top_type,
    appraised_value = s.top_value,
    protest_deadline = s.deadline,
    owner_names = coalesce(l.owner_names, s.top_owner)
  from (
    select count(*)::int n,
           sum(assessed_value) total,
           coalesce(array_agg(distinct county) filter (where county is not null), '{}') counties,
           coalesce(array_agg(distinct city) filter (where city is not null), '{}') cities,
           coalesce(array_agg(distinct zip) filter (where zip is not null), '{}') zips,
           coalesce(array_agg(distinct property_type) filter (where property_type is not null), '{}') types,
           (array_agg(address order by assessed_value desc nulls last, created_at))[1] top_address,
           (array_agg(county order by assessed_value desc nulls last, created_at))[1] top_county,
           (array_agg(property_type order by assessed_value desc nulls last, created_at))[1] top_type,
           (array_agg(assessed_value order by assessed_value desc nulls last, created_at))[1] top_value,
           (array_agg(owner_name order by assessed_value desc nulls last, created_at))[1] top_owner,
           coalesce(min(protest_deadline) filter (where protest_deadline >= current_date), max(protest_deadline)) deadline
    from public.marketing_lead_properties where lead_id = p_lead
  ) s
  where l.id = p_lead;
$$;
revoke all on function public.marketing_rollup_lead(uuid) from public, anon, authenticated;

create or replace function public.marketing_lead_properties_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then perform public.marketing_rollup_lead(new.lead_id); end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.lead_id <> new.lead_id) then perform public.marketing_rollup_lead(old.lead_id); end if;
  return null;
end; $$;
drop trigger if exists marketing_lead_properties_rollup on public.marketing_lead_properties;
create trigger marketing_lead_properties_rollup after insert or update or delete on public.marketing_lead_properties
  for each row execute function public.marketing_lead_properties_changed();

-- Existing leads' single property becomes the first portfolio entry.
insert into public.marketing_lead_properties (lead_id, address, county, property_type, assessed_value, owner_name, protest_deadline, source, source_detail, verified)
select id, property_address, county, property_type, appraised_value, owner_names, protest_deadline,
       case when profile_id is not null then 'account' else 'manual' end,
       case when profile_id is not null then 'CorvusPT account' else 'Entered by staff' end,
       profile_id is not null
from public.marketing_leads l
where property_address is not null
  and not exists (select 1 from public.marketing_lead_properties p where p.lead_id = l.id)
on conflict do nothing;

-- ── Status history + assignment (one trigger for every writer) ─────────────
create or replace function public.marketing_leads_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_reason text := nullif(current_setting('marketing.reason', true), '');
  v_actor uuid := case when v_reason is null then auth.uid() else null end;
begin
  if new.stage is distinct from old.stage then
    insert into public.marketing_activities (lead_id, kind, summary, body, created_by)
    values (new.id, 'stage',
            'Status: ' || public.marketing_stage_label(old.stage) || ' → ' || public.marketing_stage_label(new.stage),
            v_reason, v_actor);
    if new.stage = 'do_not_contact' then
      new.dnc_at := coalesce(new.dnc_at, now());
      -- nothing queued may go out to them
      update public.marketing_followups set status = 'skipped', completed_at = now()
       where lead_id = new.id and status = 'pending' and channel <> 'task';
    end if;
    if new.suggested_stage = new.stage then
      new.suggested_stage := null; new.suggested_stage_reason := null; new.suggested_at := null;
    end if;
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.marketing_activities (lead_id, kind, summary, created_by)
    values (new.id, 'assign',
            case when new.assigned_to is null then 'Unassigned'
                 else 'Assigned to ' || coalesce((select nullif(trim(concat_ws(' ', first_name, last_name)), '') from public.profiles where id = new.assigned_to),
                                                  (select email from public.profiles where id = new.assigned_to), 'staff') end,
            v_actor);
    if new.assigned_to is not null and new.assigned_to is distinct from auth.uid() then
      insert into public.marketing_notifications (staff_id, lead_id, kind, title, detail, dedupe_key)
      values (new.assigned_to, new.id, 'assigned',
              'New lead assigned to you: ' || coalesce(new.company, new.full_name, new.email, 'lead'),
              coalesce(new.next_action, 'Open the lead to see the recommended next action.'),
              'assigned:' || new.id || ':' || new.assigned_to || ':' || extract(epoch from now())::bigint)
      on conflict (dedupe_key) do nothing;
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists marketing_leads_audit on public.marketing_leads;
create trigger marketing_leads_audit before update on public.marketing_leads for each row execute function public.marketing_leads_audit();

-- ── Do Not Contact: nothing pending may go out ─────────────────────────────
create or replace function public.marketing_followups_dnc() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pending' and new.channel <> 'task'
     and exists (select 1 from public.marketing_leads where id = new.lead_id and stage = 'do_not_contact') then
    raise exception 'This lead is marked Do Not Contact — no outreach can be scheduled.' using errcode = '42501';
  end if;
  return new;
end; $$;
drop trigger if exists marketing_followups_dnc on public.marketing_followups;
create trigger marketing_followups_dnc before insert or update on public.marketing_followups for each row execute function public.marketing_followups_dnc();

-- ── Staff list (for assignment) ─────────────────────────────────────────────
create or replace function public.marketing_staff()
returns table (id uuid, name text, email text, is_super_admin boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_marketing_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  return query
    select p.id, coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email), p.email, coalesce(p.is_admin, false)
    from public.profiles p where coalesce(p.is_admin, false) or coalesce(p.marketing_admin, false)
    order by 2;
end; $$;
revoke all on function public.marketing_staff() from public, anon;
grant execute on function public.marketing_staff() to authenticated;

-- ── Rules ───────────────────────────────────────────────────────────────────
-- Defaults (marketing_settings.rules overrides). Kept in step with RULES in
-- apps/pt/src/lib/marketing-crm.ts, which describes them in the UI.
create or replace function public.marketing_rule_mode(p_rules jsonb, p_rule text) returns text
language sql immutable as $$
  select coalesce(p_rules ->> p_rule, case p_rule
    when 'needs_research' then 'auto'
    when 'research_complete' then 'auto'
    when 'outreach_contacted' then 'auto'
    when 'outcome_interested' then 'auto'
    when 'outcome_replied' then 'auto'
    when 'outcome_do_not_contact' then 'auto'
    when 'outcome_not_interested' then 'suggest'
    when 'no_response' then 'suggest'
    when 'unsubscribed_dnc' then 'suggest'
    else 'off' end);
$$;

create or replace function public.marketing_apply_rules(p_lead uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_rules jsonb;
  v_days int;
  v_n int := 0;
  r record;
  v_mode text;
begin
  select rules, inactive_days into v_rules, v_days from public.marketing_settings where id = 1;
  v_rules := coalesce(v_rules, '{}'::jsonb); v_days := coalesce(v_days, 14);

  for r in
    with l as (
      select ml.*,
             (select a.created_at from public.marketing_activities a where a.lead_id = ml.id and a.kind = 'stage' order by a.created_at desc limit 1) last_change,
             (select a.created_by is not null from public.marketing_activities a where a.lead_id = ml.id and a.kind = 'stage' order by a.created_at desc limit 1) last_change_manual
      from public.marketing_leads ml
      where (p_lead is null or ml.id = p_lead) and ml.stage not in ('subscribed', 'do_not_contact')
    ),
    cand as (
      -- explicit "don't contact me" always first
      select l.id, 1 rk, 'outcome_do_not_contact' rule, 'do_not_contact' target, 'They asked not to be contacted (logged outcome)' reason
        from l where exists (select 1 from public.marketing_activities a where a.lead_id = l.id and a.outcome = 'do_not_contact'
                             and a.created_at > coalesce(l.last_change, '-infinity'))
      union all
      select l.id, 2, 'unsubscribed_dnc', 'do_not_contact', 'Unsubscribed from marketing email'
        from l where l.unsubscribed_at is not null
      union all
      select l.id, 3, 'outcome_' || o.outcome,
             case o.outcome when 'interested' then 'interested' when 'not_interested' then 'not_interested' else 'contacted' end,
             'Logged outcome: ' || replace(o.outcome, '_', ' ')
        from l join lateral (
          select a.outcome from public.marketing_activities a
           where a.lead_id = l.id and a.outcome in ('interested', 'not_interested', 'replied')
             and a.created_at > coalesce(l.last_change, '-infinity')
           order by a.created_at desc limit 1) o on true
       where l.stage not in ('registered')
      union all
      select l.id, 4, 'outreach_contacted', 'contacted', 'Outreach was sent or logged'
        from l where l.stage in ('new', 'researching', 'ready')
         and exists (select 1 from public.marketing_activities a where a.lead_id = l.id and a.kind in ('email', 'sms', 'call')
                     and a.created_at > coalesce(l.last_change, '-infinity'))
      union all
      select l.id, 5, 'no_response', 'no_response',
             format('No reply after %s outreach attempts; last one over %s days ago', x.n, v_days)
        from l join lateral (
          select count(*) n, max(a.created_at) last_at from public.marketing_activities a
           where a.lead_id = l.id and a.kind in ('email', 'sms', 'call')) x on true
       where l.stage = 'contacted' and x.n >= 2 and x.last_at < now() - make_interval(days => v_days)
         and not exists (select 1 from public.marketing_activities a where a.lead_id = l.id and a.outcome in ('interested', 'replied', 'not_interested') and a.created_at > x.last_at - interval '60 days')
         and not coalesce(l.last_change_manual and l.last_change > x.last_at, false)
      union all
      select l.id, 6, 'research_complete', 'ready', 'Has a way to reach them and at least one property'
        from l where l.stage in ('new', 'researching') and (l.email is not null or l.phone is not null) and l.portfolio_count > 0
         and not coalesce(l.last_change_manual, false)
      union all
      select l.id, 7, 'needs_research', 'researching', 'Missing contact details or property — research first'
        from l where l.stage = 'new' and ((l.email is null and l.phone is null) or l.portfolio_count = 0)
         and not coalesce(l.last_change_manual, false)
    )
    select distinct on (c.id) c.*, ml.stage cur, ml.suggested_stage, ml.suggestion_dismissed
      from cand c join public.marketing_leads ml on ml.id = c.id
     where c.target <> ml.stage
     order by c.id, c.rk
  loop
    v_mode := public.marketing_rule_mode(v_rules, r.rule);
    if v_mode = 'auto' then
      perform set_config('marketing.reason', 'Rule: ' || r.reason, true);
      update public.marketing_leads set stage = r.target where id = r.id;
      perform set_config('marketing.reason', '', true);
      v_n := v_n + 1;
    elsif v_mode = 'suggest' and r.suggested_stage is distinct from r.target and r.suggestion_dismissed is distinct from r.target then
      update public.marketing_leads
         set suggested_stage = r.target, suggested_stage_reason = r.reason, suggested_at = now()
       where id = r.id;
      v_n := v_n + 1;
    end if;
  end loop;

  -- suggestions that no longer apply
  update public.marketing_leads set suggested_stage = null, suggested_stage_reason = null, suggested_at = null
   where (p_lead is null or id = p_lead) and suggested_stage is not null
     and (suggested_stage = stage or stage = 'do_not_contact');
  return v_n;
end; $$;
revoke all on function public.marketing_apply_rules(uuid) from public, anon, authenticated;

create or replace function public.marketing_run_rules(p_lead uuid default null) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_marketing_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  return public.marketing_apply_rules(p_lead);
end; $$;
revoke all on function public.marketing_run_rules(uuid) from public, anon;
grant execute on function public.marketing_run_rules(uuid) to authenticated;

-- ── Monitor: rules + notifications for the assigned staff member ───────────
create or replace function public.marketing_monitor() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_days int := coalesce((select inactive_days from public.marketing_settings where id = 1), 14);
  v_rules int;
  v_notes int := 0;
  c int;
begin
  v_rules := public.marketing_apply_rules(null);

  insert into public.marketing_notifications (staff_id, lead_id, kind, title, detail, dedupe_key)
  select l.assigned_to, l.id, 'overdue',
         'Overdue ' || f.channel || ': ' || coalesce(l.company, l.full_name, l.email, 'lead'),
         coalesce(f.subject, 'Follow-up') || ' — due ' || to_char(f.due_at at time zone 'America/Chicago', 'Mon DD'),
         'overdue:' || f.id
    from public.marketing_followups f join public.marketing_leads l on l.id = f.lead_id
   where f.status = 'pending' and f.due_at < now() and l.assigned_to is not null
  on conflict (dedupe_key) do nothing;
  get diagnostics c = row_count; v_notes := v_notes + c;

  insert into public.marketing_notifications (staff_id, lead_id, kind, title, detail, dedupe_key)
  select l.assigned_to, l.id, 'next_action',
         'Action due: ' || coalesce(l.company, l.full_name, l.email, 'lead'),
         l.next_action,
         'next:' || l.id || ':' || to_char(l.next_action_at, 'YYYYMMDD')
    from public.marketing_leads l
   where l.assigned_to is not null and l.next_action is not null and l.next_action_at < now()
     and l.stage not in ('do_not_contact', 'not_interested', 'subscribed')
  on conflict (dedupe_key) do nothing;
  get diagnostics c = row_count; v_notes := v_notes + c;

  insert into public.marketing_notifications (staff_id, lead_id, kind, title, detail, dedupe_key)
  select l.assigned_to, l.id, 'inactive',
         'Going quiet: ' || coalesce(l.company, l.full_name, l.email, 'lead'),
         format('No activity for %s days — follow up or update the status.', extract(day from now() - x.last_at)::int),
         'inactive:' || l.id || ':' || to_char(now(), 'IYYYIW')
    from public.marketing_leads l
    join lateral (select coalesce(max(a.created_at), l.created_at) last_at from public.marketing_activities a where a.lead_id = l.id) x on true
   where l.assigned_to is not null and l.stage in ('ready', 'contacted', 'interested', 'registered')
     and x.last_at < now() - make_interval(days => v_days)
     and not exists (select 1 from public.marketing_followups f where f.lead_id = l.id and f.status = 'pending')
  on conflict (dedupe_key) do nothing;
  get diagnostics c = row_count; v_notes := v_notes + c;

  insert into public.marketing_notifications (staff_id, lead_id, kind, title, detail, dedupe_key)
  select l.assigned_to, l.id, 'suggestion',
         'Status suggestion: ' || coalesce(l.company, l.full_name, l.email, 'lead') || ' → ' || public.marketing_stage_label(l.suggested_stage),
         l.suggested_stage_reason,
         'suggest:' || l.id || ':' || l.suggested_stage
    from public.marketing_leads l
   where l.assigned_to is not null and l.suggested_stage is not null
  on conflict (dedupe_key) do nothing;
  get diagnostics c = row_count; v_notes := v_notes + c;

  -- engagement changes made by the system (signed up, subscribed, unsubscribed, rules)
  insert into public.marketing_notifications (staff_id, lead_id, kind, title, detail, dedupe_key)
  select l.assigned_to, l.id, 'engagement',
         coalesce(l.company, l.full_name, l.email, 'Lead') || ': ' || a.summary,
         a.body,
         'activity:' || a.id
    from public.marketing_activities a join public.marketing_leads l on l.id = a.lead_id
   where a.created_by is null and a.created_at > now() - interval '2 hours' and l.assigned_to is not null
     and (a.kind = 'stage' or a.summary ilike 'Unsubscribed%')
     -- research housekeeping (New Lead → Researching → Ready) isn't engagement
     and coalesce(a.body, '') not like 'Rule: Missing contact%'
     and coalesce(a.body, '') not like 'Rule: Has a way to reach%'
  on conflict (dedupe_key) do nothing;
  get diagnostics c = row_count; v_notes := v_notes + c;

  return jsonb_build_object('rules', v_rules, 'notifications', v_notes);
end; $$;
revoke all on function public.marketing_monitor() from public, anon, authenticated;

-- ── Account sync: every property of a registered user joins their portfolio ─
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
  perform set_config('marketing.reason', 'Account sync: matches their CorvusPT account', true);

  insert into public.marketing_leads (full_name, email, company, source, beta_lead_id, created_at, notes)
  select b.full_name, b.work_email, b.company, 'beta_signup', b.id, b.created_at,
         nullif(concat_ws(' · ', nullif(b.area_of_interest, ''), nullif(b.use_case, '')), '')
  from public.beta_leads b
  where nullif(trim(b.work_email), '') is not null
    and b.work_email not ilike '%@example.com' -- test/CI signups
  on conflict (email_key) do update
    set beta_lead_id = coalesce(marketing_leads.beta_lead_id, excluded.beta_lead_id),
        company = coalesce(marketing_leads.company, excluded.company),
        full_name = coalesce(marketing_leads.full_name, excluded.full_name)
    where marketing_leads.beta_lead_id is null or marketing_leads.company is null or marketing_leads.full_name is null;
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
           ) as paying
    from public.profiles p
    where coalesce(p.is_admin, false) = false
      and coalesce(p.marketing_admin, false) = false
      and nullif(trim(p.email), '') is not null
      and p.email not ilike '%@example.com' -- test/CI accounts
  )
  insert into public.marketing_leads (full_name, email, phone, company, source, profile_id, stage, created_at)
  select u.full_name, u.email, u.phone, u.company_name, 'registered', u.id,
         case when u.paying then 'subscribed' else 'registered' end, u.created_at
  from users u
  on conflict (email_key) do update
    set profile_id = excluded.profile_id,
        phone = coalesce(marketing_leads.phone, excluded.phone),
        full_name = coalesce(marketing_leads.full_name, excluded.full_name),
        company = coalesce(marketing_leads.company, excluded.company),
        -- registered/subscribed follow the real account. Do Not Contact and
        -- Not Interested are staff decisions and stay unless they've since paid.
        stage = case
          when marketing_leads.stage = 'do_not_contact' then 'do_not_contact'
          when excluded.stage = 'subscribed' then 'subscribed'
          when marketing_leads.stage = 'subscribed' then 'registered'
          when marketing_leads.stage = 'not_interested' then 'not_interested'
          else 'registered'
        end
    where marketing_leads.profile_id is distinct from excluded.profile_id
       or (marketing_leads.phone is null and excluded.phone is not null)
       or (marketing_leads.full_name is null and excluded.full_name is not null)
       or (marketing_leads.company is null and excluded.company is not null)
       or marketing_leads.stage is distinct from (case
          when marketing_leads.stage = 'do_not_contact' then 'do_not_contact'
          when excluded.stage = 'subscribed' then 'subscribed'
          when marketing_leads.stage = 'subscribed' then 'registered'
          when marketing_leads.stage = 'not_interested' then 'not_interested'
          else 'registered' end);
  get diagnostics v_users = row_count;

  -- their properties (all of them) — the account is the verified source
  insert into public.marketing_lead_properties (lead_id, address, county, cad, account_number, property_type,
      assessed_value, land_value, improvement_value, tax_year, owner_name, protest_deadline, source, source_detail, verified, confidence)
  select distinct on (x.lead_id, x.k) x.lead_id, x.address, x.county, x.cad, x.account_number, x.property_type,
         x.total_value, x.land_value, x.improvement_value, x.yr, x.owner_name, x.protest_deadline,
         'account', 'CorvusPT account', true, 1
  from (
    select ml.id lead_id, pr.*, coalesce(pr.value_year, pr.tax_year) yr, c.county,
           case when nullif(trim(pr.account_number), '') is not null
             then 'acct:' || lower(coalesce(c.county, '')) || ':' || lower(trim(pr.account_number))
             else 'addr:' || regexp_replace(lower(coalesce(pr.address, '')), '[^a-z0-9]', '', 'g') end k
    from public.properties pr
    join public.marketing_leads ml on ml.profile_id = pr.user_id
    cross join lateral (select nullif(trim(regexp_replace(coalesce(pr.cad, ''), '\s*(central\s+)?appraisal\s+district.*$|\s+cad$', '', 'i')), '') county) c
  ) x
  order by x.lead_id, x.k, x.created_at desc
  on conflict (lead_id, dedupe_key) do update
    set assessed_value = excluded.assessed_value, land_value = excluded.land_value,
        improvement_value = excluded.improvement_value, tax_year = excluded.tax_year,
        owner_name = coalesce(excluded.owner_name, marketing_lead_properties.owner_name),
        property_type = coalesce(excluded.property_type, marketing_lead_properties.property_type),
        protest_deadline = excluded.protest_deadline, verified = true
    where (marketing_lead_properties.assessed_value, marketing_lead_properties.tax_year, marketing_lead_properties.protest_deadline)
          is distinct from (excluded.assessed_value, excluded.tax_year, excluded.protest_deadline)
       or not marketing_lead_properties.verified;

  perform set_config('marketing.reason', '', true);
  perform public.marketing_apply_rules(null);
  return jsonb_build_object('betaSignups', v_beta, 'registeredUsers', v_users, 'syncedAt', now());
end;
$$;
revoke all on function public.marketing_sync_leads() from public, anon;
grant execute on function public.marketing_sync_leads() to authenticated;

-- the hourly marketing-due job (service role) runs the rules + monitor
grant execute on function public.marketing_apply_rules(uuid) to service_role;
grant execute on function public.marketing_monitor() to service_role;

-- Real clock time, so activities written in one transaction (sync, send,
-- rules) still order correctly against the status changes they cause.
alter table public.marketing_activities alter column created_at set default clock_timestamp();
