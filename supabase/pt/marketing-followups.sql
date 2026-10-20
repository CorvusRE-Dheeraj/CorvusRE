-- Follow-ups, the registration → subscription journey, and the Customer Support
-- handoff (builds on marketing.sql, marketing-crm.sql, marketing-leads-ai.sql).
--
--   * Journey statuses: … Contacted → Interested → Registration Started →
--     Registered → Property Added → Subscription Started → Subscribed, set from
--     the real account (and the lead's own registration link), with the time
--     each step was first reached — so drop-offs are visible.
--   * New accounts are matched to their CRM lead (registration link, email,
--     phone); a duplicate created first is merged so history is kept.
--   * Follow-ups get an owner, a priority, AI drafts that wait for approval,
--     auto-send for approved emails, auto-reschedule, and sequences that stop
--     when the lead converts or replies.
--   * Customer Support Admin role + a handoff record when a lead subscribes.

-- ── Statuses ────────────────────────────────────────────────────────────────
alter table public.marketing_leads drop constraint if exists marketing_leads_stage_check;
alter table public.marketing_leads add constraint marketing_leads_stage_check check (stage in (
  'new', 'researching', 'ready', 'contacted', 'interested', 'registration_started', 'registered',
  'property_added', 'subscription_started', 'subscribed', 'no_response', 'not_interested', 'do_not_contact'));

create or replace function public.marketing_stage_label(s text) returns text language sql immutable as $$
  select case s
    when 'new' then 'New Lead' when 'researching' then 'Researching' when 'ready' then 'Ready for Outreach'
    when 'contacted' then 'Contacted' when 'interested' then 'Interested'
    when 'registration_started' then 'Registration Started' when 'registered' then 'Registered'
    when 'property_added' then 'Property Added' when 'subscription_started' then 'Subscription Started'
    when 'subscribed' then 'Subscribed' when 'no_response' then 'No Response'
    when 'not_interested' then 'Not Interested' when 'do_not_contact' then 'Do Not Contact' else s end;
$$;

alter table public.marketing_leads
  add column if not exists invite_token uuid not null default gen_random_uuid(),
  add column if not exists registration_started_at timestamptz,
  add column if not exists registered_at timestamptz,
  add column if not exists property_added_at timestamptz,
  add column if not exists subscription_started_at timestamptz,
  add column if not exists subscribed_at timestamptz;
create unique index if not exists marketing_leads_invite on public.marketing_leads (invite_token);

-- "Subscription started" = a checkout was opened (stamped by the checkout functions).
alter table public.properties add column if not exists checkout_started_at timestamptz;
alter table public.bpp_accounts add column if not exists checkout_started_at timestamptz;

alter table public.marketing_activities drop constraint if exists marketing_activities_kind_check;
alter table public.marketing_activities add constraint marketing_activities_kind_check check (kind in (
  'note', 'email', 'sms', 'call', 'meeting', 'stage', 'ai', 'follow_up', 'campaign', 'import', 'sync', 'research', 'assign', 'journey'));

-- ── Follow-ups ──────────────────────────────────────────────────────────────
alter table public.marketing_followups drop constraint if exists marketing_followups_channel_check;
alter table public.marketing_followups add constraint marketing_followups_channel_check check (channel in ('email', 'sms', 'call', 'meeting', 'task'));
alter table public.marketing_followups drop constraint if exists marketing_followups_status_check;
alter table public.marketing_followups add constraint marketing_followups_status_check check (status in ('draft', 'pending', 'done', 'skipped'));
alter table public.marketing_followups
  add column if not exists assigned_to uuid references public.profiles(id) on delete set null,
  add column if not exists priority text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  add column if not exists outcome text,
  add column if not exists notes text,
  add column if not exists call_script text,
  -- approved emails go out by themselves when due (the hourly job)
  add column if not exists auto_send boolean not null default false,
  -- calls/tasks/meetings that slip are moved to the next business morning (twice, then a person is alerted)
  add column if not exists auto_reschedule boolean not null default true,
  add column if not exists rescheduled_count int not null default 0,
  add column if not exists stop_reason text,
  add column if not exists approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists approved_at timestamptz;
create index if not exists marketing_followups_assigned on public.marketing_followups (assigned_to, status, due_at);

-- Do Not Contact also blocks drafts (nothing can be prepared to go out).
create or replace function public.marketing_followups_dnc() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('pending', 'draft') and new.channel in ('email', 'sms', 'call', 'meeting')
     and exists (select 1 from public.marketing_leads where id = new.lead_id and stage = 'do_not_contact') then
    raise exception 'This lead is marked Do Not Contact — no outreach can be scheduled.' using errcode = '42501';
  end if;
  if new.status in ('pending', 'draft') and new.channel = 'email'
     and exists (select 1 from public.marketing_leads where id = new.lead_id and unsubscribed_at is not null) then
    raise exception 'This lead unsubscribed from marketing email.' using errcode = '42501';
  end if;
  return new;
end; $$;

-- ── Templates for the journey reminders ─────────────────────────────────────
alter table public.marketing_templates drop constraint if exists marketing_templates_objective_check;
alter table public.marketing_templates add constraint marketing_templates_objective_check check (objective in (
  'initial_outreach', 'assessment_increase', 'deadline', 'registration_reminder', 'subscription_promo', 'follow_up',
  'add_property', 'finish_checkout'));
update public.marketing_templates set body = replace(body, 'Your account takes two minutes to finish', 'Your account takes two minutes to finish ({{registration_link}})')
 where is_default and name = 'Registration reminder' and body not like '%{{registration_link}}%';
update public.marketing_templates set body = replace(body, 'your CorvusPT account is almost ready', 'your CorvusPT account is almost ready: {{registration_link}}')
 where is_default and name = 'Registration reminder (text)' and body not like '%{{registration_link}}%';
insert into public.marketing_templates (name, objective, channel, subject, body, is_default)
select v.*, true from (values
  ('Add your properties', 'add_property', 'email', 'Add {{company}}''s properties to CorvusPT',
   E'Hi {{first_name}},\n\nYour CorvusPT account is ready — the next step is adding your properties so our AI can review each assessment: {{add_property_link}}\n\nOwn several? Add them all at once with a spreadsheet upload. You stay in control of every protest and keep 100% of any tax savings.\n\nThe CorvusPT team'),
  ('Add your properties (text)', 'add_property', 'sms', null,
   'Hi {{first_name}}, add your properties to CorvusPT for an AI assessment review: {{add_property_link}} Reply STOP to opt out.'),
  ('Finish your subscription', 'finish_checkout', 'email', 'Finish starting your protest for {{property_address}}',
   E'Hi {{first_name}},\n\nYou were almost done setting up the protest for {{property_address}}. Pick up where you left off: {{checkout_link}}\n\nYour plan includes the AI assessment review, filing guidance and hearing prep — and you keep 100% of any tax savings.\n\nThe CorvusPT team'),
  ('Finish your subscription (text)', 'finish_checkout', 'sms', null,
   'Hi {{first_name}}, your CorvusPT protest for {{property_address}} is one step away: {{checkout_link}} Reply STOP to opt out.')
) v(name, objective, channel, subject, body)
where not exists (select 1 from public.marketing_templates where objective = 'add_property' and is_default);

-- ── Customer Support Admin role ─────────────────────────────────────────────
alter table public.profiles add column if not exists support_admin boolean not null default false;
create or replace function public.is_support_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin or p.support_admin from public.profiles p where p.id = auth.uid()), false);
$$;
grant execute on function public.is_support_admin() to anon, authenticated;

create or replace function public.set_support_admin(target uuid, enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if not public.is_admin() then
    raise exception 'Only a Super Admin can change support access' using errcode = '42501';
  end if;
  update public.profiles set support_admin = enabled where id = target returning email into v_email;
  if not found then raise exception 'No such user'; end if;
  insert into public.admin_audit_log (actor_id, actor_email, action, target_user_id, target_email, detail)
  values (auth.uid(), (select email from public.profiles where id = auth.uid()),
          case when enabled then 'grant_support_admin' else 'revoke_support_admin' end, target, v_email,
          case when enabled then 'Customer Support Admin access granted' else 'Customer Support Admin access removed' end);
end; $$;
revoke all on function public.set_support_admin(uuid, boolean) from public, anon;
grant execute on function public.set_support_admin(uuid, boolean) to authenticated;

create table if not exists public.support_handoffs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  lead_id uuid not null unique references public.marketing_leads(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'accepted', 'done')),
  assigned_to uuid references public.profiles(id) on delete set null,
  -- {properties:[…], bpp:{…}, packetSigned, termsAccepted, openEscalations, needs:[…], refreshedAt}
  snapshot jsonb not null default '{}'::jsonb,
  summary text,
  summary_at timestamptz,
  notes text,
  accepted_at timestamptz,
  done_at timestamptz
);
alter table public.support_handoffs enable row level security;
drop policy if exists "Staff read support handoffs" on public.support_handoffs;
create policy "Staff read support handoffs" on public.support_handoffs for select to authenticated
  using ((select public.is_support_admin()) or (select public.is_marketing_admin()));
drop policy if exists "Support updates handoffs" on public.support_handoffs;
create policy "Support updates handoffs" on public.support_handoffs for update to authenticated
  using ((select public.is_support_admin())) with check ((select public.is_support_admin()));
revoke all on public.support_handoffs from anon;
grant select, update on public.support_handoffs to authenticated;
drop trigger if exists support_handoffs_touch on public.support_handoffs;
create trigger support_handoffs_touch before update on public.support_handoffs for each row execute function public.touch_updated_at();

-- What Support needs to know about a new customer (only what onboarding needs).
create or replace function public.marketing_customer_snapshot(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with pr as (
    select address, cad, account_number, total_value, subscription_status, plan_tier, protest_deadline
    from public.properties where user_id = p_user
  ), b as (
    select count(*) n, count(*) filter (where subscription_status in ('active', 'trialing', 'past_due')) paid
    from public.bpp_accounts where user_id = p_user
  ), f as (
    select
      (select count(*) from pr) props,
      (select count(*) from pr where subscription_status in ('active', 'trialing', 'past_due')) paid,
      (select count(*) from pr where subscription_status = 'past_due') past_due,
      (select count(*) from pr where nullif(trim(account_number), '') is null) no_acct,
      exists (select 1 from public.engagement_packets where user_id = p_user) packet,
      exists (select 1 from public.terms_acceptances where user_id = p_user) terms,
      (select count(*) from public.support_escalations where user_id = p_user and coalesce(status, 'open') not in ('resolved', 'closed')) esc,
      (select phone from public.profiles where id = p_user) phone
  )
  select jsonb_build_object(
    'properties', coalesce((select jsonb_agg(jsonb_build_object('address', address, 'cad', cad, 'account', account_number,
        'value', total_value, 'status', subscription_status, 'plan', plan_tier, 'deadline', protest_deadline)
        order by total_value desc nulls last) from pr), '[]'::jsonb),
    'bpp', (select jsonb_build_object('accounts', n, 'paid', paid) from b),
    'packetSigned', f.packet,
    'termsAccepted', f.terms,
    'openEscalations', f.esc,
    'needs', to_jsonb(array_remove(array[
      case when not f.packet then 'Sign the engagement packet (agent appointment + service agreement)' end,
      case when f.props > f.paid then format('%s propert%s not subscribed yet', f.props - f.paid, case when f.props - f.paid = 1 then 'y' else 'ies' end) end,
      case when f.past_due > 0 then 'Payment past due' end,
      case when f.no_acct > 0 then format('Add the CAD account number for %s propert%s', f.no_acct, case when f.no_acct = 1 then 'y' else 'ies' end) end,
      case when f.phone is null then 'Add a phone number' end,
      case when f.esc > 0 then format('%s open support request%s', f.esc, case when f.esc = 1 then '' else 's' end) end
    ], null)),
    'refreshedAt', now())
  from f;
$$;
revoke all on function public.marketing_customer_snapshot(uuid) from public, anon, authenticated;

create or replace function public.marketing_refresh_handoffs() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  for r in
    select l.id, l.profile_id, coalesce(l.company, l.full_name, l.email) nm from public.marketing_leads l
     where l.stage = 'subscribed' and l.profile_id is not null
       and not exists (select 1 from public.support_handoffs h where h.lead_id = l.id)
  loop
    insert into public.support_handoffs (lead_id, profile_id, snapshot) values (r.id, r.profile_id, public.marketing_customer_snapshot(r.profile_id));
    insert into public.marketing_activities (lead_id, kind, summary, body)
    values (r.id, 'journey', 'Handed to Customer Support', 'Paying customer — Support now handles subscription help, property onboarding and protest support. Marketing history stays here.');
    insert into public.marketing_notifications (staff_id, lead_id, kind, title, detail, dedupe_key)
    select p.id, r.id, 'handoff', 'New customer for Support: ' || r.nm, 'Open the Support queue for their summary and onboarding needs.', 'handoff:' || r.id || ':' || p.id
      from public.profiles p where p.support_admin
    on conflict (dedupe_key) do nothing;
    n := n + 1;
  end loop;
  update public.support_handoffs h set snapshot = public.marketing_customer_snapshot(h.profile_id)
   where h.status <> 'done' and h.profile_id is not null;
  return n;
end; $$;
revoke all on function public.marketing_refresh_handoffs() from public, anon, authenticated;
grant execute on function public.marketing_refresh_handoffs() to service_role;

-- ── Account sync: match accounts to leads, follow the journey ──────────────
create or replace function public.marketing_sync_core() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_beta int := 0; v_new int := 0; v_linked int := 0;
begin
  perform set_config('marketing.reason', 'Account sync: matches their CorvusPT account', true);

  insert into public.marketing_leads (full_name, email, company, source, beta_lead_id, created_at, notes)
  select b.full_name, b.work_email, b.company, 'beta_signup', b.id, b.created_at,
         nullif(concat_ws(' · ', nullif(b.area_of_interest, ''), nullif(b.use_case, '')), '')
  from public.beta_leads b
  where nullif(trim(b.work_email), '') is not null and b.work_email not ilike '%@example.com'
  on conflict (email_key) do update
    set beta_lead_id = coalesce(marketing_leads.beta_lead_id, excluded.beta_lead_id),
        company = coalesce(marketing_leads.company, excluded.company),
        full_name = coalesce(marketing_leads.full_name, excluded.full_name)
    where marketing_leads.beta_lead_id is null or marketing_leads.company is null or marketing_leads.full_name is null;
  get diagnostics v_beta = row_count;

  create temp table if not exists _acct (
    id uuid, email text, phone text, full_name text, company text, created_at timestamptz,
    confirmed boolean, named boolean, props int, checkout boolean, paying boolean,
    first_prop timestamptz, first_checkout timestamptz
  ) on commit drop;
  truncate _acct;
  insert into _acct
  select p.id, p.email, p.phone, nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.company_name, p.created_at,
         u.email_confirmed_at is not null, nullif(trim(p.first_name), '') is not null,
         (select count(*) from public.properties pr where pr.user_id = p.id)::int,
         exists (select 1 from public.properties pr where pr.user_id = p.id and pr.checkout_started_at is not null)
           or exists (select 1 from public.bpp_accounts ba where ba.user_id = p.id and ba.checkout_started_at is not null),
         exists (select 1 from public.properties pr where pr.user_id = p.id and pr.subscription_status in ('active', 'trialing', 'past_due'))
           or exists (select 1 from public.bpp_accounts ba where ba.user_id = p.id and ba.subscription_status in ('active', 'trialing', 'past_due')),
         (select min(pr.created_at) from public.properties pr where pr.user_id = p.id),
         (select min(pr.checkout_started_at) from public.properties pr where pr.user_id = p.id)
  from public.profiles p
  left join auth.users u on u.id = p.id
  where coalesce(p.is_admin, false) = false and coalesce(p.marketing_admin, false) = false and coalesce(p.support_admin, false) = false
    and nullif(trim(p.email), '') is not null and p.email not ilike '%@example.com';

  -- match unlinked leads: same email, else same phone
  with m as (
    update public.marketing_leads l set profile_id = a.id
      from _acct a
     where l.profile_id is null and l.email_key = lower(trim(a.email))
       and not exists (select 1 from public.marketing_leads x where x.profile_id = a.id)
    returning l.id
  ) insert into public.marketing_activities (lead_id, kind, summary)
    select id, 'journey', 'Matched to their new CorvusPT account (same email)' from m;
  get diagnostics v_linked = row_count;
  with m as (
    update public.marketing_leads l set profile_id = a.id
      from _acct a
     where l.profile_id is null and length(regexp_replace(coalesce(a.phone, ''), '\D', '', 'g')) >= 10
       and right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 10) = right(regexp_replace(a.phone, '\D', '', 'g'), 10)
       and not exists (select 1 from public.marketing_leads x where x.profile_id = a.id)
    returning l.id
  ) insert into public.marketing_activities (lead_id, kind, summary)
    select id, 'journey', 'Matched to their new CorvusPT account (same phone)' from m;

  -- accounts with no lead yet
  insert into public.marketing_leads (full_name, email, phone, company, source, profile_id, stage, created_at)
  select a.full_name, a.email, a.phone, a.company, 'registered', a.id, 'registration_started', a.created_at
  from _acct a
  where not exists (select 1 from public.marketing_leads x where x.profile_id = a.id)
  on conflict (email_key) do nothing;
  get diagnostics v_new = row_count;

  -- follow the account through the journey
  update public.marketing_leads l set
    phone = coalesce(l.phone, a.phone),
    full_name = coalesce(l.full_name, a.full_name),
    company = coalesce(l.company, a.company),
    registration_started_at = coalesce(l.registration_started_at, a.created_at),
    registered_at = case when a.confirmed and a.named then coalesce(l.registered_at, a.created_at) else l.registered_at end,
    property_added_at = case when a.props > 0 then coalesce(l.property_added_at, a.first_prop, now()) else l.property_added_at end,
    subscription_started_at = case when a.checkout or a.paying then coalesce(l.subscription_started_at, a.first_checkout, now()) else l.subscription_started_at end,
    subscribed_at = case when a.paying then coalesce(l.subscribed_at, now()) else l.subscribed_at end,
    stage = case
      when l.stage = 'do_not_contact' then 'do_not_contact'
      when a.paying then 'subscribed'
      when l.stage = 'not_interested' then 'not_interested'
      when a.checkout then 'subscription_started'
      when a.props > 0 then 'property_added'
      when a.confirmed and a.named then 'registered'
      else 'registration_started' end
  from _acct a
  where l.profile_id = a.id
    and (l.stage is distinct from (case
          when l.stage = 'do_not_contact' then 'do_not_contact' when a.paying then 'subscribed'
          when l.stage = 'not_interested' then 'not_interested' when a.checkout then 'subscription_started'
          when a.props > 0 then 'property_added' when a.confirmed and a.named then 'registered'
          else 'registration_started' end)
      or (l.phone is null and a.phone is not null) or (l.full_name is null and a.full_name is not null)
      or l.registration_started_at is null
      or (a.confirmed and a.named and l.registered_at is null)
      or (a.props > 0 and l.property_added_at is null)
      or ((a.checkout or a.paying) and l.subscription_started_at is null)
      or (a.paying and l.subscribed_at is null));

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
  perform public.marketing_refresh_handoffs();
  return jsonb_build_object('betaSignups', v_beta, 'registeredUsers', v_new, 'matched', v_linked, 'syncedAt', now());
end; $$;
revoke all on function public.marketing_sync_core() from public, anon, authenticated;
grant execute on function public.marketing_sync_core() to service_role;

create or replace function public.marketing_sync_leads() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_marketing_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  return public.marketing_sync_core();
end; $$;
revoke all on function public.marketing_sync_leads() from public, anon;
grant execute on function public.marketing_sync_leads() to authenticated;

-- A prospect opened their registration link (anonymous; the token is the key).
create or replace function public.marketing_track_link(p_token uuid, p_event text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_stage text;
begin
  if p_event not in ('registration_opened') then return false; end if;
  select id, stage into v_id, v_stage from public.marketing_leads where invite_token = p_token;
  if v_id is null then return false; end if;
  if not exists (select 1 from public.marketing_activities where lead_id = v_id and kind = 'journey'
                 and summary = 'Opened their registration link' and created_at > now() - interval '1 day') then
    insert into public.marketing_activities (lead_id, kind, summary) values (v_id, 'journey', 'Opened their registration link');
  end if;
  if v_stage in ('new', 'researching', 'ready', 'contacted', 'interested', 'no_response') then
    perform set_config('marketing.reason', 'Opened their registration link', true);
    update public.marketing_leads set stage = 'registration_started', registration_started_at = coalesce(registration_started_at, now()) where id = v_id;
    perform set_config('marketing.reason', '', true);
  end if;
  return true;
end; $$;
revoke all on function public.marketing_track_link(uuid, text) from public;
grant execute on function public.marketing_track_link(uuid, text) to anon, authenticated;

-- The signed-in user registered from a lead's link: link the account to that
-- lead. If the sync already made a separate lead for the account, merge it in
-- so no history is lost.
create or replace function public.marketing_claim_lead(p_token uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_lead uuid; v_owner uuid; v_dup uuid;
begin
  if v_uid is null then return false; end if;
  select id, profile_id into v_lead, v_owner from public.marketing_leads where invite_token = p_token;
  if v_lead is null or (v_owner is not null and v_owner <> v_uid) then return false; end if;
  if v_owner = v_uid then return true; end if;
  select id into v_dup from public.marketing_leads where profile_id = v_uid and id <> v_lead;
  if v_dup is not null then
    update public.marketing_activities set lead_id = v_lead where lead_id = v_dup;
    update public.marketing_followups set lead_id = v_lead where lead_id = v_dup;
    insert into public.marketing_lead_properties (lead_id, address, city, zip, county, cad, account_number, property_type,
        assessed_value, land_value, improvement_value, prior_value, tax_year, owner_name, mailing_address, protest_deadline,
        source, source_detail, verified, confidence)
    select v_lead, address, city, zip, county, cad, account_number, property_type, assessed_value, land_value,
           improvement_value, prior_value, tax_year, owner_name, mailing_address, protest_deadline, source, source_detail, verified, confidence
      from public.marketing_lead_properties where lead_id = v_dup
    on conflict do nothing;
    delete from public.marketing_leads where id = v_dup;
  end if;
  update public.marketing_leads set profile_id = v_uid, registration_started_at = coalesce(registration_started_at, now()) where id = v_lead;
  insert into public.marketing_activities (lead_id, kind, summary)
  values (v_lead, 'journey', 'Registered from their CorvusPT invitation link — account matched to this lead');
  return true;
end; $$;
revoke all on function public.marketing_claim_lead(uuid) from public, anon;
grant execute on function public.marketing_claim_lead(uuid) to authenticated;

-- ── Rules: account-driven statuses are never moved by outreach outcomes ────
create or replace function public.marketing_apply_rules(p_lead uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_rules jsonb; v_days int; v_n int := 0; r record; v_mode text;
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
end; $$;
revoke all on function public.marketing_apply_rules(uuid) from public, anon, authenticated;
grant execute on function public.marketing_apply_rules(uuid) to service_role;

-- ── Monitor (hourly): sync, rules, sequences, rescheduling, alerts ─────────
create or replace function public.marketing_next_business_morning(p_from timestamptz) returns timestamptz
language plpgsql immutable as $$
declare d date := (p_from at time zone 'America/Chicago')::date + 1;
begin
  while extract(isodow from d) in (6, 7) loop d := d + 1; end loop;
  return (d + time '10:00') at time zone 'America/Chicago';
end; $$;

create or replace function public.marketing_monitor() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_days int := coalesce((select inactive_days from public.marketing_settings where id = 1), 14);
  v_sync jsonb; v_rules int; v_notes int := 0; v_stopped int := 0; v_moved int := 0; c int;
begin
  v_sync := public.marketing_sync_core();
  v_rules := public.marketing_apply_rules(null);

  -- sequences stop when the lead converts, replies or opts out
  update public.marketing_followups f set status = 'skipped', completed_at = now(),
         stop_reason = case
           when l.stage = 'do_not_contact' then 'Do Not Contact'
           when f.channel = 'email' and l.unsubscribed_at is not null then 'Unsubscribed'
           when l.stage in ('registered', 'property_added', 'subscription_started', 'subscribed') and f.created_at < coalesce(l.registered_at, now()) then 'They registered — sequence stopped'
           else 'They replied — a person takes it from here' end
    from public.marketing_leads l
   where l.id = f.lead_id and f.status in ('pending', 'draft') and f.sequence_name is not null
     and (l.stage = 'do_not_contact'
          or (f.channel = 'email' and l.unsubscribed_at is not null)
          or (l.stage in ('registered', 'property_added', 'subscription_started', 'subscribed') and f.created_at < coalesce(l.registered_at, now()))
          or exists (select 1 from public.marketing_activities a where a.lead_id = l.id and a.outcome in ('replied', 'interested', 'not_interested') and a.created_at > f.created_at));
  get diagnostics v_stopped = row_count;

  -- calls / meetings / tasks that slipped move to the next business morning (twice)
  with moved as (
    update public.marketing_followups f set due_at = public.marketing_next_business_morning(now()),
           rescheduled_count = f.rescheduled_count + 1
     where f.status = 'pending' and f.auto_reschedule and f.rescheduled_count < 2
       and f.channel in ('call', 'meeting', 'task', 'sms') and f.due_at < now() - interval '1 day'
    returning f.id, f.lead_id
  ) insert into public.marketing_activities (lead_id, kind, summary)
    select lead_id, 'follow_up', 'Follow-up was overdue — moved to the next business morning' from moved;
  get diagnostics v_moved = row_count;

  -- needs a person: rescheduled twice and still not done
  insert into public.marketing_notifications (staff_id, lead_id, kind, title, detail, dedupe_key)
  select coalesce(f.assigned_to, l.assigned_to), l.id, 'attention',
         'Needs your personal attention: ' || coalesce(l.company, l.full_name, l.email, 'lead'),
         format('%s "%s" slipped twice — call them or close it.', initcap(f.channel), coalesce(f.subject, 'follow-up')),
         'attention:' || f.id
    from public.marketing_followups f join public.marketing_leads l on l.id = f.lead_id
   where f.status = 'pending' and f.rescheduled_count >= 2 and f.due_at < now() and coalesce(f.assigned_to, l.assigned_to) is not null
  on conflict (dedupe_key) do nothing;
  get diagnostics c = row_count; v_notes := v_notes + c;

  -- overdue follow-ups (to the follow-up's owner, else the lead's)
  insert into public.marketing_notifications (staff_id, lead_id, kind, title, detail, dedupe_key)
  select coalesce(f.assigned_to, l.assigned_to), l.id, 'overdue',
         'Overdue ' || f.channel || ': ' || coalesce(l.company, l.full_name, l.email, 'lead'),
         coalesce(f.subject, 'Follow-up') || ' — due ' || to_char(f.due_at at time zone 'America/Chicago', 'Mon DD'),
         'overdue:' || f.id
    from public.marketing_followups f join public.marketing_leads l on l.id = f.lead_id
   where f.status = 'pending' and f.due_at < now() and coalesce(f.assigned_to, l.assigned_to) is not null
  on conflict (dedupe_key) do nothing;
  get diagnostics c = row_count; v_notes := v_notes + c;

  -- drafts waiting for approval
  insert into public.marketing_notifications (staff_id, lead_id, kind, title, detail, dedupe_key)
  select coalesce(f.assigned_to, l.assigned_to), l.id, 'approval',
         'Message to approve: ' || coalesce(l.company, l.full_name, l.email, 'lead'),
         coalesce(f.subject, initcap(f.channel)) || ' — review, edit and approve it in Follow-ups.',
         'approval:' || f.id
    from public.marketing_followups f join public.marketing_leads l on l.id = f.lead_id
   where f.status = 'draft' and coalesce(f.assigned_to, l.assigned_to) is not null
  on conflict (dedupe_key) do nothing;
  get diagnostics c = row_count; v_notes := v_notes + c;

  insert into public.marketing_notifications (staff_id, lead_id, kind, title, detail, dedupe_key)
  select l.assigned_to, l.id, 'next_action', 'Action due: ' || coalesce(l.company, l.full_name, l.email, 'lead'), l.next_action,
         'next:' || l.id || ':' || to_char(l.next_action_at, 'YYYYMMDD')
    from public.marketing_leads l
   where l.assigned_to is not null and l.next_action is not null and l.next_action_at < now()
     and l.stage not in ('do_not_contact', 'not_interested', 'subscribed')
  on conflict (dedupe_key) do nothing;
  get diagnostics c = row_count; v_notes := v_notes + c;

  -- journey drop-offs and quiet prospects (weekly per lead)
  insert into public.marketing_notifications (staff_id, lead_id, kind, title, detail, dedupe_key)
  select l.assigned_to, l.id, 'journey',
         case
           when l.stage = 'interested' then 'Interested, not registered: '
           when l.stage = 'registration_started' then 'Started registering, didn''t finish: '
           when l.stage = 'registered' then 'Registered, no property yet: '
           when l.stage = 'property_added' then 'Added a property, not subscribed: '
           when l.stage = 'subscription_started' then 'Checkout not finished: '
         end || coalesce(l.company, l.full_name, l.email, 'lead'),
         'Send the reminder with their link back to the step — Follow-ups has it ready.',
         'journey:' || l.id || ':' || l.stage || ':' || to_char(now(), 'IYYYIW')
    from public.marketing_leads l
   where l.assigned_to is not null
     and not exists (select 1 from public.marketing_followups f where f.lead_id = l.id and f.status in ('pending', 'draft'))
     and ((l.stage = 'interested' and coalesce((select max(a.created_at) from public.marketing_activities a where a.lead_id = l.id and a.kind = 'stage'), l.updated_at) < now() - interval '3 days')
       or (l.stage = 'registration_started' and coalesce(l.registration_started_at, l.updated_at) < now() - interval '1 day')
       or (l.stage = 'registered' and coalesce(l.registered_at, l.updated_at) < now() - interval '3 days')
       or (l.stage = 'property_added' and coalesce(l.property_added_at, l.updated_at) < now() - interval '3 days')
       or (l.stage = 'subscription_started' and coalesce(l.subscription_started_at, l.updated_at) < now() - interval '2 hours'))
  on conflict (dedupe_key) do nothing;
  get diagnostics c = row_count; v_notes := v_notes + c;

  insert into public.marketing_notifications (staff_id, lead_id, kind, title, detail, dedupe_key)
  select l.assigned_to, l.id, 'inactive', 'Going quiet: ' || coalesce(l.company, l.full_name, l.email, 'lead'),
         format('No activity for %s days — follow up or update the status.', extract(day from now() - x.last_at)::int),
         'inactive:' || l.id || ':' || to_char(now(), 'IYYYIW')
    from public.marketing_leads l
    join lateral (select coalesce(max(a.created_at), l.created_at) last_at from public.marketing_activities a where a.lead_id = l.id) x on true
   where l.assigned_to is not null and l.stage in ('ready', 'contacted', 'interested')
     and x.last_at < now() - make_interval(days => v_days)
     and not exists (select 1 from public.marketing_followups f where f.lead_id = l.id and f.status in ('pending', 'draft'))
  on conflict (dedupe_key) do nothing;
  get diagnostics c = row_count; v_notes := v_notes + c;

  insert into public.marketing_notifications (staff_id, lead_id, kind, title, detail, dedupe_key)
  select l.assigned_to, l.id, 'suggestion',
         'Status suggestion: ' || coalesce(l.company, l.full_name, l.email, 'lead') || ' → ' || public.marketing_stage_label(l.suggested_stage),
         l.suggested_stage_reason, 'suggest:' || l.id || ':' || l.suggested_stage
    from public.marketing_leads l where l.assigned_to is not null and l.suggested_stage is not null
  on conflict (dedupe_key) do nothing;
  get diagnostics c = row_count; v_notes := v_notes + c;

  insert into public.marketing_notifications (staff_id, lead_id, kind, title, detail, dedupe_key)
  select l.assigned_to, l.id, 'engagement', coalesce(l.company, l.full_name, l.email, 'Lead') || ': ' || a.summary, a.body, 'activity:' || a.id
    from public.marketing_activities a join public.marketing_leads l on l.id = a.lead_id
   where a.created_by is null and a.created_at > now() - interval '2 hours' and l.assigned_to is not null
     and (a.kind in ('stage', 'journey') or a.summary ilike 'Unsubscribed%')
     and coalesce(a.body, '') not like 'Rule: Missing contact%'
     and coalesce(a.body, '') not like 'Rule: Has a way to reach%'
  on conflict (dedupe_key) do nothing;
  get diagnostics c = row_count; v_notes := v_notes + c;

  return jsonb_build_object('sync', v_sync, 'rules', v_rules, 'stopped', v_stopped, 'rescheduled', v_moved, 'notifications', v_notes);
end; $$;
revoke all on function public.marketing_monitor() from public, anon, authenticated;
grant execute on function public.marketing_monitor() to service_role;

-- existing lead-account matches: backfill the journey once
select public.marketing_sync_core();

-- What the Support queue shows: handed-off customers only — contact details
-- and the recent communication history (read-only), never the rest of the CRM.
create or replace function public.support_handoff_details()
returns table (handoff_id uuid, name text, company text, email text, phone text, subscribed_at timestamptz, history jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_support_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  return query
    select h.id, l.full_name, l.company, l.email, l.phone, l.subscribed_at,
           coalesce((select jsonb_agg(jsonb_build_object('at', a.created_at, 'kind', a.kind, 'summary', a.summary, 'body', left(a.body, 400)) order by a.created_at desc)
                     from (select * from public.marketing_activities x where x.lead_id = l.id order by x.created_at desc limit 30) a), '[]'::jsonb)
    from public.support_handoffs h join public.marketing_leads l on l.id = h.lead_id;
end; $$;
revoke all on function public.support_handoff_details() from public, anon;
grant execute on function public.support_handoff_details() to authenticated;
