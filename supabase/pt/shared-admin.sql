-- Shared admin requirements (2026-10-22): one set of records across the
-- Marketing, Customer Support and Operations dashboards, one responsible
-- owner for every work item, handoffs that carry their context and must be
-- accepted, Super-Admin approvals for sensitive actions, and a history of who
-- changed what (with the approval used).
--
--   staff_routing          per-department default owner (Super Admin sets it)
--   record_events          the shared, append-only history (what / who / when /
--                          before → after / approval), visible per department
--   record_transfers       ownership handoffs: reason, history snapshot,
--                          pending actions, receiver, accepted / declined
--   approval_requests      pricing exceptions, refunds, agreement changes,
--                          automation permissions, access changes — requested by
--                          staff or AI, decided and executed by a Super Admin
--                          (executed by the staff-approvals edge function)
--   automation_permissions which marketing automations may run
--   pricing_exceptions     approved discounts, applied at checkout
--
-- Owners: leads, follow-ups and onboarding already had assigned_to; support
-- tickets (support_escalations.assigned_to) and protest cases (protests.owner_id)
-- get one. New items are auto-assigned to the least-busy dedicated member of
-- the department, else the department's default owner.

-- columns first: the functions below are checked against them
alter table public.support_escalations add column if not exists assigned_to uuid references public.profiles(id) on delete set null;
alter table public.protests add column if not exists owner_id uuid references public.profiles(id) on delete set null;

-- ── departments ───────────────────────────────────────────────────────────
create or replace function public.in_department(uid uuid, dept text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case dept
      when 'marketing'   then p.is_admin or p.marketing_admin
      when 'support'     then p.is_admin or p.support_admin
      when 'operations'  then p.is_admin or p.operations_admin
      when 'super_admin' then p.is_admin
      else false end
    from public.profiles p where p.id = uid), false);
$$;
revoke all on function public.in_department(uuid, text) from public, anon;
grant execute on function public.in_department(uuid, text) to authenticated;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin or p.marketing_admin or p.support_admin or p.operations_admin
                   from public.profiles p where p.id = auth.uid()), false);
$$;
revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;

create table if not exists public.staff_routing (
  department text primary key check (department in ('marketing', 'support', 'operations')),
  default_owner uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.staff_routing (department) values ('marketing'), ('support'), ('operations')
on conflict do nothing;
alter table public.staff_routing enable row level security;
drop policy if exists "Staff read routing" on public.staff_routing;
create policy "Staff read routing" on public.staff_routing for select to authenticated using ((select public.is_staff()));
revoke all on public.staff_routing from anon, authenticated;
grant select on public.staff_routing to authenticated;

-- staff list per department (for owner pickers) — names and emails only
create or replace function public.staff_directory(p_department text default null)
returns table (id uuid, name text, email text, departments text[], is_super_admin boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'not authorized' using errcode = '42501'; end if;
  return query
    select p.id,
           coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email),
           p.email,
           array_remove(array[
             case when p.marketing_admin then 'marketing' end,
             case when p.support_admin then 'support' end,
             case when p.operations_admin then 'operations' end], null),
           coalesce(p.is_admin, false)
    from public.profiles p
    where (p.is_admin or p.marketing_admin or p.support_admin or p.operations_admin)
      and (p_department is null or public.in_department(p.id, p_department))
    order by p.is_admin, 2;
end; $$;
revoke all on function public.staff_directory(text) from public, anon;
grant execute on function public.staff_directory(text) to authenticated;

-- Least-busy dedicated member of a department (Super Admins only by default
-- routing), so new work always lands with one person.
create or replace function public.pick_owner(p_department text) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.id from public.profiles p
      where not p.is_admin and case p_department
        when 'marketing' then p.marketing_admin
        when 'support' then p.support_admin
        when 'operations' then p.operations_admin else false end
      order by case p_department
        when 'marketing' then (select count(*) from public.marketing_followups f where f.assigned_to = p.id and f.status in ('pending', 'draft'))
                            + (select count(*) from public.marketing_leads l where l.assigned_to = p.id and l.subscribed_at is null)
        when 'support' then (select count(*) from public.support_escalations e where e.assigned_to = p.id and e.status <> 'resolved')
                          + (select count(*) from public.support_handoffs h where h.assigned_to = p.id and h.status <> 'done')
        when 'operations' then (select count(*) from public.protests c where c.owner_id = p.id and c.status <> 'resolved')
        else 0 end, p.created_at
      limit 1),
    (select r.default_owner from public.staff_routing r where r.department = p_department));
$$;
revoke all on function public.pick_owner(text) from public, anon;

-- ── shared history ────────────────────────────────────────────────────────
create table if not exists public.record_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  department text not null check (department in ('marketing', 'support', 'operations', 'super_admin', 'shared')),
  entity_type text not null,
  entity_id uuid,
  profile_id uuid,
  lead_id uuid,
  property_id uuid,
  protest_id uuid,
  actor_id uuid,
  actor_label text,
  action text not null,
  summary text not null,
  before jsonb,
  after jsonb,
  approval_id uuid
);
create index if not exists record_events_profile_idx on public.record_events (profile_id, created_at desc);
create index if not exists record_events_lead_idx on public.record_events (lead_id, created_at desc);
create index if not exists record_events_entity_idx on public.record_events (entity_type, entity_id, created_at desc);
create index if not exists record_events_created_idx on public.record_events (created_at desc);
alter table public.record_events enable row level security;
drop policy if exists "Departments read their history" on public.record_events;
create policy "Departments read their history" on public.record_events for select to authenticated using (
  (select public.is_admin())
  or (department = 'marketing' and (select public.is_marketing_admin()))
  or (department = 'support' and (select public.is_support_admin()))
  or (department = 'operations' and (select public.is_operations_admin()))
  or (department = 'shared' and (select public.is_staff()))
);
-- append-only: written by triggers / definer functions, never edited
revoke all on public.record_events from anon, authenticated;
grant select on public.record_events to authenticated;

create or replace function public.actor_label(uid uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when uid is null then 'System'
    else coalesce((select coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email)
                   from public.profiles p where p.id = uid), 'Staff') end;
$$;
revoke all on function public.actor_label(uuid) from public, anon;

-- an owner field: "nobody" when empty (actor_label says "System" for the actor)
create or replace function public.owner_label(uid uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when uid is null then 'nobody' else public.actor_label(uid) end;
$$;
revoke all on function public.owner_label(uuid) from public, anon;

create or replace function public.log_record_event(
  p_department text, p_entity_type text, p_entity_id uuid, p_action text, p_summary text,
  p_profile uuid default null, p_lead uuid default null, p_property uuid default null, p_protest uuid default null,
  p_before jsonb default null, p_after jsonb default null, p_approval uuid default null, p_actor uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_actor uuid := coalesce(p_actor, auth.uid());
begin
  insert into public.record_events (department, entity_type, entity_id, profile_id, lead_id, property_id, protest_id,
                                    actor_id, actor_label, action, summary, before, after, approval_id)
  values (p_department, p_entity_type, p_entity_id, p_profile, p_lead, p_property, p_protest,
          v_actor, public.actor_label(v_actor), p_action, p_summary, p_before, p_after, p_approval)
  returning id into v_id;
  return v_id;
end; $$;
revoke all on function public.log_record_event(text, text, uuid, text, text, uuid, uuid, uuid, uuid, jsonb, jsonb, uuid, uuid) from public, anon, authenticated;

-- ── owners on every work item ─────────────────────────────────────────────
alter table public.support_escalations add column if not exists assigned_to uuid references public.profiles(id) on delete set null;
alter table public.support_escalations add column if not exists updated_at timestamptz not null default now();
alter table public.support_escalations add column if not exists resolved_at timestamptz;
alter table public.protests add column if not exists owner_id uuid references public.profiles(id) on delete set null;
-- outreach coordination: paused while a lead is being handed off
alter table public.marketing_leads add column if not exists outreach_paused_at timestamptz;
alter table public.marketing_leads add column if not exists outreach_paused_reason text;
-- source attribution survives the lead → customer conversion
alter table public.profiles add column if not exists lead_source text;
alter table public.profiles add column if not exists converted_from_lead uuid;
alter table public.profiles add column if not exists converted_at timestamptz;

create or replace function public.assign_owner_on_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'support_escalations' then
    new.assigned_to := coalesce(new.assigned_to, public.pick_owner('support'));
  elsif tg_table_name = 'support_handoffs' then
    new.assigned_to := coalesce(new.assigned_to, public.pick_owner('support'));
  elsif tg_table_name = 'protests' then
    new.owner_id := coalesce(new.owner_id, public.pick_owner('operations'));
    -- every case is tied to its property AND tax year
    if new.tax_year is null then
      new.tax_year := coalesce((select pr.tax_year from public.properties pr where pr.id = new.property_id),
                               extract(year from now())::int);
    end if;
  elsif tg_table_name = 'marketing_leads' then
    new.assigned_to := coalesce(new.assigned_to, public.pick_owner('marketing'));
  elsif tg_table_name = 'marketing_followups' then
    new.assigned_to := coalesce(new.assigned_to,
      (select l.assigned_to from public.marketing_leads l where l.id = new.lead_id),
      public.pick_owner('marketing'));
  end if;
  return new;
end; $$;

drop trigger if exists assign_owner on public.support_escalations;
create trigger assign_owner before insert on public.support_escalations for each row execute function public.assign_owner_on_insert();
drop trigger if exists assign_owner on public.support_handoffs;
create trigger assign_owner before insert on public.support_handoffs for each row execute function public.assign_owner_on_insert();
drop trigger if exists assign_owner on public.protests;
create trigger assign_owner before insert on public.protests for each row execute function public.assign_owner_on_insert();
drop trigger if exists assign_owner on public.marketing_leads;
create trigger assign_owner before insert on public.marketing_leads for each row execute function public.assign_owner_on_insert();
drop trigger if exists assign_owner on public.marketing_followups;
create trigger assign_owner before insert on public.marketing_followups for each row execute function public.assign_owner_on_insert();

drop trigger if exists support_escalations_touch on public.support_escalations;
create trigger support_escalations_touch before update on public.support_escalations for each row execute function public.touch_updated_at();

-- Owners can see and work the items handed to them even from another team
-- (e.g. a support ticket transferred to Operations).
drop policy if exists "Owners read their escalations" on public.support_escalations;
create policy "Owners read their escalations" on public.support_escalations for select to authenticated using (assigned_to = (select auth.uid()));
drop policy if exists "Owners update their escalations" on public.support_escalations;
create policy "Owners update their escalations" on public.support_escalations for update to authenticated
  using (assigned_to = (select auth.uid()) and (select public.is_staff())) with check ((select public.is_staff()));

-- ── history triggers ──────────────────────────────────────────────────────
create or replace function public.history_on_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_addr text;
begin
  if tg_table_name = 'marketing_leads' then
    if tg_op = 'UPDATE' and new.assigned_to is distinct from old.assigned_to then
      perform public.log_record_event('marketing', 'lead', new.id, 'owner_changed',
        format('Owner: %s → %s', public.owner_label(old.assigned_to), public.owner_label(new.assigned_to)),
        new.profile_id, new.id, null, null,
        jsonb_build_object('assigned_to', old.assigned_to), jsonb_build_object('assigned_to', new.assigned_to));
    end if;
    if tg_op = 'UPDATE' and new.stage is distinct from old.stage then
      perform public.log_record_event('marketing', 'lead', new.id, 'stage_changed',
        format('Stage: %s → %s', coalesce(old.stage, '—'), coalesce(new.stage, '—')),
        new.profile_id, new.id, null, null,
        jsonb_build_object('stage', old.stage), jsonb_build_object('stage', new.stage));
    end if;
    if tg_op = 'UPDATE' and new.subscribed_at is not null and old.subscribed_at is null then
      perform public.log_record_event('shared', 'lead', new.id, 'became_customer',
        format('Became a paying customer (source: %s)', coalesce(new.source, 'unknown')),
        new.profile_id, new.id);
    end if;
    -- keep the source on the customer record once the lead is linked to an account
    if new.profile_id is not null and (tg_op = 'INSERT' or old.profile_id is distinct from new.profile_id) then
      update public.profiles set
        lead_source = coalesce(lead_source, new.source),
        converted_from_lead = coalesce(converted_from_lead, new.id),
        converted_at = coalesce(converted_at, now())
      where id = new.profile_id;
    end if;
  elsif tg_table_name = 'support_escalations' then
    if tg_op = 'INSERT' then
      perform public.log_record_event('support', 'escalation', new.id, 'ticket_opened',
        format('Support ticket opened (%s) — owner %s', new.contact_method, public.owner_label(new.assigned_to)),
        new.user_id, null, null, null, null, jsonb_build_object('status', new.status, 'assigned_to', new.assigned_to), null, new.user_id);
    else
      if new.status is distinct from old.status then
        if new.status = 'resolved' and new.resolved_at is null then new.resolved_at := now(); end if;
        perform public.log_record_event('support', 'escalation', new.id, 'status_changed',
          format('Ticket: %s → %s', old.status, new.status), new.user_id, null, null, null,
          jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
      end if;
      if new.assigned_to is distinct from old.assigned_to then
        perform public.log_record_event('support', 'escalation', new.id, 'owner_changed',
          format('Ticket owner: %s → %s', public.owner_label(old.assigned_to), public.owner_label(new.assigned_to)),
          new.user_id, null, null, null,
          jsonb_build_object('assigned_to', old.assigned_to), jsonb_build_object('assigned_to', new.assigned_to));
      end if;
    end if;
  elsif tg_table_name = 'support_handoffs' then
    if tg_op = 'INSERT' then
      perform public.log_record_event('shared', 'onboarding', new.id, 'handed_to_support',
        format('Handed from Marketing to Customer Support — owner %s', public.owner_label(new.assigned_to)),
        new.profile_id, new.lead_id);
    else
      if new.status is distinct from old.status then
        perform public.log_record_event('support', 'onboarding', new.id, 'status_changed',
          format('Onboarding: %s → %s', old.status, new.status), new.profile_id, new.lead_id, null, null,
          jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
      end if;
      if new.assigned_to is distinct from old.assigned_to then
        perform public.log_record_event('support', 'onboarding', new.id, 'owner_changed',
          format('Onboarding owner: %s → %s', public.owner_label(old.assigned_to), public.owner_label(new.assigned_to)),
          new.profile_id, new.lead_id, null, null,
          jsonb_build_object('assigned_to', old.assigned_to), jsonb_build_object('assigned_to', new.assigned_to));
      end if;
    end if;
  elsif tg_table_name = 'protests' then
    select address into v_addr from public.properties where id = new.property_id;
    if tg_op = 'INSERT' then
      perform public.log_record_event('shared', 'case', new.id, 'case_opened',
        format('Protest case opened — %s, tax year %s — owner %s', coalesce(v_addr, 'BPP account'), new.tax_year, public.owner_label(new.owner_id)),
        new.user_id, null, new.property_id, new.id);
    else
      if new.status is distinct from old.status then
        perform public.log_record_event('operations', 'case', new.id, 'status_changed',
          format('Case %s (%s): %s → %s', coalesce(v_addr, 'BPP'), new.tax_year, old.status, new.status),
          new.user_id, null, new.property_id, new.id,
          jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
      end if;
      if new.owner_id is distinct from old.owner_id then
        perform public.log_record_event('operations', 'case', new.id, 'owner_changed',
          format('Case owner: %s → %s', public.owner_label(old.owner_id), public.owner_label(new.owner_id)),
          new.user_id, null, new.property_id, new.id,
          jsonb_build_object('owner_id', old.owner_id), jsonb_build_object('owner_id', new.owner_id));
      end if;
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists record_history on public.marketing_leads;
create trigger record_history after insert or update on public.marketing_leads for each row execute function public.history_on_change();
drop trigger if exists record_history on public.support_handoffs;
create trigger record_history after insert or update on public.support_handoffs for each row execute function public.history_on_change();
drop trigger if exists record_history on public.protests;
create trigger record_history after insert or update on public.protests for each row execute function public.history_on_change();
-- escalations: BEFORE so resolved_at can be stamped in the same row
drop trigger if exists record_history_ins on public.support_escalations;
create trigger record_history_ins after insert on public.support_escalations for each row execute function public.history_on_change();
drop trigger if exists record_history_upd on public.support_escalations;
create trigger record_history_upd before update on public.support_escalations for each row execute function public.history_on_change();

-- ── staff notifications (any department, not only Marketing) ──────────────
alter table public.marketing_notifications add column if not exists entity_type text;
alter table public.marketing_notifications add column if not exists entity_id uuid;
drop policy if exists "Staff read own notifications" on public.marketing_notifications;
create policy "Staff read own notifications" on public.marketing_notifications for select to authenticated using (staff_id = (select auth.uid()));
drop policy if exists "Staff mark own notifications read" on public.marketing_notifications;
create policy "Staff mark own notifications read" on public.marketing_notifications for update to authenticated
  using (staff_id = (select auth.uid())) with check (staff_id = (select auth.uid()));

create or replace function public.notify_department(p_department text, p_owner uuid, p_kind text, p_title text,
  p_detail text, p_entity_type text, p_entity_id uuid, p_lead uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.marketing_notifications (staff_id, lead_id, kind, title, detail, entity_type, entity_id, dedupe_key)
  select s.id, p_lead, p_kind, p_title, p_detail, p_entity_type, p_entity_id,
         p_kind || ':' || coalesce(p_entity_id::text, '') || ':' || s.id || ':' || extract(epoch from now())::bigint
  from public.profiles s
  where case when p_owner is not null then s.id = p_owner
             else (not s.is_admin and public.in_department(s.id, p_department)) end
  union
  -- nobody dedicated in the department yet → the Super Admins
  select s.id, p_lead, p_kind, p_title, p_detail, p_entity_type, p_entity_id,
         p_kind || ':' || coalesce(p_entity_id::text, '') || ':' || s.id || ':' || extract(epoch from now())::bigint
  from public.profiles s
  where p_owner is null and s.is_admin
    and not exists (select 1 from public.profiles d where not d.is_admin and public.in_department(d.id, p_department))
  on conflict do nothing;
end; $$;
revoke all on function public.notify_department(text, uuid, text, text, text, text, uuid, uuid) from public, anon, authenticated;

-- ── handoffs between owners / departments ─────────────────────────────────
create table if not exists public.record_transfers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  entity_type text not null check (entity_type in ('lead', 'followup', 'onboarding', 'escalation', 'case')),
  entity_id uuid not null,
  entity_label text,
  lead_id uuid,
  profile_id uuid,
  from_department text not null,
  to_department text not null check (to_department in ('marketing', 'support', 'operations')),
  from_owner uuid,
  to_owner uuid,
  reason text not null check (length(trim(reason)) >= 5),
  history jsonb not null default '[]',
  pending_actions jsonb not null default '[]',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  requested_by uuid not null,
  responded_by uuid,
  responded_at timestamptz,
  response_note text,
  paused_outreach boolean not null default false
);
create unique index if not exists record_transfers_one_pending on public.record_transfers (entity_type, entity_id) where status = 'pending';
create index if not exists record_transfers_to_idx on public.record_transfers (to_department, status, created_at desc);
alter table public.record_transfers enable row level security;
drop policy if exists "Departments read their handoffs" on public.record_transfers;
create policy "Departments read their handoffs" on public.record_transfers for select to authenticated using (
  (select public.is_admin())
  or requested_by = (select auth.uid()) or to_owner = (select auth.uid()) or from_owner = (select auth.uid())
  or public.in_department((select auth.uid()), to_department)
  or public.in_department((select auth.uid()), from_department)
);
revoke all on public.record_transfers from anon, authenticated;
grant select on public.record_transfers to authenticated;

create or replace function public.entity_department(p_type text) returns text
language sql immutable as $$
  select case p_type when 'lead' then 'marketing' when 'followup' then 'marketing'
                     when 'onboarding' then 'support' when 'escalation' then 'support'
                     when 'case' then 'operations' end;
$$;

-- which departments an item may be handed to
create or replace function public.transfer_allowed(p_type text, p_to text) returns boolean
language sql immutable as $$
  select case p_type
    when 'lead' then p_to in ('marketing', 'support')
    when 'followup' then p_to = 'marketing'
    when 'onboarding' then p_to in ('support', 'marketing')
    when 'escalation' then p_to in ('support', 'operations')
    when 'case' then p_to = 'operations'
    else false end;
$$;

create or replace function public.request_transfer(p_entity_type text, p_entity_id uuid, p_to_department text,
  p_to_owner uuid, p_reason text, p_pending text[] default '{}') returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_from_dept text := public.entity_department(p_entity_type);
  v_owner uuid; v_lead uuid; v_profile uuid; v_label text; v_id uuid;
  v_history jsonb; v_pending jsonb := '[]'; v_pause boolean := false;
begin
  if v_from_dept is null then raise exception 'Unknown item type'; end if;
  if not (public.is_admin() or public.in_department(auth.uid(), v_from_dept)) then
    -- owners in other teams may pass back what was handed to them
    if not (p_entity_type = 'escalation' and exists (select 1 from public.support_escalations e where e.id = p_entity_id and e.assigned_to = auth.uid())) then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  end if;
  if not public.transfer_allowed(p_entity_type, p_to_department) then
    raise exception 'This item can''t be handed to %', p_to_department;
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then raise exception 'Give a reason for the handoff'; end if;
  if p_to_owner is not null and not public.in_department(p_to_owner, p_to_department) then
    raise exception 'The receiving person isn''t in %', p_to_department;
  end if;

  if p_entity_type = 'lead' then
    select l.assigned_to, l.id, l.profile_id, coalesce(nullif(l.company, ''), l.full_name, l.email)
      into v_owner, v_lead, v_profile, v_label from public.marketing_leads l where l.id = p_entity_id;
  elsif p_entity_type = 'followup' then
    select f.assigned_to, f.lead_id, l.profile_id, coalesce(f.subject, f.channel) || ' — ' || coalesce(nullif(l.company, ''), l.full_name, l.email)
      into v_owner, v_lead, v_profile, v_label
      from public.marketing_followups f left join public.marketing_leads l on l.id = f.lead_id where f.id = p_entity_id;
  elsif p_entity_type = 'onboarding' then
    select h.assigned_to, h.lead_id, h.profile_id, coalesce(nullif(l.company, ''), l.full_name, l.email)
      into v_owner, v_lead, v_profile, v_label
      from public.support_handoffs h left join public.marketing_leads l on l.id = h.lead_id where h.id = p_entity_id;
  elsif p_entity_type = 'escalation' then
    select e.assigned_to, e.user_id, left(e.summary, 80) into v_owner, v_profile, v_label
      from public.support_escalations e where e.id = p_entity_id;
    select l.id into v_lead from public.marketing_leads l where l.profile_id = v_profile limit 1;
  elsif p_entity_type = 'case' then
    select c.owner_id, c.user_id, coalesce(pr.address, 'BPP case') || ' (' || c.tax_year || ')' into v_owner, v_profile, v_label
      from public.protests c left join public.properties pr on pr.id = c.property_id where c.id = p_entity_id;
    select l.id into v_lead from public.marketing_leads l where l.profile_id = v_profile limit 1;
  end if;
  if v_label is null and v_profile is null and v_lead is null then raise exception 'Item not found'; end if;

  -- relevant history (newest first): shared events + marketing activity
  select coalesce(jsonb_agg(x order by x->>'at' desc), '[]') into v_history from (
    select jsonb_build_object('at', ev.created_at, 'by', ev.actor_label, 'what', ev.summary) x
      from public.record_events ev
     where (v_lead is not null and ev.lead_id = v_lead) or (v_profile is not null and ev.profile_id = v_profile)
        or (ev.entity_id = p_entity_id)
     order by ev.created_at desc limit 12) h1;
  if v_lead is not null then
    select v_history || coalesce(jsonb_agg(jsonb_build_object('at', a.created_at, 'by', public.actor_label(a.created_by), 'what', a.kind || ': ' || a.summary) order by a.created_at desc), '[]')
      into v_history from (select * from public.marketing_activities where lead_id = v_lead order by created_at desc limit 8) a;
  end if;

  -- what's still open
  if v_lead is not null then
    select coalesce(jsonb_agg(jsonb_build_object('kind', 'follow-up', 'what', f.channel || ': ' || coalesce(f.subject, left(f.message, 60)), 'due', f.due_at)), '[]')
      into v_pending from public.marketing_followups f where f.lead_id = v_lead and f.status in ('pending', 'draft');
  end if;
  if v_profile is not null then
    select v_pending || coalesce(jsonb_agg(jsonb_build_object('kind', 'support ticket', 'what', left(e.summary, 80), 'due', null)), '[]')
      into v_pending from public.support_escalations e where e.user_id = v_profile and e.status <> 'resolved' and e.id <> p_entity_id;
    select v_pending || coalesce(jsonb_agg(jsonb_build_object('kind', 'case', 'what', coalesce(pr.address, 'BPP') || ' — ' || c.status, 'due', pr.protest_deadline)), '[]')
      into v_pending from public.protests c left join public.properties pr on pr.id = c.property_id
     where c.user_id = v_profile and c.status <> 'resolved' and c.id <> p_entity_id;
  end if;
  select v_pending || coalesce(jsonb_agg(jsonb_build_object('kind', 'to do', 'what', t, 'due', null)), '[]')
    into v_pending from unnest(coalesce(p_pending, '{}')) t where length(trim(t)) > 0;

  -- coordinate outreach: Marketing stops writing to this customer while the
  -- handoff is open (and for good if Support / Operations takes it over)
  if v_lead is not null and p_entity_type in ('lead', 'followup', 'onboarding') then
    update public.marketing_leads set outreach_paused_at = now(),
      outreach_paused_reason = format('Handoff to %s pending', initcap(p_to_department))
    where id = v_lead and outreach_paused_at is null;
    v_pause := found;
  end if;

  insert into public.record_transfers (entity_type, entity_id, entity_label, lead_id, profile_id, from_department, to_department,
    from_owner, to_owner, reason, history, pending_actions, requested_by, paused_outreach)
  values (p_entity_type, p_entity_id, v_label, v_lead, v_profile, v_from_dept, p_to_department,
    v_owner, p_to_owner, trim(p_reason), v_history, v_pending, auth.uid(), v_pause)
  returning id into v_id;

  perform public.log_record_event(case when v_from_dept = p_to_department then v_from_dept else 'shared' end,
    p_entity_type, p_entity_id, 'handoff_requested',
    format('Handoff requested: %s → %s (%s). Reason: %s', initcap(v_from_dept),
      case when p_to_owner is null then initcap(p_to_department) || ' team' else public.actor_label(p_to_owner) end, coalesce(v_label, ''), trim(p_reason)),
    v_profile, v_lead, null, case when p_entity_type = 'case' then p_entity_id end,
    jsonb_build_object('owner', v_owner), jsonb_build_object('to_department', p_to_department, 'to_owner', p_to_owner, 'transfer_id', v_id));
  perform public.notify_department(p_to_department, p_to_owner, 'handoff',
    format('Handoff for you: %s', coalesce(v_label, p_entity_type)),
    format('From %s — %s', public.actor_label(auth.uid()), trim(p_reason)), 'transfer', v_id, v_lead);
  return v_id;
end; $$;
revoke all on function public.request_transfer(text, uuid, text, uuid, text, text[]) from public, anon;
grant execute on function public.request_transfer(text, uuid, text, uuid, text, text[]) to authenticated;

create or replace function public.respond_transfer(p_id uuid, p_accept boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare t public.record_transfers; v_new uuid;
begin
  select * into t from public.record_transfers where id = p_id for update;
  if not found then raise exception 'Handoff not found'; end if;
  if t.status <> 'pending' then raise exception 'This handoff was already %', t.status; end if;
  if not (public.is_admin()
          or (t.to_owner is not null and t.to_owner = auth.uid())
          or (t.to_owner is null and public.in_department(auth.uid(), t.to_department))) then
    raise exception 'Only the receiving owner or team can respond' using errcode = '42501';
  end if;
  if not p_accept and coalesce(length(trim(p_note)), 0) < 3 then raise exception 'Say why you''re declining'; end if;
  v_new := coalesce(t.to_owner, auth.uid());

  update public.record_transfers set status = case when p_accept then 'accepted' else 'declined' end,
    responded_by = auth.uid(), responded_at = now(), response_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_id;

  if p_accept then
    if t.entity_type = 'lead' and t.to_department = 'marketing' then
      update public.marketing_leads set assigned_to = v_new where id = t.entity_id;
      update public.marketing_followups set assigned_to = v_new where lead_id = t.entity_id and status in ('pending', 'draft');
    elsif t.entity_type = 'lead' and t.to_department = 'support' then
      -- Support takes the customer over: an onboarding item owned by the receiver
      if exists (select 1 from public.support_handoffs h where h.lead_id = t.entity_id) then
        update public.support_handoffs set assigned_to = v_new, status = case when status = 'done' then 'open' else status end
         where lead_id = t.entity_id;
      else
        insert into public.support_handoffs (lead_id, profile_id, assigned_to, snapshot, notes)
        values (t.entity_id, t.profile_id, v_new,
                case when t.profile_id is not null then public.marketing_customer_snapshot(t.profile_id) else '{}'::jsonb end,
                'From Marketing: ' || t.reason);
      end if;
      update public.marketing_followups set status = 'skipped', completed_at = now(),
        stop_reason = 'Handed off to Customer Support'
       where lead_id = t.entity_id and status in ('pending', 'draft');
    elsif t.entity_type = 'followup' then
      update public.marketing_followups set assigned_to = v_new where id = t.entity_id;
    elsif t.entity_type = 'onboarding' and t.to_department = 'support' then
      update public.support_handoffs set assigned_to = v_new where id = t.entity_id;
    elsif t.entity_type = 'onboarding' and t.to_department = 'marketing' then
      update public.marketing_leads set assigned_to = v_new where id = t.lead_id;
    elsif t.entity_type = 'escalation' then
      update public.support_escalations set assigned_to = v_new where id = t.entity_id;
    elsif t.entity_type = 'case' then
      update public.protests set owner_id = v_new where id = t.entity_id;
    end if;
    -- outreach resumes only when the customer stays with Marketing
    if t.paused_outreach and t.to_department = 'marketing' then
      update public.marketing_leads set outreach_paused_at = null, outreach_paused_reason = null where id = t.lead_id;
    elsif t.paused_outreach then
      update public.marketing_leads set outreach_paused_reason = format('With %s since %s', initcap(t.to_department), to_char(now(), 'Mon DD'))
       where id = t.lead_id;
    end if;
  elsif t.paused_outreach then
    update public.marketing_leads set outreach_paused_at = null, outreach_paused_reason = null where id = t.lead_id;
  end if;

  perform public.log_record_event(case when t.from_department = t.to_department then t.to_department else 'shared' end,
    t.entity_type, t.entity_id, case when p_accept then 'handoff_accepted' else 'handoff_declined' end,
    case when p_accept then format('Handoff accepted by %s (%s)', public.actor_label(auth.uid()), coalesce(t.entity_label, ''))
         else format('Handoff declined by %s (%s): %s', public.actor_label(auth.uid()), coalesce(t.entity_label, ''), trim(p_note)) end,
    t.profile_id, t.lead_id, null, case when t.entity_type = 'case' then t.entity_id end,
    jsonb_build_object('owner', t.from_owner), jsonb_build_object('owner', case when p_accept then v_new else t.from_owner end, 'transfer_id', t.id));
  perform public.notify_department(t.from_department, t.requested_by, 'handoff_' || case when p_accept then 'accepted' else 'declined' end,
    format('Handoff %s: %s', case when p_accept then 'accepted' else 'declined' end, coalesce(t.entity_label, t.entity_type)),
    format('%s %s it%s', public.actor_label(auth.uid()), case when p_accept then 'took' else 'declined' end,
           case when p_note is not null and length(trim(p_note)) > 0 then ' — ' || trim(p_note) else '' end),
    'transfer', t.id, t.lead_id);
end; $$;
revoke all on function public.respond_transfer(uuid, boolean, text) from public, anon;
grant execute on function public.respond_transfer(uuid, boolean, text) to authenticated;

create or replace function public.cancel_transfer(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.record_transfers;
begin
  select * into t from public.record_transfers where id = p_id for update;
  if not found or t.status <> 'pending' then raise exception 'Nothing to cancel'; end if;
  if not (public.is_admin() or t.requested_by = auth.uid()) then raise exception 'not authorized' using errcode = '42501'; end if;
  update public.record_transfers set status = 'cancelled', responded_by = auth.uid(), responded_at = now() where id = p_id;
  if t.paused_outreach then
    update public.marketing_leads set outreach_paused_at = null, outreach_paused_reason = null where id = t.lead_id;
  end if;
  perform public.log_record_event(case when t.from_department = t.to_department then t.to_department else 'shared' end,
    t.entity_type, t.entity_id, 'handoff_cancelled', format('Handoff cancelled (%s)', coalesce(t.entity_label, '')),
    t.profile_id, t.lead_id);
end; $$;
revoke all on function public.cancel_transfer(uuid) from public, anon;
grant execute on function public.cancel_transfer(uuid) to authenticated;

-- ── approvals ─────────────────────────────────────────────────────────────
create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('access_change', 'pricing_exception', 'refund', 'agreement_change', 'automation_permission')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'executed', 'failed', 'cancelled')),
  source text not null default 'staff' check (source in ('staff', 'ai')),
  department text,
  requested_by uuid not null,
  target_profile uuid,
  target_property uuid,
  title text not null,
  payload jsonb not null default '{}',
  reason text not null check (length(trim(reason)) >= 5),
  ai_rationale text,
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  executed_at timestamptz,
  result jsonb,
  error text
);
create index if not exists approval_requests_status_idx on public.approval_requests (status, created_at desc);
alter table public.approval_requests enable row level security;
drop policy if exists "Super Admins and requesters read approvals" on public.approval_requests;
create policy "Super Admins and requesters read approvals" on public.approval_requests for select to authenticated using (
  (select public.is_admin()) or requested_by = (select auth.uid())
);
-- created / decided / executed only by the staff-approvals edge function
revoke all on public.approval_requests from anon, authenticated;
grant select on public.approval_requests to authenticated;

alter table public.admin_audit_log add column if not exists approval_id uuid;
alter table public.admin_audit_log add column if not exists before jsonb;
alter table public.admin_audit_log add column if not exists after jsonb;

create table if not exists public.automation_permissions (
  key text primary key,
  label text not null,
  description text,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  approval_id uuid
);
insert into public.automation_permissions (key, label, description) values
  ('scheduled_campaigns', 'Scheduled & recurring campaigns', 'Send approved campaigns at their scheduled time and on their recurring cycle.'),
  ('auto_send_followups', 'Auto-send approved follow-up emails', 'Send follow-up emails marked auto-send when they fall due.'),
  ('campaign_engagement_rules', 'Campaign engagement rules', 'Create follow-ups from a campaign''s engagement rules (opened, clicked, no reply).'),
  ('ai_handoff_summaries', 'AI handoff summaries', 'Write the AI summary for each new Customer Support handoff.'),
  ('ai_recommendations', 'AI marketing recommendations', 'Analyse campaigns and the team and suggest actions (staff still approve each one).'),
  ('status_rules', 'Lead status rules', 'Move leads between stages by the approved status rules.')
on conflict (key) do nothing;
alter table public.automation_permissions enable row level security;
drop policy if exists "Staff read automation permissions" on public.automation_permissions;
create policy "Staff read automation permissions" on public.automation_permissions for select to authenticated using ((select public.is_staff()));
revoke all on public.automation_permissions from anon, authenticated;
grant select on public.automation_permissions to authenticated;

create table if not exists public.pricing_exceptions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  property_id uuid references public.properties(id) on delete cascade,
  percent_off numeric not null check (percent_off > 0 and percent_off <= 100),
  duration text not null default 'once' check (duration in ('once', 'forever', 'repeating')),
  duration_in_months integer,
  note text,
  approval_id uuid not null,
  active boolean not null default true,
  used_at timestamptz
);
create index if not exists pricing_exceptions_profile_idx on public.pricing_exceptions (profile_id) where active;
alter table public.pricing_exceptions enable row level security;
drop policy if exists "Super Admins read pricing exceptions" on public.pricing_exceptions;
create policy "Super Admins read pricing exceptions" on public.pricing_exceptions for select to authenticated using ((select public.is_admin()));
revoke all on public.pricing_exceptions from anon, authenticated;
grant select on public.pricing_exceptions to authenticated;

-- agreements: an approved change voids the signed copy; the customer signs again
alter table public.engagement_packets add column if not exists voided_at timestamptz;
alter table public.engagement_packets add column if not exists void_reason text;
alter table public.service_agreement_acceptances add column if not exists voided_at timestamptz;
alter table public.service_agreement_acceptances add column if not exists void_reason text;

-- staff role changes made directly by a Super Admin are logged in the shared
-- history too (the set_* functions already write admin_audit_log)
create or replace function public.history_on_role_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text; parts text[] := '{}';
begin
  if new.is_admin is distinct from old.is_admin then parts := parts || format('Super Admin %s', case when new.is_admin then 'granted' else 'removed' end); end if;
  if new.marketing_admin is distinct from old.marketing_admin then parts := parts || format('Marketing Admin %s', case when new.marketing_admin then 'granted' else 'removed' end); end if;
  if new.marketing_supervisor is distinct from old.marketing_supervisor then parts := parts || format('Marketing Supervisor %s', case when new.marketing_supervisor then 'granted' else 'removed' end); end if;
  if new.support_admin is distinct from old.support_admin then parts := parts || format('Customer Support Admin %s', case when new.support_admin then 'granted' else 'removed' end); end if;
  if new.operations_admin is distinct from old.operations_admin then parts := parts || format('Operations Admin %s', case when new.operations_admin then 'granted' else 'removed' end); end if;
  if array_length(parts, 1) > 0 then
    r := array_to_string(parts, ', ');
    perform public.log_record_event('super_admin', 'access', new.id, 'access_changed', format('%s — %s', new.email, r), new.id, null, null, null,
      jsonb_build_object('is_admin', old.is_admin, 'marketing_admin', old.marketing_admin, 'marketing_supervisor', old.marketing_supervisor, 'support_admin', old.support_admin, 'operations_admin', old.operations_admin),
      jsonb_build_object('is_admin', new.is_admin, 'marketing_admin', new.marketing_admin, 'marketing_supervisor', new.marketing_supervisor, 'support_admin', new.support_admin, 'operations_admin', new.operations_admin),
      nullif(current_setting('corvus.approval_id', true), '')::uuid);
  end if;
  return new;
end; $$;
drop trigger if exists record_role_history on public.profiles;
create trigger record_role_history after update of is_admin, marketing_admin, marketing_supervisor, support_admin, operations_admin
  on public.profiles for each row execute function public.history_on_role_change();

-- Super Admin sets a department's default owner
create or replace function public.set_default_owner(p_department text, p_owner uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_old uuid;
begin
  if not public.is_admin() then raise exception 'Only a Super Admin can change routing' using errcode = '42501'; end if;
  if p_owner is not null and not public.in_department(p_owner, p_department) then
    raise exception 'That person isn''t in %', p_department;
  end if;
  select default_owner into v_old from public.staff_routing where department = p_department;
  update public.staff_routing set default_owner = p_owner, updated_at = now(), updated_by = auth.uid() where department = p_department;
  perform public.log_record_event('super_admin', 'routing', null, 'default_owner_changed',
    format('%s default owner: %s → %s', initcap(p_department), public.owner_label(v_old), public.owner_label(p_owner)),
    null, null, null, null, jsonb_build_object('default_owner', v_old), jsonb_build_object('default_owner', p_owner));
end; $$;
revoke all on function public.set_default_owner(text, uuid) from public, anon;
grant execute on function public.set_default_owner(text, uuid) to authenticated;

-- ── executing approved requests (called only by the staff-approvals edge
-- function with the service role, after a Super Admin approved) ────────────
create or replace function public.apply_approved_change(p_approval uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a public.approval_requests; v_before jsonb; v_after jsonb; v_role text; v_on boolean; v_key text;
  v_email text; v_rec uuid; v_kind text;
begin
  select * into a from public.approval_requests where id = p_approval for update;
  if not found or a.status <> 'approved' then raise exception 'Approval is not in the approved state'; end if;
  perform set_config('corvus.approval_id', a.id::text, true);

  if a.kind = 'access_change' then
    v_role := a.payload->>'role'; v_on := (a.payload->>'enabled')::boolean;
    if v_role not in ('marketing_admin', 'marketing_supervisor', 'support_admin', 'operations_admin', 'is_admin') then
      raise exception 'Unknown role %', v_role;
    end if;
    select to_jsonb(p) - array['stripe_customer_id', 'calendar_feed_token', 'unsubscribe_token'] into v_before
      from public.profiles p where p.id = a.target_profile;
    execute format('update public.profiles set %I = $1 where id = $2 returning email', v_role) into v_email using v_on, a.target_profile;
    if v_email is null then raise exception 'No such user'; end if;
    v_before := jsonb_build_object(v_role, v_before->v_role);
    v_after := jsonb_build_object(v_role, v_on);
    insert into public.admin_audit_log (actor_id, actor_email, action, target_user_id, target_email, detail, approval_id, before, after)
    values (a.decided_by, (select email from public.profiles where id = a.decided_by),
            case when v_on then 'grant_' else 'revoke_' end || replace(v_role, 'is_admin', 'super_admin'),
            a.target_profile, v_email, format('%s (approved request)', a.title), a.id, v_before, v_after);

  elsif a.kind = 'automation_permission' then
    v_key := a.payload->>'key'; v_on := (a.payload->>'enabled')::boolean;
    select jsonb_build_object('enabled', enabled) into v_before from public.automation_permissions where key = v_key;
    if v_before is null then raise exception 'Unknown automation %', v_key; end if;
    update public.automation_permissions set enabled = v_on, updated_at = now(), updated_by = a.decided_by, approval_id = a.id where key = v_key;
    v_after := jsonb_build_object('enabled', v_on);
    perform public.log_record_event('super_admin', 'automation', null, 'automation_changed',
      format('%s turned %s', (select label from public.automation_permissions where key = v_key), case when v_on then 'on' else 'off' end),
      null, null, null, null, v_before, v_after, a.id, a.decided_by);

  elsif a.kind = 'agreement_change' then
    v_kind := a.payload->>'agreement'; v_rec := (a.payload->>'record_id')::uuid;
    if v_kind = 'engagement_packet' then
      update public.engagement_packets set voided_at = now(), void_reason = a.reason
       where id = v_rec and user_id = a.target_profile and voided_at is null;
    elsif v_kind = 'service_agreement' then
      update public.service_agreement_acceptances set voided_at = now(), void_reason = a.reason
       where id = v_rec and user_id = a.target_profile and voided_at is null;
      if found then
        -- service agreements are signed through the engagement packet: void the
        -- current packet too so the customer is asked to sign again
        update public.engagement_packets set voided_at = now(), void_reason = a.reason
         where user_id = a.target_profile and voided_at is null;
        perform 1 from public.service_agreement_acceptances where id = v_rec;
      end if;
    else
      raise exception 'Unknown agreement %', v_kind;
    end if;
    if not found then raise exception 'That signed agreement wasn''t found (or is already voided)'; end if;
    v_before := jsonb_build_object('voided', false); v_after := jsonb_build_object('voided', true, 'reason', a.reason);
    perform public.log_record_event('shared', 'agreement', v_rec, 'agreement_voided',
      format('%s voided — the customer signs again (%s)', initcap(replace(v_kind, '_', ' ')), a.reason),
      a.target_profile, null, null, null, v_before, v_after, a.id, a.decided_by);
  else
    raise exception 'Kind % is executed by the edge function', a.kind;
  end if;

  update public.approval_requests set status = 'executed', executed_at = now(), result = jsonb_build_object('before', v_before, 'after', v_after)
   where id = a.id;
  return jsonb_build_object('before', v_before, 'after', v_after);
end; $$;
revoke all on function public.apply_approved_change(uuid) from public, anon, authenticated;
grant execute on function public.apply_approved_change(uuid) to service_role;
grant execute on function public.log_record_event(text, text, uuid, text, text, uuid, uuid, uuid, uuid, jsonb, jsonb, uuid, uuid) to service_role;
grant execute on function public.notify_department(text, uuid, text, text, text, text, uuid, uuid) to service_role;
grant execute on function public.in_department(uuid, text) to service_role;

-- ── backfill ──────────────────────────────────────────────────────────────
update public.support_escalations set assigned_to = public.pick_owner('support') where assigned_to is null and status <> 'resolved';
update public.support_handoffs set assigned_to = public.pick_owner('support') where assigned_to is null and status <> 'done';
update public.protests set owner_id = public.pick_owner('operations') where owner_id is null and status <> 'resolved';
update public.marketing_leads set assigned_to = public.pick_owner('marketing') where assigned_to is null and subscribed_at is null;
update public.marketing_followups f set assigned_to = coalesce(
  (select l.assigned_to from public.marketing_leads l where l.id = f.lead_id), public.pick_owner('marketing'))
 where f.assigned_to is null and f.status in ('pending', 'draft');
update public.protests c set tax_year = coalesce((select pr.tax_year from public.properties pr where pr.id = c.property_id), extract(year from c.requested_at)::int)
 where c.tax_year is null;
update public.profiles p set lead_source = l.source, converted_from_lead = l.id, converted_at = coalesce(l.registered_at, l.created_at)
  from public.marketing_leads l where l.profile_id = p.id and p.lead_source is null;

-- ── live dashboards ───────────────────────────────────────────────────────
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['record_transfers', 'approval_requests', 'record_events', 'marketing_notifications',
                           'support_escalations', 'support_handoffs', 'protests', 'marketing_leads', 'marketing_followups']
  loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- outreach coordination: no marketing email / text / call while the customer
-- is being handed off (or after Support / Operations took them over)
create or replace function public.marketing_can_contact(p_lead uuid, p_channel text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when l.id is null then 'Lead not found'
    when l.stage = 'do_not_contact' then 'Do Not Contact'
    when l.outreach_paused_at is not null then 'Outreach paused — ' || coalesce(l.outreach_paused_reason, 'handoff in progress')
    when p_channel = 'email' and l.email is null then 'No email address'
    when p_channel = 'email' and l.unsubscribed_at is not null then 'Unsubscribed from email'
    when p_channel = 'email' and l.email_consent = 'withdrawn' then 'Email consent withdrawn'
    when p_channel = 'email' and l.email_bounced_at is not null then 'Email address bounced'
    when p_channel = 'sms' and l.phone is null then 'No phone number'
    when p_channel = 'sms' and l.sms_consent <> 'granted' then 'No SMS consent on record (texts need express written consent)'
    when p_channel = 'call' and l.phone is null then 'No phone number'
    else null end
  from (select 1) x left join public.marketing_leads l on l.id = p_lead;
$$;

-- status rules obey their automation switch (same function as in the marketing
-- migrations, plus the automation_permissions check at the top)
CREATE OR REPLACE FUNCTION public.marketing_apply_rules(p_lead uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rules jsonb; v_days int; v_n int := 0; r record; v_mode text;
begin
  -- a Super Admin can switch the status rules off (automation_permissions)
  if exists (select 1 from public.automation_permissions where key = 'status_rules' and not enabled) then return 0; end if;
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
       where l.stage not in ('registration_started', 'registered', 'property_added', 'subscription_started')
      union all
      select l.id, 4, 'outreach_contacted', 'contacted', 'Outreach was sent or logged'
        from l where l.stage in ('new', 'researching', 'ready')
         and exists (select 1 from public.marketing_activities a where a.lead_id = l.id and a.kind in ('email', 'sms', 'call', 'meeting')
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
      update public.marketing_leads set suggested_stage = r.target, suggested_stage_reason = r.reason, suggested_at = now() where id = r.id;
      v_n := v_n + 1;
    end if;
  end loop;
  update public.marketing_leads set suggested_stage = null, suggested_stage_reason = null, suggested_at = null
   where (p_lead is null or id = p_lead) and suggested_stage is not null and (suggested_stage = stage or stage = 'do_not_contact');
  return v_n;
end; $function$;

-- Give an UNOWNED item its owner (anyone in the department; a Super Admin may
-- also reassign directly). Owned items change hands only through a handoff.
create or replace function public.assign_owner(p_entity_type text, p_entity_id uuid, p_owner uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_dept text := public.entity_department(p_entity_type); v_cur uuid;
begin
  if v_dept is null then raise exception 'Unknown item type'; end if;
  if not (public.is_admin() or public.in_department(auth.uid(), v_dept)) then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_owner is null or not public.in_department(p_owner, v_dept) then raise exception 'Pick someone in %', v_dept; end if;
  if p_entity_type = 'lead' then select assigned_to into v_cur from public.marketing_leads where id = p_entity_id;
  elsif p_entity_type = 'followup' then select assigned_to into v_cur from public.marketing_followups where id = p_entity_id;
  elsif p_entity_type = 'onboarding' then select assigned_to into v_cur from public.support_handoffs where id = p_entity_id;
  elsif p_entity_type = 'escalation' then select assigned_to into v_cur from public.support_escalations where id = p_entity_id;
  elsif p_entity_type = 'case' then select owner_id into v_cur from public.protests where id = p_entity_id;
  end if;
  if v_cur is not null and not public.is_admin() then
    raise exception 'This already has an owner — hand it off instead';
  end if;
  if p_entity_type = 'lead' then update public.marketing_leads set assigned_to = p_owner where id = p_entity_id;
  elsif p_entity_type = 'followup' then update public.marketing_followups set assigned_to = p_owner where id = p_entity_id;
  elsif p_entity_type = 'onboarding' then update public.support_handoffs set assigned_to = p_owner where id = p_entity_id;
  elsif p_entity_type = 'escalation' then update public.support_escalations set assigned_to = p_owner where id = p_entity_id;
  elsif p_entity_type = 'case' then update public.protests set owner_id = p_owner where id = p_entity_id;
  end if;
  if not found then raise exception 'Item not found'; end if;
  if p_owner <> auth.uid() then
    perform public.notify_department(v_dept, p_owner, 'assigned', format('Assigned to you: %s', initcap(replace(p_entity_type, '_', ' '))),
      format('By %s', public.actor_label(auth.uid())), p_entity_type, p_entity_id, null);
  end if;
end; $$;
revoke all on function public.assign_owner(text, uuid, uuid) from public, anon;
grant execute on function public.assign_owner(text, uuid, uuid) to authenticated;
