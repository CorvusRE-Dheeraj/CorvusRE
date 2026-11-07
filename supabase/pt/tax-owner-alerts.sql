-- Proactive rule-change alerts for property owners (2026-11-06). Applied live.
--
-- The daily Regulatory Watch (generate-tax-updates → tax_update_alerts) finds
-- material Texas rule changes from official sources but only told staff. Now
-- the tax-owner-alerts edge function turns each change into ONE owner-facing
-- alert (several staff alerts about the same change — same source, area and
-- effective date — are grouped), written in plain language from the staff
-- alert's verified fields only (never the internal CorvusPT notes), and sends
-- it to the owners whose properties it applies to (statewide → everyone with a
-- property; county-specific → owners with property in that county), naming
-- their affected properties and flagging an open case the change touches.
--
-- Review gate: by default a staff member approves each alert before owners get
-- it (app_settings.tax_owner_alerts_auto = false). A Super Admin can switch it
-- to automatic. Every alert is always in the app (Texas Tax Updates + the
-- bell); email follows notification_prefs.tax_rule_alerts_email (default on).

alter table public.app_settings add column if not exists tax_owner_alerts_auto boolean not null default false;

create table if not exists public.tax_owner_alerts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  group_key text not null unique,
  alert_ids uuid[] not null,
  area text not null,
  title text not null,
  summary text not null,              -- one or two plain sentences
  what_changed text not null,
  effective_date text,
  why_it_matters text,
  recommended_action text,
  counties text[] not null default '{}',
  -- protest statuses this change matters to right now (open cases get flagged)
  relevant_statuses text[] not null default '{}',
  source_name text not null,
  source_url text not null,
  quote text not null,
  status text not null default 'pending_review' check (status in ('pending_review', 'approved', 'sent', 'skipped')),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  sent_at timestamptz,
  recipients integer not null default 0,
  emails_sent integer not null default 0
);
create index if not exists tax_owner_alerts_status_idx on public.tax_owner_alerts (status, created_at desc);
alter table public.tax_owner_alerts enable row level security;
drop policy if exists "Staff read owner alerts" on public.tax_owner_alerts;
create policy "Staff read owner alerts" on public.tax_owner_alerts for select to authenticated using ((select public.is_staff()));
revoke all on public.tax_owner_alerts from anon, authenticated;
grant select on public.tax_owner_alerts to authenticated;

create table if not exists public.tax_owner_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  alert_id uuid not null references public.tax_owner_alerts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- [{id, address, cad, openCase, caseStatus}]
  properties jsonb not null default '[]',
  affects_open_case boolean not null default false,
  email_sent_at timestamptz,
  email_error text,
  read_at timestamptz,
  unique (alert_id, user_id)
);
create index if not exists tax_owner_alert_deliveries_user_idx on public.tax_owner_alert_deliveries (user_id, created_at desc);
alter table public.tax_owner_alert_deliveries enable row level security;
drop policy if exists "Owners read their rule alerts" on public.tax_owner_alert_deliveries;
create policy "Owners read their rule alerts" on public.tax_owner_alert_deliveries for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.tax_owner_alert_deliveries from anon, authenticated;
grant select on public.tax_owner_alert_deliveries to authenticated;

-- Who an alert goes to, and which of their properties it touches. A county
-- list matches the property's appraisal district county; empty = statewide.
create or replace function public.tax_owner_alert_recipients(p_alert uuid)
returns table (user_id uuid, properties jsonb, affects_open_case boolean)
language sql stable security definer set search_path = public as $$
  with a as (select * from public.tax_owner_alerts where id = p_alert),
  props as (
    select p.user_id, p.id, p.address, p.cad,
      (select pt.status from public.protests pt where pt.property_id = p.id order by pt.updated_at desc limit 1) case_status
    from public.properties p, a
    where coalesce(p.verification_status, 'pending') <> 'test'
      and (cardinality(a.counties) = 0 or exists (
        select 1 from unnest(a.counties) c
        where lower(trim(regexp_replace(coalesce(p.cad, ''), '\s*(central\s+)?appraisal\s+district\s*$', '', 'i'))) = lower(trim(regexp_replace(c, '\s*county\s*$', '', 'i')))))
  )
  select pr.user_id,
    jsonb_agg(jsonb_build_object('id', pr.id, 'address', pr.address, 'cad', pr.cad, 'caseStatus', pr.case_status,
      'openCase', pr.case_status = any (a.relevant_statuses)) order by pr.address),
    bool_or(pr.case_status = any (a.relevant_statuses))
  from props pr cross join a
  join public.profiles u on u.id = pr.user_id
  where not (u.is_admin or u.marketing_admin or u.support_admin or u.operations_admin or coalesce(u.bd_admin, false))
  group by pr.user_id;
$$;
revoke all on function public.tax_owner_alert_recipients(uuid) from public, anon, authenticated;

-- The owner's own alerts, newest first (Texas Tax Updates + the bell).
create or replace function public.my_tax_rule_alerts() returns table (
  delivery_id uuid, alert_id uuid, created_at timestamptz, read_at timestamptz, title text, summary text, what_changed text,
  effective_date text, why_it_matters text, recommended_action text, area text, counties text[],
  source_name text, source_url text, quote text, properties jsonb, affects_open_case boolean
) language sql stable security definer set search_path = public as $$
  select d.id, a.id, d.created_at, d.read_at, a.title, a.summary, a.what_changed, a.effective_date, a.why_it_matters,
    a.recommended_action, a.area, a.counties, a.source_name, a.source_url, a.quote, d.properties, d.affects_open_case
  from public.tax_owner_alert_deliveries d join public.tax_owner_alerts a on a.id = d.alert_id
  where d.user_id = auth.uid()
  order by d.created_at desc limit 50;
$$;
revoke all on function public.my_tax_rule_alerts() from public, anon;
grant execute on function public.my_tax_rule_alerts() to authenticated;

create or replace function public.mark_tax_rule_alerts_read(p_ids uuid[]) returns void
language sql security definer set search_path = public as $$
  update public.tax_owner_alert_deliveries set read_at = now()
  where user_id = auth.uid() and id = any (p_ids) and read_at is null;
$$;
revoke all on function public.mark_tax_rule_alerts_read(uuid[]) from public, anon;
grant execute on function public.mark_tax_rule_alerts_read(uuid[]) to authenticated;

-- staff: approve (then the function sends it) or skip, with a note
create or replace function public.review_tax_owner_alert(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'not authorized' using errcode = '42501'; end if;
  update public.tax_owner_alerts
     set status = case when p_approve then 'approved' else 'skipped' end,
         reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_id and status = 'pending_review';
  if not found then raise exception 'That alert has already been reviewed'; end if;
  perform public.log_record_event('shared', 'tax_rule_alert', p_id,
    case when p_approve then 'owner_alert_approved' else 'owner_alert_skipped' end,
    format('%s owner alert: %s', case when p_approve then 'Approved' else 'Skipped' end, (select title from public.tax_owner_alerts where id = p_id)));
end; $$;
revoke all on function public.review_tax_owner_alert(uuid, boolean, text) from public, anon;
grant execute on function public.review_tax_owner_alert(uuid, boolean, text) to authenticated;
