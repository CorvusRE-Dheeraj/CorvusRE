-- Marketing analytics, spend, consent, audit, team supervision and reports
-- (builds on marketing.sql, marketing-crm.sql, marketing-leads-ai.sql,
-- marketing-followups.sql).
--
--   * marketing_expenses + campaign budget/owner → CAC, revenue per customer, ROMI
--   * plan + subscription status copied onto CRM properties → subscription revenue
--   * consent: email/SMS consent per lead + an event log; SMS needs express
--     consent, email stops on opt-out / Do Not Contact — enforced in the DB
--   * marketing_audit: who did what and when (triggers, so nothing is missed)
--   * Marketing Supervisor role (set by a Super Admin)
--   * marketing_recommendations: AI/rule findings that change nothing until approved
--   * marketing_reports: daily / weekly / monthly summaries (AI-written by the hourly job)

-- ── Spend ───────────────────────────────────────────────────────────────────
create table if not exists public.marketing_expenses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  spent_on date not null default current_date,
  amount numeric not null check (amount > 0),
  category text not null default 'other' check (category in ('ads', 'email', 'sms', 'events', 'content', 'tools', 'data', 'staff', 'other')),
  campaign_id uuid references public.marketing_campaigns(id) on delete set null,
  vendor text,
  description text,
  created_by uuid references public.profiles(id) on delete set null
);
create index if not exists marketing_expenses_on on public.marketing_expenses (spent_on);
alter table public.marketing_campaigns
  add column if not exists owner_id uuid references public.profiles(id) on delete set null,
  add column if not exists budget numeric check (budget is null or budget >= 0);

-- ── Revenue facts on CRM properties ─────────────────────────────────────────
alter table public.marketing_lead_properties
  add column if not exists plan_tier text,
  add column if not exists value_bracket text,
  add column if not exists subscription_status text;

create or replace function public.marketing_copy_plan() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.marketing_lead_properties mp
     set plan_tier = new.plan_tier, value_bracket = new.value_bracket, subscription_status = new.subscription_status
    from public.marketing_leads ml
   where ml.profile_id = new.user_id and mp.lead_id = ml.id and mp.source = 'account'
     and (mp.plan_tier, mp.value_bracket, mp.subscription_status) is distinct from (new.plan_tier, new.value_bracket, new.subscription_status)
     and ((nullif(trim(new.account_number), '') is not null and lower(trim(mp.account_number)) = lower(trim(new.account_number)))
          or regexp_replace(lower(coalesce(mp.address, '')), '[^a-z0-9]', '', 'g') = regexp_replace(lower(coalesce(new.address, '')), '[^a-z0-9]', '', 'g'));
  return null;
end; $$;
drop trigger if exists marketing_copy_plan on public.properties;
create trigger marketing_copy_plan after insert or update of plan_tier, value_bracket, subscription_status, address, account_number
  on public.properties for each row execute function public.marketing_copy_plan();
-- backfill (fires the trigger once per property)
update public.properties set plan_tier = plan_tier where subscription_status is not null or plan_tier is not null;

-- Monthly list price — mirrors TIER_BRACKET_PRICES / LEGACY_TIER_BRACKET_PRICES in apps/pt/src/lib/billing.ts.
create or replace function public.marketing_monthly_price(p_tier text, p_bracket text) returns numeric
language sql immutable as $$
  select case
    when p_bracket = 'upTo5m' then 299
    when p_tier = 'corvusrf_managed' then case p_bracket when 'under2m' then 199 when 'mid2m10m' then 499 when 'over10m' then 799 else 299 end
    else case p_bracket when 'under2m' then 99 when 'mid2m10m' then 299 when 'over10m' then 499 else 299 end
  end;
$$;

-- ── Consent + eligibility ───────────────────────────────────────────────────
alter table public.marketing_leads
  add column if not exists email_consent text not null default 'unknown' check (email_consent in ('granted', 'unknown', 'withdrawn')),
  add column if not exists sms_consent text not null default 'unknown' check (sms_consent in ('granted', 'unknown', 'withdrawn')),
  add column if not exists consent_source text,
  add column if not exists consent_updated_at timestamptz;

create table if not exists public.marketing_consent_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  lead_id uuid not null references public.marketing_leads(id) on delete cascade,
  channel text not null check (channel in ('email', 'sms', 'all')),
  action text not null check (action in ('granted', 'withdrawn', 'unsubscribed', 'resubscribed', 'do_not_contact', 'contact_allowed')),
  source text,
  created_by uuid references public.profiles(id) on delete set null
);
create index if not exists marketing_consent_events_lead on public.marketing_consent_events (lead_id, created_at desc);

create or replace function public.marketing_consent_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_src text := coalesce(new.consent_source, case when auth.uid() is null then 'system' else 'staff' end);
begin
  if new.email_consent is distinct from old.email_consent then
    insert into public.marketing_consent_events (lead_id, channel, action, source, created_by) values (new.id, 'email', new.email_consent, v_src, v_actor);
  end if;
  if new.sms_consent is distinct from old.sms_consent then
    insert into public.marketing_consent_events (lead_id, channel, action, source, created_by) values (new.id, 'sms', new.sms_consent, v_src, v_actor);
  end if;
  if new.unsubscribed_at is distinct from old.unsubscribed_at then
    insert into public.marketing_consent_events (lead_id, channel, action, source, created_by)
    values (new.id, 'email', case when new.unsubscribed_at is null then 'resubscribed' else 'unsubscribed' end,
            case when auth.uid() is null then 'unsubscribe link' else 'staff' end, v_actor);
  end if;
  if (new.stage = 'do_not_contact') is distinct from (old.stage = 'do_not_contact') then
    insert into public.marketing_consent_events (lead_id, channel, action, source, created_by)
    values (new.id, 'all', case when new.stage = 'do_not_contact' then 'do_not_contact' else 'contact_allowed' end,
            coalesce(nullif(current_setting('marketing.reason', true), ''), case when auth.uid() is null then 'system' else 'staff' end), v_actor);
  end if;
  if new.email_consent is distinct from old.email_consent or new.sms_consent is distinct from old.sms_consent then
    new.consent_updated_at := now();
  end if;
  return new;
end; $$;
drop trigger if exists marketing_consent_log on public.marketing_leads;
create trigger marketing_consent_log before update on public.marketing_leads for each row execute function public.marketing_consent_log();

-- Who may be contacted, on which channel — the single rule the app, the sender and the follow-up trigger share.
create or replace function public.marketing_can_contact(p_lead uuid, p_channel text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when l.id is null then 'Lead not found'
    when l.stage = 'do_not_contact' then 'Do Not Contact'
    when p_channel = 'email' and l.email is null then 'No email address'
    when p_channel = 'email' and l.unsubscribed_at is not null then 'Unsubscribed from email'
    when p_channel = 'email' and l.email_consent = 'withdrawn' then 'Email consent withdrawn'
    when p_channel = 'sms' and l.phone is null then 'No phone number'
    when p_channel = 'sms' and l.sms_consent <> 'granted' then 'No SMS consent on record (texts need express written consent)'
    when p_channel = 'call' and l.phone is null then 'No phone number'
    else null end
  from (select 1) x left join public.marketing_leads l on l.id = p_lead;
$$;
grant execute on function public.marketing_can_contact(uuid, text) to authenticated;

create or replace function public.marketing_followups_dnc() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_why text;
begin
  if new.status in ('pending', 'draft') and new.channel in ('email', 'sms', 'call', 'meeting') then
    v_why := public.marketing_can_contact(new.lead_id, case when new.channel = 'meeting' then 'call' else new.channel end);
    -- meetings/calls only need "not Do Not Contact"; a missing phone is fine for an in-person meeting
    if new.channel = 'meeting' and v_why = 'No phone number' then v_why := null; end if;
    if v_why is not null then
      raise exception '% — this outreach can''t be scheduled.', v_why using errcode = '42501';
    end if;
  end if;
  return new;
end; $$;

-- ── Supervisor role ─────────────────────────────────────────────────────────
alter table public.profiles add column if not exists marketing_supervisor boolean not null default false;
create or replace function public.is_marketing_supervisor()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin or (p.marketing_admin and p.marketing_supervisor) from public.profiles p where p.id = auth.uid()), false);
$$;
grant execute on function public.is_marketing_supervisor() to authenticated;
create or replace function public.set_marketing_supervisor(target uuid, enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if not public.is_admin() then raise exception 'Only a Super Admin can change supervisor access' using errcode = '42501'; end if;
  update public.profiles set marketing_supervisor = enabled, marketing_admin = marketing_admin or enabled where id = target returning email into v_email;
  if not found then raise exception 'No such user'; end if;
  insert into public.admin_audit_log (actor_id, actor_email, action, target_user_id, target_email, detail)
  values (auth.uid(), (select email from public.profiles where id = auth.uid()),
          case when enabled then 'grant_marketing_supervisor' else 'revoke_marketing_supervisor' end, target, v_email,
          case when enabled then 'Marketing Supervisor access granted' else 'Marketing Supervisor access removed' end);
end; $$;
revoke all on function public.set_marketing_supervisor(uuid, boolean) from public, anon;
grant execute on function public.set_marketing_supervisor(uuid, boolean) to authenticated;

drop function if exists public.marketing_staff();
create or replace function public.marketing_staff()
returns table (id uuid, name text, email text, is_super_admin boolean, is_supervisor boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_marketing_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  return query
    select p.id, coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email), p.email,
           coalesce(p.is_admin, false), coalesce(p.is_admin, false) or coalesce(p.marketing_supervisor, false)
    from public.profiles p where coalesce(p.is_admin, false) or coalesce(p.marketing_admin, false)
    order by 2;
end; $$;
revoke all on function public.marketing_staff() from public, anon;
grant execute on function public.marketing_staff() to authenticated;

-- ── Audit history ───────────────────────────────────────────────────────────
create table if not exists public.marketing_audit (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_label text not null,
  entity text not null,
  entity_id uuid,
  action text not null,
  summary text not null,
  detail jsonb
);
create index if not exists marketing_audit_recent on public.marketing_audit (created_at desc);
create index if not exists marketing_audit_entity on public.marketing_audit (entity, entity_id);
alter table public.marketing_audit enable row level security;
drop policy if exists "Supervisors read the audit" on public.marketing_audit;
create policy "Supervisors read the audit" on public.marketing_audit for select to authenticated using ((select public.is_marketing_supervisor()));
revoke all on public.marketing_audit from anon, authenticated;
grant select on public.marketing_audit to authenticated;

create or replace function public.marketing_audit_write(p_entity text, p_id uuid, p_action text, p_summary text, p_detail jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_reason text := nullif(current_setting('marketing.reason', true), '');
begin
  insert into public.marketing_audit (actor_id, actor_label, entity, entity_id, action, summary, detail)
  values (v_uid,
          coalesce((select coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), email) from public.profiles where id = v_uid),
                   case when v_reason ilike 'Rule:%' then 'Corvus AI rule' when v_reason is not null then 'System (' || v_reason || ')' else 'System' end),
          p_entity, p_id, p_action, p_summary, p_detail);
end; $$;
revoke all on function public.marketing_audit_write(text, uuid, text, text, jsonb) from public, anon, authenticated;

create or replace function public.marketing_audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t text := tg_table_name;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  r jsonb := coalesce(n, o);
  nm text := coalesce(r ->> 'company', r ->> 'full_name', r ->> 'name', r ->> 'email', r ->> 'subject', '');
  changed text[];
  k text;
begin
  if t = 'marketing_leads' then
    if tg_op = 'INSERT' then perform public.marketing_audit_write('lead', (r->>'id')::uuid, 'created', 'Lead added: ' || nm || ' (' || (r->>'source') || ')');
    elsif tg_op = 'DELETE' then perform public.marketing_audit_write('lead', (r->>'id')::uuid, 'deleted', 'Lead deleted: ' || nm);
    else
      foreach k in array array['full_name', 'company', 'email', 'phone', 'mailing_address', 'owner_names'] loop
        if n->k is distinct from o->k then changed := changed || k; end if;
      end loop;
      if changed is not null then
        perform public.marketing_audit_write('lead', (r->>'id')::uuid, 'contact_updated', 'Contact details changed: ' || nm,
          jsonb_build_object('fields', changed, 'from', (select jsonb_object_agg(x, o->x) from unnest(changed) x), 'to', (select jsonb_object_agg(x, n->x) from unnest(changed) x)));
      end if;
      if n->'stage' is distinct from o->'stage' then
        perform public.marketing_audit_write('lead', (r->>'id')::uuid, 'status_changed', format('%s: %s → %s', nm, public.marketing_stage_label(o->>'stage'), public.marketing_stage_label(n->>'stage')));
      end if;
      if n->'assigned_to' is distinct from o->'assigned_to' then
        perform public.marketing_audit_write('lead', (r->>'id')::uuid, 'assigned', format('%s assigned to %s', nm,
          coalesce((select coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), email) from public.profiles where id = (n->>'assigned_to')::uuid), 'nobody')));
      end if;
      if n->'email_consent' is distinct from o->'email_consent' or n->'sms_consent' is distinct from o->'sms_consent'
         or n->'unsubscribed_at' is distinct from o->'unsubscribed_at' then
        perform public.marketing_audit_write('consent', (r->>'id')::uuid, 'consent_changed', format('%s: email %s, SMS %s%s', nm, n->>'email_consent', n->>'sms_consent', case when n->>'unsubscribed_at' is not null then ', unsubscribed' else '' end));
      end if;
      if n->'priority' is distinct from o->'priority' then
        perform public.marketing_audit_write('lead', (r->>'id')::uuid, 'priority_changed', format('%s priority: %s', nm, coalesce(n->>'priority', 'AI ranking')));
      end if;
    end if;
  elsif t = 'marketing_campaigns' then
    if tg_op = 'INSERT' then perform public.marketing_audit_write('campaign', (r->>'id')::uuid, 'created', 'Campaign created: ' || (r->>'name'));
    elsif tg_op = 'DELETE' then perform public.marketing_audit_write('campaign', (r->>'id')::uuid, 'deleted', 'Campaign deleted: ' || (r->>'name'));
    else
      if n->'status' is distinct from o->'status' then
        perform public.marketing_audit_write('campaign', (r->>'id')::uuid,
          case n->>'status' when 'approved' then 'approved' when 'sent' then 'launched' when 'scheduled' then 'scheduled' when 'paused' then 'paused' else 'status_changed' end,
          format('Campaign "%s": %s → %s', r->>'name', o->>'status', n->>'status'),
          case when n->>'status' = 'sent' then n->'stats' end);
      end if;
      if n->'budget' is distinct from o->'budget' or n->'owner_id' is distinct from o->'owner_id' then
        perform public.marketing_audit_write('campaign', (r->>'id')::uuid, 'updated', format('Campaign "%s": budget %s, owner %s', r->>'name', coalesce(n->>'budget', '—'),
          coalesce((select coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), email) from public.profiles where id = (n->>'owner_id')::uuid), 'nobody')));
      end if;
    end if;
  elsif t = 'marketing_followups' then
    if tg_op = 'INSERT' then perform public.marketing_audit_write('followup', (r->>'id')::uuid, 'created', format('%s follow-up created (%s)%s', initcap(r->>'channel'), r->>'status', case when (r->>'ai_generated')::boolean then ' by Corvus AI' else '' end));
    elsif tg_op = 'UPDATE' and (n->'status' is distinct from o->'status' or n->'assigned_to' is distinct from o->'assigned_to') then
      perform public.marketing_audit_write('followup', (r->>'id')::uuid,
        case when n->'status' is distinct from o->'status' then case n->>'status' when 'pending' then 'approved' else n->>'status' end else 'assigned' end,
        format('%s follow-up "%s": %s', initcap(r->>'channel'), coalesce(r->>'subject', '—'),
          case when n->'status' is distinct from o->'status' then (o->>'status') || ' → ' || (n->>'status') || coalesce(' (' || (n->>'stop_reason') || ')', '')
               else 'assigned to ' || coalesce((select coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), email) from public.profiles where id = (n->>'assigned_to')::uuid), 'nobody') end));
    end if;
  elsif t = 'marketing_activities' then
    if (r->>'kind') = 'import' then perform public.marketing_audit_write('import', (r->>'lead_id')::uuid, 'imported', r->>'summary');
    elsif (r->>'kind') in ('email', 'sms', 'call', 'meeting') then perform public.marketing_audit_write('communication', (r->>'lead_id')::uuid, r->>'kind', r->>'summary');
    end if;
  elsif t = 'marketing_ai_runs' then
    perform public.marketing_audit_write('ai', (r->>'id')::uuid, 'ai_' || (r->>'scope'), 'Corvus AI (' || (r->>'scope') || '): ' || left(r->>'instruction', 140));
  elsif t = 'marketing_segments' then
    if tg_op = 'INSERT' then perform public.marketing_audit_write('segment', (r->>'id')::uuid, 'created', format('%s saved: %s', initcap(r->>'kind'), r->>'name'));
    elsif tg_op = 'DELETE' then perform public.marketing_audit_write('segment', (r->>'id')::uuid, 'deleted', format('%s deleted: %s', initcap(r->>'kind'), r->>'name'));
    elsif n->'status' is distinct from o->'status' then perform public.marketing_audit_write('segment', (r->>'id')::uuid, n->>'status', format('%s %s: %s', initcap(r->>'kind'), n->>'status', r->>'name'));
    end if;
  elsif t = 'marketing_expenses' then
    perform public.marketing_audit_write('expense', (r->>'id')::uuid, lower(tg_op), format('Expense %s: $%s %s (%s)', lower(tg_op), r->>'amount', r->>'category', coalesce(r->>'description', r->>'vendor', '')));
  elsif t = 'marketing_templates' then
    perform public.marketing_audit_write('template', (r->>'id')::uuid, lower(tg_op), format('Template %s: %s', lower(tg_op), r->>'name'));
  elsif t = 'marketing_settings' then
    perform public.marketing_audit_write('settings', null, 'updated', 'Status rules / notification settings changed', jsonb_build_object('rules', n->'rules', 'inactiveDays', n->'inactive_days', 'notifyEmail', n->'notify_email'));
  elsif t = 'marketing_recommendations' then
    if tg_op = 'INSERT' then perform public.marketing_audit_write('recommendation', (r->>'id')::uuid, 'ai_recommended', 'Corvus AI recommends: ' || (r->>'title'));
    elsif n->'status' is distinct from o->'status' then perform public.marketing_audit_write('recommendation', (r->>'id')::uuid, n->>'status', format('Recommendation %s: %s', n->>'status', r->>'title'));
    end if;
  end if;
  return null;
end; $$;

do $$
declare t text;
begin
  foreach t in array array['marketing_leads','marketing_campaigns','marketing_followups','marketing_segments','marketing_expenses','marketing_templates','marketing_settings'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit_log', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.marketing_audit_trigger()', t || '_audit_log', t);
  end loop;
  execute 'drop trigger if exists marketing_activities_audit_log on public.marketing_activities';
  execute 'create trigger marketing_activities_audit_log after insert on public.marketing_activities for each row execute function public.marketing_audit_trigger()';
  execute 'drop trigger if exists marketing_ai_runs_audit_log on public.marketing_ai_runs';
  execute 'create trigger marketing_ai_runs_audit_log after insert on public.marketing_ai_runs for each row execute function public.marketing_audit_trigger()';
end $$;

-- ── Recommendations (nothing changes until a person approves) ───────────────
create table if not exists public.marketing_recommendations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('underperforming', 'high_cost', 'declining', 'opportunity', 'reassign', 'winning')),
  action text not null check (action in ('adjust', 'pause', 'increase', 'reassign', 'review')),
  campaign_id uuid references public.marketing_campaigns(id) on delete cascade,
  staff_id uuid references public.profiles(id) on delete cascade,
  target_staff_id uuid references public.profiles(id) on delete set null,
  title text not null,
  detail text,
  metrics jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'applied')),
  dedupe_key text not null unique,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  note text
);
drop trigger if exists marketing_recommendations_audit_log on public.marketing_recommendations;
create trigger marketing_recommendations_audit_log after insert or update on public.marketing_recommendations for each row execute function public.marketing_audit_trigger();

-- ── Reports ─────────────────────────────────────────────────────────────────
create table if not exists public.marketing_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  period text not null check (period in ('daily', 'weekly', 'monthly')),
  period_start date not null,
  period_end date not null,
  metrics jsonb not null,
  summary text,
  summary_at timestamptz,
  unique (period, period_start)
);

do $$
declare t text;
begin
  foreach t in array array['marketing_expenses','marketing_consent_events','marketing_recommendations','marketing_reports'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "Marketing admins manage %s" on public.%I', t, t);
    execute format('create policy "Marketing admins manage %s" on public.%I for all to authenticated using ((select public.is_marketing_admin())) with check ((select public.is_marketing_admin()))', t, t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
-- consent history and reports are written by the system, never edited by hand
revoke update, delete on public.marketing_consent_events from authenticated;
revoke insert, update, delete on public.marketing_reports from authenticated;
grant update (summary, summary_at) on public.marketing_reports to authenticated;

-- One period's numbers (America/Chicago days).
create or replace function public.marketing_period_metrics(p_start date, p_end date) returns jsonb
language sql stable security definer set search_path = public as $$
  with b as (
    select (p_start::timestamp at time zone 'America/Chicago') s, ((p_end + 1)::timestamp at time zone 'America/Chicago') e
  ), lp as (
    -- annual list value of each subscribed customer's paid properties (2nd+ in a bracket 15% off)
    select ml.id lead_id, public.marketing_monthly_price(mp.plan_tier, mp.value_bracket) * 12 *
           case when row_number() over (partition by ml.id, mp.plan_tier, mp.value_bracket order by mp.created_at) > 1 then 0.85 else 1 end acv
    from public.marketing_leads ml join public.marketing_lead_properties mp on mp.lead_id = ml.id
    where mp.subscription_status in ('active', 'trialing', 'past_due')
  ), acv as (select lead_id, sum(acv) acv from lp group by lead_id)
  select jsonb_build_object(
    'from', p_start, 'to', p_end,
    'leads', (select count(*) from public.marketing_leads, b where created_at >= b.s and created_at < b.e),
    'contacted', (select count(distinct lead_id) from public.marketing_activities, b where kind in ('email', 'sms', 'call', 'meeting') and created_at >= b.s and created_at < b.e),
    'interested', (select count(distinct lead_id) from public.marketing_activities, b where (outcome = 'interested' or (kind = 'stage' and summary like '%→ Interested')) and created_at >= b.s and created_at < b.e),
    'registrations', (select count(*) from public.marketing_leads, b where registered_at >= b.s and registered_at < b.e),
    'subscriptions', (select count(*) from public.marketing_leads, b where subscribed_at >= b.s and subscribed_at < b.e),
    'newRevenue', coalesce((select sum(a.acv) from public.marketing_leads l join acv a on a.lead_id = l.id, b where l.subscribed_at >= b.s and l.subscribed_at < b.e), 0),
    'spend', coalesce((select sum(amount) from public.marketing_expenses where spent_on between p_start and p_end), 0),
    'campaignsSent', (select count(*) from public.marketing_campaigns, b where sent_at >= b.s and sent_at < b.e),
    'emailsSent', (select count(*) from public.marketing_activities, b where kind = 'email' and created_at >= b.s and created_at < b.e),
    'followupsDone', (select count(*) from public.marketing_followups, b where status = 'done' and completed_at >= b.s and completed_at < b.e),
    'followupsOverdue', (select count(*) from public.marketing_followups where status = 'pending' and due_at < now()),
    'byStaff', coalesce((select jsonb_agg(x) from (
        select coalesce((select coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), email) from public.profiles where id = f.owner), 'Unassigned') staff,
               count(*) filter (where f.status = 'done') done, count(*) filter (where f.status = 'pending' and f.due_at < now()) overdue
        from (select coalesce(fu.assigned_to, l.assigned_to) owner, fu.status, fu.due_at, fu.completed_at
              from public.marketing_followups fu join public.marketing_leads l on l.id = fu.lead_id, b
              where (fu.completed_at >= b.s and fu.completed_at < b.e) or fu.status = 'pending') f
        group by f.owner) x), '[]'::jsonb),
    'topCounties', coalesce((select jsonb_agg(x) from (
        select c county, count(*) leads from public.marketing_leads l, unnest(l.counties) c, b where l.created_at >= b.s and l.created_at < b.e group by c order by 2 desc limit 5) x), '[]'::jsonb)
  );
$$;
revoke all on function public.marketing_period_metrics(date, date) from public, anon;
grant execute on function public.marketing_period_metrics(date, date) to authenticated, service_role;

create or replace function public.marketing_generate_reports() returns int
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'America/Chicago')::date;
  n int := 0; c int;
  wk date := date_trunc('week', today)::date - 7;   -- last Monday..Sunday
  mo date := (date_trunc('month', today) - interval '1 month')::date;
begin
  insert into public.marketing_reports (period, period_start, period_end, metrics)
  values ('daily', today - 1, today - 1, public.marketing_period_metrics(today - 1, today - 1)) on conflict do nothing;
  get diagnostics c = row_count; n := n + c;
  insert into public.marketing_reports (period, period_start, period_end, metrics)
  values ('weekly', wk, wk + 6, public.marketing_period_metrics(wk, wk + 6)) on conflict do nothing;
  get diagnostics c = row_count; n := n + c;
  insert into public.marketing_reports (period, period_start, period_end, metrics)
  values ('monthly', mo, (mo + interval '1 month' - interval '1 day')::date, public.marketing_period_metrics(mo, (mo + interval '1 month' - interval '1 day')::date)) on conflict do nothing;
  get diagnostics c = row_count; n := n + c;
  return n;
end; $$;
revoke all on function public.marketing_generate_reports() from public, anon, authenticated;
grant execute on function public.marketing_generate_reports() to service_role;

-- ── Analysis: findings that need a decision ─────────────────────────────────
create or replace function public.marketing_analyze() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; c int;
begin
  -- campaign results: recipients who replied / moved forward within 14 days of the send
  create temp table if not exists _camp (id uuid, name text, status text, sent_at timestamptz, targeted int, engaged int, customers int, spend numeric, budget numeric) on commit drop;
  truncate _camp;
  insert into _camp
  select c.id, c.name, c.status, c.sent_at, coalesce((c.stats->>'targeted')::int, 0),
         (select count(distinct a.lead_id) from public.marketing_activities a
           where a.lead_id in (select lead_id from public.marketing_activities x where x.campaign_id = c.id and x.lead_id is not null)
             and a.created_at > c.sent_at and a.created_at < c.sent_at + interval '14 days'
             and (a.outcome in ('replied', 'interested') or (a.kind in ('stage', 'journey') and a.created_by is null and a.summary ~ '(Interested|Registration Started|Registered|Property Added|Subscription Started|Subscribed)$'))),
         (select count(*) from public.marketing_leads l
           where l.subscribed_at > c.sent_at and l.id in (select lead_id from public.marketing_activities x where x.campaign_id = c.id)),
         coalesce((select sum(amount) from public.marketing_expenses e where e.campaign_id = c.id), 0),
         c.budget
  from public.marketing_campaigns c where c.status = 'sent' and c.sent_at < now() - interval '7 days';

  insert into public.marketing_recommendations (kind, action, campaign_id, title, detail, metrics, dedupe_key)
  select 'underperforming', 'adjust', id, format('Low engagement: "%s"', name),
         format('%s of %s recipients (%s%%) replied or moved forward within 14 days. Rework the audience or message before sending to a similar group.', engaged, targeted, round(100.0 * engaged / greatest(targeted, 1), 1)),
         jsonb_build_object('targeted', targeted, 'engaged', engaged, 'rate', round(1.0 * engaged / greatest(targeted, 1), 4)), 'under:' || id
    from _camp where targeted >= 20 and engaged::numeric / greatest(targeted, 1) < 0.02
  on conflict (dedupe_key) do nothing;
  get diagnostics c = row_count; n := n + c;

  insert into public.marketing_recommendations (kind, action, campaign_id, title, detail, metrics, dedupe_key)
  select 'high_cost', 'adjust', id, format('High cost per engaged lead: "%s"', name),
         format('$%s spent for %s engaged lead%s ($%s each) and %s customer%s.', round(spend), engaged, case when engaged = 1 then '' else 's' end, round(spend / greatest(engaged, 1)), customers, case when customers = 1 then '' else 's' end),
         jsonb_build_object('spend', spend, 'engaged', engaged, 'customers', customers), 'cost:' || id
    from _camp where spend >= 100 and spend / greatest(engaged, 1) > 250 and customers = 0
  on conflict (dedupe_key) do nothing;
  get diagnostics c = row_count; n := n + c;

  insert into public.marketing_recommendations (kind, action, campaign_id, title, detail, metrics, dedupe_key)
  select 'winning', 'increase', id, format('Working well: "%s"', name),
         format('%s customer%s from %s recipients%s. Consider more budget or a follow-up send to a similar audience.', customers, case when customers = 1 then '' else 's' end, targeted,
                case when spend > 0 then format(', $%s spend', round(spend)) else '' end),
         jsonb_build_object('customers', customers, 'targeted', targeted, 'spend', spend, 'budget', budget), 'win:' || id
    from _camp where customers >= 1 and (spend = 0 or spend / customers < 1500)
  on conflict (dedupe_key) do nothing;
  get diagnostics c = row_count; n := n + c;

  -- approved/scheduled campaigns whose audience is mostly unreachable → pause and review
  insert into public.marketing_recommendations (kind, action, campaign_id, title, detail, dedupe_key)
  select 'underperforming', 'pause', c.id, format('Check before sending: "%s"', c.name),
         'Scheduled campaign with no subject or message yet — pause it until it''s ready.', 'empty:' || c.id
    from public.marketing_campaigns c where c.status in ('approved', 'scheduled') and (coalesce(c.subject, '') = '' or coalesce(c.body, '') = '')
  on conflict (dedupe_key) do nothing;
  get diagnostics c = row_count; n := n + c;

  -- declining conversion (lead → registered, last 30 days vs the 30 before)
  insert into public.marketing_recommendations (kind, action, title, detail, metrics, dedupe_key)
  select 'declining', 'review', 'Registrations per new lead are falling',
         format('%s%% of last month''s new leads registered, down from %s%% the month before. Review targeting and the follow-up on new leads.', round(100 * cur, 1), round(100 * prev, 1)),
         jsonb_build_object('current', cur, 'previous', prev), 'decline:' || to_char(now(), 'IYYYIW')
    from (select
            (select count(*) filter (where registered_at is not null)::numeric / nullif(count(*), 0) from public.marketing_leads where created_at > now() - interval '30 days') cur,
            (select count(*) filter (where registered_at is not null)::numeric / nullif(count(*), 0) from public.marketing_leads where created_at between now() - interval '60 days' and now() - interval '30 days') prev) x
   where prev >= 0.05 and cur < prev * 0.7
  on conflict (dedupe_key) do nothing;
  get diagnostics c = row_count; n := n + c;

  -- opportunity: a county converting well with few open prospects
  insert into public.marketing_recommendations (kind, action, title, detail, metrics, dedupe_key)
  select 'opportunity', 'increase', format('Grow %s County', county),
         format('%s of %s leads there registered (%s%%) but only %s open prospects remain — prospect more commercial owners there.', reg, total, round(100.0 * reg / total), open_n),
         jsonb_build_object('county', county, 'leads', total, 'registered', reg, 'open', open_n), 'opp:' || county || ':' || to_char(now(), 'IYYYIW')
    from (select cty county, count(*) total, count(*) filter (where l.registered_at is not null) reg,
                 count(*) filter (where l.stage in ('new', 'researching', 'ready', 'contacted', 'interested')) open_n
            from public.marketing_leads l, unnest(l.counties) cty group by cty) x
   where total >= 5 and reg::numeric / total >= 0.3 and open_n < 5
  on conflict (dedupe_key) do nothing;
  get diagnostics c = row_count; n := n + c;

  -- team: someone overloaded or behind → suggest moving work to the least-loaded teammate
  with load as (
    select p.id, coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email) nm,
           (select count(*) from public.marketing_followups f left join public.marketing_leads l on l.id = f.lead_id
             where f.status in ('pending', 'draft') and coalesce(f.assigned_to, l.assigned_to) = p.id) open_n,
           (select count(*) from public.marketing_followups f left join public.marketing_leads l on l.id = f.lead_id
             where f.status = 'pending' and f.due_at < now() - interval '1 day' and coalesce(f.assigned_to, l.assigned_to) = p.id) overdue
    from public.profiles p where p.marketing_admin or p.is_admin
  ), best as (
    -- the marketing team first; Super Admins only when there is no one else
    select l.id, l.nm, l.open_n from load l join public.profiles p on p.id = l.id
     order by (p.marketing_admin and not coalesce(p.is_admin, false)) desc, l.open_n, l.overdue limit 1)
  insert into public.marketing_recommendations (kind, action, staff_id, target_staff_id, title, detail, metrics, dedupe_key)
  select 'reassign', 'reassign', l.id, b.id, format('Reassign work from %s to %s', l.nm, b.nm),
         format('%s has %s overdue follow-up%s and %s open. %s has %s open.', l.nm, l.overdue, case when l.overdue = 1 then '' else 's' end, l.open_n, b.nm, b.open_n),
         jsonb_build_object('overdue', l.overdue, 'open', l.open_n, 'targetOpen', b.open_n), 'reassign:' || l.id || ':' || to_char(now(), 'IYYYIW')
    from load l, best b
   where l.id <> b.id and l.overdue >= 5 and l.open_n > b.open_n + 3
  on conflict (dedupe_key) do nothing;
  get diagnostics c = row_count; n := n + c;

  -- tell the team (supervisors get reassignment ideas)
  insert into public.marketing_notifications (staff_id, kind, title, detail, dedupe_key)
  select p.id, 'recommendation', 'Corvus AI recommendation: ' || r.title, coalesce(r.detail, '') || ' Approve or reject it in Analytics → Recommendations.', 'rec:' || r.id || ':' || p.id
    from public.marketing_recommendations r
    join public.profiles p on (p.marketing_admin or p.is_admin) and (r.kind <> 'reassign' or p.is_admin or p.marketing_supervisor)
   where r.status = 'pending' and r.created_at > now() - interval '2 hours'
  on conflict (dedupe_key) do nothing;

  -- supervisors: uncontacted high-value leads and delayed follow-ups across the team
  insert into public.marketing_notifications (staff_id, lead_id, kind, title, detail, dedupe_key)
  select p.id, l.id, 'team', 'Not contacted yet: ' || coalesce(l.company, l.full_name, l.email, 'lead'),
         format('%s-property portfolio, assigned to %s %s days ago with no outreach.', l.portfolio_count,
                coalesce((select coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), email) from public.profiles where id = l.assigned_to), 'nobody'),
                extract(day from now() - l.updated_at)::int),
         'team-uncontacted:' || l.id || ':' || p.id || ':' || to_char(now(), 'IYYYIW')
    from public.marketing_leads l
    join public.profiles p on p.is_admin or (p.marketing_admin and p.marketing_supervisor)
   where l.stage = 'ready' and coalesce(l.portfolio_value, 0) >= 2000000 and l.updated_at < now() - interval '5 days'
     and not exists (select 1 from public.marketing_activities a where a.lead_id = l.id and a.kind in ('email', 'sms', 'call', 'meeting'))
  on conflict (dedupe_key) do nothing;
  insert into public.marketing_notifications (staff_id, lead_id, kind, title, detail, dedupe_key)
  select p.id, f.lead_id, 'team', 'Follow-up delayed 3+ days: ' || coalesce(l.company, l.full_name, l.email, 'lead'),
         format('%s "%s" for %s.', initcap(f.channel), coalesce(f.subject, 'follow-up'),
                coalesce((select coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), email) from public.profiles where id = coalesce(f.assigned_to, l.assigned_to)), 'nobody')),
         'team-delayed:' || f.id || ':' || p.id
    from public.marketing_followups f join public.marketing_leads l on l.id = f.lead_id
    join public.profiles p on p.is_admin or (p.marketing_admin and p.marketing_supervisor)
   where f.status = 'pending' and f.due_at < now() - interval '3 days'
  on conflict (dedupe_key) do nothing;
  return n;
end; $$;
revoke all on function public.marketing_analyze() from public, anon, authenticated;
grant execute on function public.marketing_analyze() to service_role;
