-- Business Development Admin console (2026-11-06). Applied live.
--
-- Built on the existing CRM (marketing.sql / marketing-crm.sql) — no separate
-- database: an organization (crm_accounts) groups existing marketing_leads
-- (its contacts and decision-makers), whose properties are the existing
-- marketing_lead_properties and, once they register, their real properties;
-- communication history is the existing marketing_activities + record_events.
--
-- Who can do what:
--   Business Development Admin (profiles.bd_admin) — accounts, opportunities,
--     research, portfolio sales, proposals, referral partners, follow-ups,
--     handoffs to Support. No access to customer protest documents, payment
--     credentials or platform settings (none of those tables grant BD).
--   BD Supervisor (profiles.bd_supervisor) — also assigns accounts and work,
--     sees the whole team and exports.
--   Super Admin — everything; approves proposal exceptions (custom discounts,
--     contractual commitments) and partner payouts (approval_requests), and
--     manages proposal templates.
-- Milestones are verified, never just ticked: "agreement" needs a signed
-- proposal (or a Super Admin / supervisor verifying a signed copy) and
-- "active customer" needs a real paid subscription on the customer's account.

-- ── roles ───────────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists bd_admin boolean not null default false;
alter table public.profiles add column if not exists bd_supervisor boolean not null default false;

create or replace function public.is_bd_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin or p.bd_admin from public.profiles p where p.id = auth.uid()), false);
$$;
grant execute on function public.is_bd_admin() to authenticated;

create or replace function public.is_bd_supervisor()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin or (p.bd_admin and p.bd_supervisor) from public.profiles p where p.id = auth.uid()), false);
$$;
grant execute on function public.is_bd_supervisor() to authenticated;

create or replace function public.set_bd_role(target uuid, p_role text, enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if not public.is_admin() then
    raise exception 'Only a Super Admin can change Business Development access' using errcode = '42501';
  end if;
  if p_role not in ('bd_admin', 'bd_supervisor') then raise exception 'Unknown role'; end if;
  execute format('update public.profiles set %I = $1 where id = $2 returning email', p_role) into v_email using enabled, target;
  if v_email is null then raise exception 'No such user'; end if;
  insert into public.admin_audit_log (actor_id, actor_email, action, target_user_id, target_email, detail)
  values (auth.uid(), (select email from public.profiles where id = auth.uid()),
          case when enabled then 'grant_' else 'revoke_' end || p_role, target, v_email,
          format('%s %s', case p_role when 'bd_admin' then 'Business Development Admin' else 'Business Development Supervisor' end,
                 case when enabled then 'access granted' else 'access removed' end));
end; $$;
revoke all on function public.set_bd_role(uuid, text, boolean) from public, anon;
grant execute on function public.set_bd_role(uuid, text, boolean) to authenticated;

-- staff = anyone with a department role
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin or p.marketing_admin or p.support_admin or p.operations_admin or p.bd_admin
                   from public.profiles p where p.id = auth.uid()), false);
$$;

-- shared history: a Business Development department
alter table public.record_events drop constraint if exists record_events_department_check;
alter table public.record_events add constraint record_events_department_check
  check (department in ('marketing', 'support', 'operations', 'super_admin', 'shared', 'business_development'));
drop policy if exists "Departments read their history" on public.record_events;
create policy "Departments read their history" on public.record_events for select to authenticated using (
  (select public.is_admin())
  or (department = 'marketing' and (select public.is_marketing_admin()))
  or (department = 'support' and (select public.is_support_admin()))
  or (department = 'operations' and (select public.is_operations_admin()))
  or (department = 'business_development' and (select public.is_bd_admin()))
  or (department = 'shared' and (select public.is_staff()))
);

-- role changes through approvals know the new roles
do $$
declare d text;
begin
  select pg_get_functiondef('public.apply_approved_change'::regproc) into d;
  if position('bd_admin' in d) = 0 then
    d := replace(d, $q$('marketing_admin', 'marketing_supervisor', 'support_admin', 'operations_admin', 'is_admin')$q$,
                    $q$('marketing_admin', 'marketing_supervisor', 'support_admin', 'support_supervisor', 'operations_admin', 'bd_admin', 'bd_supervisor', 'is_admin')$q$);
    execute d;
  end if;
end $$;

alter table public.approval_requests drop constraint if exists approval_requests_kind_check;
alter table public.approval_requests add constraint approval_requests_kind_check
  check (kind in ('access_change', 'pricing_exception', 'refund', 'agreement_change', 'automation_permission',
                  'subscription_override', 'proposal_exception', 'partner_payout'));

-- ── organizations on the existing CRM ──────────────────────────────────────
create table if not exists public.crm_accounts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  kind text not null default 'property_owner' check (kind in ('property_owner', 'management_company', 'broker', 'investment_group', 'partner', 'other')),
  website text,
  phone text,
  address text,
  counties text[] not null default '{}',
  notes text,
  relationship_owner uuid references public.profiles (id) on delete set null,
  created_by uuid,
  dedupe_key text generated always as (
    regexp_replace(lower(regexp_replace(name, '\m(llc|l\.l\.c\.|inc|incorporated|lp|l\.p\.|ltd|co|corp|corporation|company|the|trust|partners|holdings)\M', '', 'gi')), '[^a-z0-9]', '', 'g')
  ) stored,
  -- AI suggestions waiting for staff review: {duplicates:[{id,name,reason}], info:{field:value}, sources:[...], at}
  ai_suggestions jsonb,
  merged_into uuid references public.crm_accounts (id) on delete set null
);
create index if not exists crm_accounts_dedupe_idx on public.crm_accounts (dedupe_key);
alter table public.crm_accounts enable row level security;
drop policy if exists "BD and Marketing manage accounts" on public.crm_accounts;
create policy "BD and Marketing manage accounts" on public.crm_accounts for all to authenticated
  using ((select public.is_bd_admin()) or (select public.is_marketing_admin()))
  with check ((select public.is_bd_admin()) or (select public.is_marketing_admin()));
revoke all on public.crm_accounts from anon;
grant select, insert, update on public.crm_accounts to authenticated;

-- a lead is a contact of an organization
alter table public.marketing_leads add column if not exists account_id uuid references public.crm_accounts (id) on delete set null;
alter table public.marketing_leads add column if not exists title text;
alter table public.marketing_leads add column if not exists decision_maker boolean not null default false;
create index if not exists marketing_leads_account_idx on public.marketing_leads (account_id);

-- BD works in the same CRM records as Marketing
drop policy if exists "BD manages leads" on public.marketing_leads;
create policy "BD manages leads" on public.marketing_leads for all to authenticated
  using ((select public.is_bd_admin())) with check ((select public.is_bd_admin()));
drop policy if exists "BD manages lead properties" on public.marketing_lead_properties;
create policy "BD manages lead properties" on public.marketing_lead_properties for all to authenticated
  using ((select public.is_bd_admin())) with check ((select public.is_bd_admin()));
drop policy if exists "BD reads and logs activities" on public.marketing_activities;
create policy "BD reads and logs activities" on public.marketing_activities for select to authenticated
  using ((select public.is_bd_admin()));
drop policy if exists "BD logs activities" on public.marketing_activities;
create policy "BD logs activities" on public.marketing_activities for insert to authenticated
  with check ((select public.is_bd_admin()));
-- BD sees Marketing's scheduled outreach (to avoid overlapping it), doesn't edit it
drop policy if exists "BD reads marketing followups" on public.marketing_followups;
create policy "BD reads marketing followups" on public.marketing_followups for select to authenticated
  using ((select public.is_bd_admin()));

-- ── opportunities ──────────────────────────────────────────────────────────
create table if not exists public.bd_opportunities (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  account_id uuid not null references public.crm_accounts (id) on delete cascade,
  primary_lead_id uuid references public.marketing_leads (id) on delete set null,
  title text not null,
  kind text not null default 'portfolio' check (kind in ('portfolio', 'enterprise', 'partnership', 'referral_partner', 'single_property')),
  stage text not null default 'identification' check (stage in
    ('identification', 'qualification', 'meeting', 'proposal', 'negotiation', 'agreement', 'activation', 'active', 'on_hold', 'lost')),
  stage_reason text,
  stage_changed_at timestamptz not null default now(),
  resume_stage text,
  assigned_to uuid references public.profiles (id) on delete set null,
  est_property_count integer,
  potential_value numeric,             -- estimated annual subscription value (forecast, never revenue)
  expected_close date,
  next_action text,
  next_action_at date,
  -- approved pricing chosen for the deal + recorded requirements
  plan_tier text check (plan_tier in ('owner_managed', 'corvusrf_managed')),
  billing_interval text check (billing_interval in ('month', 'year')),
  requirements jsonb not null default '{}',   -- {multipleUsers, centralizedBilling, notes}
  -- verified milestones
  agreement_verified_at timestamptz,
  agreement_verified_by uuid,
  agreement_evidence text,
  payment_verified_at timestamptz,
  payment_evidence text,
  partner_id uuid,
  source_channel text,                  -- research | marketing | partner | inbound | outbound | event | other
  created_by uuid,
  last_activity_at timestamptz
);
create index if not exists bd_opportunities_stage_idx on public.bd_opportunities (stage, expected_close);
create index if not exists bd_opportunities_account_idx on public.bd_opportunities (account_id);
alter table public.bd_opportunities enable row level security;
drop policy if exists "BD manages opportunities" on public.bd_opportunities;
create policy "BD manages opportunities" on public.bd_opportunities for all to authenticated
  using ((select public.is_bd_admin())) with check ((select public.is_bd_admin()));
revoke all on public.bd_opportunities from anon;
grant select, insert, update on public.bd_opportunities to authenticated;
-- verification columns are written only by bd_verify_*()
revoke update on public.bd_opportunities from authenticated;
grant update (account_id, primary_lead_id, title, kind, stage, stage_reason, resume_stage, assigned_to, est_property_count,
  potential_value, expected_close, next_action, next_action_at, plan_tier, billing_interval, requirements, partner_id,
  source_channel, last_activity_at) on public.bd_opportunities to authenticated;

create or replace function public.bd_opportunity_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.assigned_to := coalesce(new.assigned_to, auth.uid());
  end if;
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    new.stage_changed_at := now();
    if new.stage in ('on_hold', 'lost') and length(trim(coalesce(new.stage_reason, ''))) < 3 then
      raise exception 'Say why the opportunity is %', replace(new.stage, '_', ' ') using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' and new.stage = 'on_hold' then new.resume_stage := old.stage; end if;
    -- milestones need verification, not a click
    if new.stage in ('activation', 'active') and new.agreement_verified_at is null then
      raise exception 'The agreement isn''t verified yet — a signed proposal (or a verified signed copy) is needed first' using errcode = '23514';
    end if;
    if new.stage = 'active' and new.payment_verified_at is null then
      raise exception 'Payment isn''t verified yet — the customer needs a paid subscription first' using errcode = '23514';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists bd_opportunity_rules on public.bd_opportunities;
create trigger bd_opportunity_rules before insert or update on public.bd_opportunities
  for each row execute function public.bd_opportunity_rules();

create or replace function public.bd_opportunity_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_lead uuid := new.primary_lead_id; v_profile uuid;
begin
  select profile_id into v_profile from public.marketing_leads where id = v_lead;
  if tg_op = 'INSERT' then
    perform public.log_record_event('business_development', 'opportunity', new.id, 'opportunity_created',
      format('Opportunity created: %s', new.title), v_profile, v_lead);
  elsif new.stage is distinct from old.stage then
    perform public.log_record_event('business_development', 'opportunity', new.id, 'stage_changed',
      format('%s: %s → %s%s', new.title, replace(old.stage, '_', ' '), replace(new.stage, '_', ' '),
             case when new.stage in ('on_hold', 'lost') then ' (' || new.stage_reason || ')' else '' end),
      v_profile, v_lead, null, null, jsonb_build_object('stage', old.stage), jsonb_build_object('stage', new.stage));
  elsif new.assigned_to is distinct from old.assigned_to then
    perform public.log_record_event('business_development', 'opportunity', new.id, 'assigned',
      format('%s assigned to %s', new.title, coalesce(public.actor_label(new.assigned_to), 'nobody')), v_profile, v_lead);
  end if;
  return new;
end; $$;
drop trigger if exists bd_opportunity_log on public.bd_opportunities;
create trigger bd_opportunity_log after insert or update on public.bd_opportunities
  for each row execute function public.bd_opportunity_log();

-- the customer's account behind an opportunity (registered contact of the org)
create or replace function public.bd_opportunity_profile(p_opp uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select l.profile_id from public.bd_opportunities o join public.marketing_leads l on l.id = o.primary_lead_id where o.id = p_opp and l.profile_id is not null),
    (select l.profile_id from public.bd_opportunities o join public.marketing_leads l on l.account_id = o.account_id
      where o.id = p_opp and l.profile_id is not null order by l.decision_maker desc, l.created_at limit 1));
$$;
revoke all on function public.bd_opportunity_profile(uuid) from public, anon, authenticated;

-- Agreement: a signed proposal on this opportunity, or a Super Admin /
-- supervisor confirming a signed copy they've seen (with what it is).
create or replace function public.bd_verify_agreement(p_opp uuid, p_evidence text default null) returns text
language plpgsql security definer set search_path = public as $$
declare v_sig record;
begin
  if not public.is_bd_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  select id, version, signed_at, signer_name into v_sig from public.bd_proposals
   where opportunity_id = p_opp and status = 'signed' order by signed_at desc limit 1;
  if v_sig.id is not null then
    update public.bd_opportunities set agreement_verified_at = v_sig.signed_at, agreement_verified_by = auth.uid(),
      agreement_evidence = format('Proposal v%s signed by %s', v_sig.version, v_sig.signer_name) where id = p_opp;
  elsif public.is_bd_supervisor() and length(trim(coalesce(p_evidence, ''))) >= 10 then
    update public.bd_opportunities set agreement_verified_at = now(), agreement_verified_by = auth.uid(),
      agreement_evidence = 'Verified signed copy: ' || trim(p_evidence) where id = p_opp;
  else
    raise exception 'No signed proposal on this opportunity. A supervisor can verify a signed copy (describe it).' using errcode = '23514';
  end if;
  perform public.log_record_event('business_development', 'opportunity', p_opp, 'agreement_verified',
    (select format('Agreement verified — %s', agreement_evidence) from public.bd_opportunities where id = p_opp));
  return (select agreement_evidence from public.bd_opportunities where id = p_opp);
end; $$;
revoke all on function public.bd_verify_agreement(uuid, text) from public, anon;
grant execute on function public.bd_verify_agreement(uuid, text) to authenticated;

-- Payment: the customer's account has a paid, live subscription.
create or replace function public.bd_verify_payment(p_opp uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_profile uuid; v_n int;
begin
  if not public.is_bd_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  v_profile := public.bd_opportunity_profile(p_opp);
  if v_profile is null then raise exception 'The customer hasn''t registered yet — no account to check.' using errcode = '23514'; end if;
  select count(*) into v_n from public.properties where user_id = v_profile and subscription_status in ('active', 'trialing');
  if v_n = 0 then raise exception 'No paid subscription on the customer''s account yet.' using errcode = '23514'; end if;
  update public.bd_opportunities set payment_verified_at = now(),
    payment_evidence = format('%s subscribed propert%s on the customer account', v_n, case when v_n = 1 then 'y' else 'ies' end)
   where id = p_opp;
  perform public.log_record_event('business_development', 'opportunity', p_opp, 'payment_verified',
    format('Payment verified — %s subscribed propert%s', v_n, case when v_n = 1 then 'y' else 'ies' end), v_profile);
  return format('%s subscribed', v_n);
end; $$;
revoke all on function public.bd_verify_payment(uuid) from public, anon;
grant execute on function public.bd_verify_payment(uuid) to authenticated;

-- ── follow-ups & communication ─────────────────────────────────────────────
create table if not exists public.bd_activities (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  account_id uuid references public.crm_accounts (id) on delete cascade,
  opportunity_id uuid references public.bd_opportunities (id) on delete cascade,
  lead_id uuid references public.marketing_leads (id) on delete set null,
  kind text not null check (kind in ('call', 'meeting', 'demo', 'proposal_reminder', 'relationship_review', 'email', 'note')),
  subject text not null,
  due_at timestamptz,
  owner uuid references public.profiles (id) on delete set null,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  status text not null default 'planned' check (status in ('planned', 'done', 'missed', 'canceled')),
  outcome text,
  notes text,
  ai_summary text,
  completed_at timestamptz,
  created_by uuid,
  check (account_id is not null or opportunity_id is not null)
);
create index if not exists bd_activities_due_idx on public.bd_activities (status, due_at);
alter table public.bd_activities enable row level security;
drop policy if exists "BD manages activities" on public.bd_activities;
create policy "BD manages activities" on public.bd_activities for all to authenticated
  using ((select public.is_bd_admin())) with check ((select public.is_bd_admin()));
revoke all on public.bd_activities from anon;
grant select, insert, update on public.bd_activities to authenticated;

create or replace function public.bd_activity_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.owner := coalesce(new.owner, auth.uid());
    if new.account_id is null then
      select account_id into new.account_id from public.bd_opportunities where id = new.opportunity_id;
    end if;
  end if;
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.completed_at := now();
    if new.opportunity_id is not null then
      update public.bd_opportunities set last_activity_at = now() where id = new.opportunity_id;
    end if;
    -- communication history in the shared CRM (Marketing sees it too)
    if new.lead_id is not null then
      insert into public.marketing_activities (lead_id, kind, summary, body, created_by, outcome)
      values (new.lead_id, 'bd_' || new.kind, left(new.subject, 200), coalesce(new.ai_summary, new.notes), auth.uid(), new.outcome);
    end if;
    perform public.log_record_event('business_development', 'activity', new.id, 'activity_done',
      format('%s done: %s%s', initcap(replace(new.kind, '_', ' ')), new.subject, coalesce(' — ' || new.outcome, '')),
      (select profile_id from public.marketing_leads where id = new.lead_id), new.lead_id);
  end if;
  return new;
end; $$;
drop trigger if exists bd_activity_rules on public.bd_activities;
create trigger bd_activity_rules before insert or update on public.bd_activities
  for each row execute function public.bd_activity_rules();

-- ── proposals ──────────────────────────────────────────────────────────────
create table if not exists public.bd_proposal_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'portfolio' check (kind in ('portfolio', 'enterprise', 'partnership', 'referral_partner', 'single_property')),
  intro text not null,
  product text not null,       -- approved product description
  terms text not null,         -- approved subscription terms
  approved boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.bd_proposal_templates enable row level security;
drop policy if exists "BD reads templates" on public.bd_proposal_templates;
create policy "BD reads templates" on public.bd_proposal_templates for select to authenticated using ((select public.is_bd_admin()));
drop policy if exists "Super Admins manage BD templates" on public.bd_proposal_templates;
create policy "Super Admins manage BD templates" on public.bd_proposal_templates for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.bd_proposal_templates from anon;
grant select, insert, update on public.bd_proposal_templates to authenticated;

insert into public.bd_proposal_templates (name, kind, intro, product, terms)
select * from (values
  ('Portfolio proposal', 'portfolio',
   'CorvusPT helps owners of Texas commercial property portfolios lower their property taxes, with AI-prepared evidence for every property and every county in one place.',
   E'For each property: AI review of the appraised value against comparable sales and equity comps; a hearing-ready evidence packet; deadline tracking for protests, hearings and tax payments across every county; Pay Taxes (bills, half-payment plans, county payment links). Owner-Managed: you file and attend with AI-prepared evidence and step-by-step instructions. Corvus-Managed: CorvusPT''s team files, communicates with the county and represents you at the hearing.',
   E'Owner-Managed $199 per property per month; Corvus-Managed $299 per property per month. Each additional property in the same value bracket is 15% off. Monthly plans have a 12-month commitment: once 13 months are complete you can give notice to cancel and the plan ends 60 days later. Yearly plans are paid upfront with 50% off the first year. Properties valued over $5M are priced individually. Savings are never guaranteed.'),
  ('Referral partner agreement', 'referral_partner',
   'A referral partnership with CorvusPT: introduce property owners who could benefit from a property-tax review, and we track every introduction.',
   E'Partners get an approved referral link and code, a named partner manager, and a record of every referred prospect, conversion and the subscriptions they generate.',
   E'Compensation, if any, is set out in a separate signed partner agreement and paid only as that agreement states, after approval. Referred customers sign CorvusPT''s standard terms.')
) v(name, kind, intro, product, terms)
where not exists (select 1 from public.bd_proposal_templates);

create table if not exists public.bd_proposals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  opportunity_id uuid not null references public.bd_opportunities (id) on delete cascade,
  version integer not null default 1,
  parent_id uuid references public.bd_proposals (id) on delete set null,
  template_id uuid references public.bd_proposal_templates (id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'pending_approval', 'approved', 'sent', 'superseded', 'accepted', 'signed', 'declined')),
  title text not null,
  body text not null,                      -- the proposal text (markdown)
  -- {tier, interval, properties, discountPct, commitmentMonths, customTerms}
  pricing jsonb not null default '{}',
  deviations jsonb not null default '[]',  -- departures from approved terms [{field, detail}]
  approval_id uuid,
  approved_at timestamptz,
  sent_to text,
  sent_at timestamptz,
  viewed_at timestamptz,
  signer_name text,
  signer_title text,
  signed_at timestamptz,
  declined_reason text,
  token text unique default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  created_by uuid
);
create index if not exists bd_proposals_opp_idx on public.bd_proposals (opportunity_id, version desc);
alter table public.bd_proposals enable row level security;
drop policy if exists "BD manages proposals" on public.bd_proposals;
create policy "BD manages proposals" on public.bd_proposals for all to authenticated
  using ((select public.is_bd_admin())) with check ((select public.is_bd_admin()));
revoke all on public.bd_proposals from anon;
grant select, insert on public.bd_proposals to authenticated;
-- status, approval and signing move only through the bd-console function
grant update (title, body, pricing, template_id, updated_at) on public.bd_proposals to authenticated;

create or replace function public.bd_proposal_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    select coalesce(max(version), 0) + 1 into new.version from public.bd_proposals where opportunity_id = new.opportunity_id;
    -- the previous version is kept, marked superseded
    update public.bd_proposals set status = 'superseded'
     where opportunity_id = new.opportunity_id and status in ('draft', 'pending_approval', 'approved', 'sent');
  elsif (new.body, new.pricing) is distinct from (old.body, old.pricing) then
    if old.status not in ('draft', 'pending_approval', 'approved') then
      raise exception 'A sent proposal can''t be edited — create a revision' using errcode = '23514';
    end if;
    -- any edit after approval needs the approval again
    if old.status in ('approved', 'pending_approval') then new.status := 'draft'; new.approved_at := null; new.approval_id := null; end if;
  end if;
  return new;
end; $$;
drop trigger if exists bd_proposal_rules on public.bd_proposals;
create trigger bd_proposal_rules before insert or update on public.bd_proposals
  for each row execute function public.bd_proposal_rules();

create or replace function public.bd_proposal_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_opp record;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  select o.title, o.primary_lead_id, l.profile_id into v_opp
    from public.bd_opportunities o left join public.marketing_leads l on l.id = o.primary_lead_id where o.id = new.opportunity_id;
  perform public.log_record_event('business_development', 'proposal', new.id,
    'proposal_' || new.status, format('%s — proposal v%s %s', v_opp.title, new.version, replace(new.status, '_', ' ')),
    v_opp.profile_id, v_opp.primary_lead_id);
  return new;
end; $$;
drop trigger if exists bd_proposal_log on public.bd_proposals;
create trigger bd_proposal_log after insert or update on public.bd_proposals
  for each row execute function public.bd_proposal_log();

-- ── referral partners ──────────────────────────────────────────────────────
create table if not exists public.bd_partners (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  account_id uuid not null unique references public.crm_accounts (id) on delete cascade,
  category text not null default 'referral' check (category in ('referral', 'broker', 'management_company', 'consultant', 'association', 'other')),
  manager uuid references public.profiles (id) on delete set null,
  agreement_status text not null default 'none' check (agreement_status in ('none', 'proposed', 'signed', 'terminated')),
  agreement_proposal_id uuid references public.bd_proposals (id) on delete set null,
  agreement_signed_at timestamptz,
  agreement_terms text,                 -- the approved compensation terms, if any
  referral_code text unique not null default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  notes text
);
alter table public.bd_partners enable row level security;
drop policy if exists "BD manages partners" on public.bd_partners;
create policy "BD manages partners" on public.bd_partners for all to authenticated
  using ((select public.is_bd_admin())) with check ((select public.is_bd_admin()));
revoke all on public.bd_partners from anon;
grant select, insert, update on public.bd_partners to authenticated;

-- one attribution per prospect, so revenue is never counted twice
create table if not exists public.bd_partner_referrals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  partner_id uuid not null references public.bd_partners (id) on delete cascade,
  lead_id uuid not null unique references public.marketing_leads (id) on delete cascade,
  method text not null check (method in ('link', 'code', 'introduction')),
  recorded_by uuid,
  note text
);
alter table public.bd_partner_referrals enable row level security;
drop policy if exists "BD manages referrals" on public.bd_partner_referrals;
create policy "BD manages referrals" on public.bd_partner_referrals for all to authenticated
  using ((select public.is_bd_admin())) with check ((select public.is_bd_admin()));
revoke all on public.bd_partner_referrals from anon;
grant select, insert, delete on public.bd_partner_referrals to authenticated;

-- compensation is only recorded under a signed agreement; paying it is a
-- separate Super Admin approval (approval_requests kind partner_payout)
create table if not exists public.bd_partner_commissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  partner_id uuid not null references public.bd_partners (id) on delete cascade,
  referral_id uuid references public.bd_partner_referrals (id) on delete set null,
  amount numeric not null check (amount > 0),
  basis text not null,
  status text not null default 'recorded' check (status in ('recorded', 'payout_requested', 'approved', 'paid', 'rejected')),
  approval_id uuid,
  recorded_by uuid
);
alter table public.bd_partner_commissions enable row level security;
drop policy if exists "BD records commissions" on public.bd_partner_commissions;
create policy "BD records commissions" on public.bd_partner_commissions for select to authenticated using ((select public.is_bd_admin()));
drop policy if exists "BD inserts commissions" on public.bd_partner_commissions;
create policy "BD inserts commissions" on public.bd_partner_commissions for insert to authenticated with check ((select public.is_bd_admin()));
revoke all on public.bd_partner_commissions from anon;
grant select, insert on public.bd_partner_commissions to authenticated;

create or replace function public.bd_commission_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.bd_partners where id = new.partner_id and agreement_status = 'signed') then
    raise exception 'Compensation can only be recorded for a partner with a signed agreement' using errcode = '23514';
  end if;
  new.recorded_by := coalesce(new.recorded_by, auth.uid());
  new.status := 'recorded';
  return new;
end; $$;
drop trigger if exists bd_commission_rules on public.bd_partner_commissions;
create trigger bd_commission_rules before insert on public.bd_partner_commissions
  for each row execute function public.bd_commission_rules();

-- a partner's agreement counts as signed only via a signed proposal (or a
-- Super Admin) — not by editing the status
create or replace function public.bd_partner_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.agreement_status = 'signed' and (tg_op = 'INSERT' or old.agreement_status <> 'signed') then
    if not (public.is_admin() or exists (select 1 from public.bd_proposals p where p.id = new.agreement_proposal_id and p.status = 'signed')) then
      raise exception 'A partner agreement is signed only through a signed proposal (or by a Super Admin)' using errcode = '23514';
    end if;
    new.agreement_signed_at := coalesce(new.agreement_signed_at, now());
  end if;
  return new;
end; $$;
drop trigger if exists bd_partner_rules on public.bd_partners;
create trigger bd_partner_rules before insert or update on public.bd_partners
  for each row execute function public.bd_partner_rules();

-- ── research ───────────────────────────────────────────────────────────────
create table if not exists public.bd_research (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  requested_by uuid,
  params jsonb not null,                -- {mode, county, propertyType, minProperties, organization, url, partnerCategory}
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  findings jsonb not null default '[]', -- [{name, kind, properties, value, counties, decisionMakers, ownership, whyCorvus, sources, assumptions, reviewed, accountId}]
  summary text,
  sources jsonb not null default '[]',
  coverage_note text,
  error text,
  researched_at timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz
);
alter table public.bd_research enable row level security;
drop policy if exists "BD manages research" on public.bd_research;
create policy "BD manages research" on public.bd_research for all to authenticated
  using ((select public.is_bd_admin())) with check ((select public.is_bd_admin()));
revoke all on public.bd_research from anon;
grant select, update on public.bd_research to authenticated;

-- features a prospect asked for that the product doesn't have — recorded, never promised
create table if not exists public.product_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  department text not null default 'business_development',
  account_id uuid references public.crm_accounts (id) on delete set null,
  opportunity_id uuid references public.bd_opportunities (id) on delete set null,
  feature text not null,
  detail text,
  status text not null default 'new' check (status in ('new', 'planned', 'declined', 'shipped')),
  created_by uuid default auth.uid()
);
alter table public.product_requests enable row level security;
drop policy if exists "Staff read and add product requests" on public.product_requests;
create policy "Staff read and add product requests" on public.product_requests for select to authenticated using ((select public.is_staff()));
drop policy if exists "Staff add product requests" on public.product_requests;
create policy "Staff add product requests" on public.product_requests for insert to authenticated with check ((select public.is_staff()));
drop policy if exists "Super Admins update product requests" on public.product_requests;
create policy "Super Admins update product requests" on public.product_requests for update to authenticated using ((select public.is_admin()));
revoke all on public.product_requests from anon;
grant select, insert, update on public.product_requests to authenticated;

-- ── handoff to Customer Support (the existing handoff, one per customer) ───
alter table public.support_handoffs add column if not exists source text not null default 'marketing';
alter table public.support_handoffs add column if not exists bd_opportunity_id uuid references public.bd_opportunities (id) on delete set null;
alter table public.support_handoffs add column if not exists bd_details jsonb;
drop policy if exists "BD reads its handoffs" on public.support_handoffs;
create policy "BD reads its handoffs" on public.support_handoffs for select to authenticated
  using ((select public.is_bd_admin()) and bd_opportunity_id is not null);

create or replace function public.bd_handoff_to_support(p_opp uuid, p_owner uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare o public.bd_opportunities; v_lead uuid; v_profile uuid; v_id uuid; v_details jsonb;
begin
  if not public.is_bd_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into o from public.bd_opportunities where id = p_opp;
  if o.agreement_verified_at is null then
    raise exception 'Hand off once the agreement is verified' using errcode = '23514';
  end if;
  v_profile := public.bd_opportunity_profile(p_opp);
  if v_profile is null then
    raise exception 'The customer hasn''t registered yet — invite their contact first, then hand off' using errcode = '23514';
  end if;
  select id into v_lead from public.marketing_leads where profile_id = v_profile order by (id = o.primary_lead_id) desc, created_at limit 1;
  if p_owner is not null and not exists (select 1 from public.profiles where id = p_owner and (support_admin or is_admin)) then
    raise exception 'The receiving owner must be on the Support team';
  end if;
  v_details := jsonb_build_object(
    'opportunity', o.title,
    'relationshipOwner', public.actor_label((select relationship_owner from public.crm_accounts where id = o.account_id)),
    'bdOwner', public.actor_label(o.assigned_to),
    'organization', (select name from public.crm_accounts where id = o.account_id),
    'authorizedContacts', coalesce((select jsonb_agg(jsonb_build_object('name', l.full_name, 'email', l.email, 'phone', l.phone,
        'title', l.title, 'decisionMaker', l.decision_maker) order by l.decision_maker desc)
      from public.marketing_leads l where l.account_id = o.account_id and l.dnc_at is null), '[]'),
    'agreement', o.agreement_evidence,
    'agreementVerifiedAt', o.agreement_verified_at,
    'plan', jsonb_build_object('tier', o.plan_tier, 'interval', o.billing_interval),
    'requirements', o.requirements,
    'commitments', (select pricing->'customTerms' from public.bd_proposals where opportunity_id = p_opp and status = 'signed' order by signed_at desc limit 1),
    'subscribedProperties', (select count(*) from public.properties where user_id = v_profile and subscription_status in ('active', 'trialing', 'past_due')),
    'registeredProperties', (select count(*) from public.properties where user_id = v_profile),
    'estimatedProperties', o.est_property_count,
    'billingStatus', (select subscription_status from public.profiles where id = v_profile),
    'outstanding', public.support_onboarding_steps(v_profile));
  insert into public.support_handoffs (lead_id, profile_id, status, assigned_to, snapshot, source, bd_opportunity_id, bd_details)
  values (v_lead, v_profile, 'open', p_owner, public.marketing_customer_snapshot(v_profile), 'business_development', p_opp, v_details)
  on conflict (lead_id) do update set
    profile_id = excluded.profile_id, source = 'business_development', bd_opportunity_id = p_opp, bd_details = v_details,
    assigned_to = coalesce(excluded.assigned_to, public.support_handoffs.assigned_to),
    status = case when public.support_handoffs.status = 'done' then 'open' else public.support_handoffs.status end,
    snapshot = excluded.snapshot
  returning id into v_id;
  perform public.log_record_event('shared', 'onboarding', v_id, 'bd_handoff',
    format('%s handed to Customer Support%s', o.title, coalesce(' — ' || public.actor_label(p_owner), '')), v_profile, v_lead);
  return v_id;
end; $$;
revoke all on function public.bd_handoff_to_support(uuid, uuid) from public, anon;
grant execute on function public.bd_handoff_to_support(uuid, uuid) to authenticated;

-- ── lists / dashboard / analytics ──────────────────────────────────────────
create or replace function public.bd_team() returns table (id uuid, name text, supervisor boolean, super_admin boolean)
language sql stable security definer set search_path = public as $$
  select p.id, public.actor_label(p.id), p.bd_supervisor, p.is_admin
  from public.profiles p where (p.bd_admin or p.is_admin) and public.is_bd_admin() order by 2;
$$;
revoke all on function public.bd_team() from public, anon;
grant execute on function public.bd_team() to authenticated;

create or replace function public.bd_accounts() returns table (
  id uuid, name text, kind text, website text, counties text[], relationship_owner uuid, owner_label text,
  contacts integer, decision_makers integer, prospect_properties integer, registered_properties integer,
  subscribed_properties integer, open_opportunities integer, pipeline_value numeric, partner boolean,
  last_contact timestamptz, duplicate_of_name text, updated_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_bd_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  return query
  select a.id, a.name, a.kind, a.website, a.counties, a.relationship_owner, public.actor_label(a.relationship_owner),
    (select count(*)::int from public.marketing_leads l where l.account_id = a.id),
    (select count(*)::int from public.marketing_leads l where l.account_id = a.id and l.decision_maker),
    (select count(*)::int from public.marketing_lead_properties lp join public.marketing_leads l on l.id = lp.lead_id where l.account_id = a.id),
    (select count(*)::int from public.properties p join public.marketing_leads l on l.profile_id = p.user_id where l.account_id = a.id),
    (select count(*)::int from public.properties p join public.marketing_leads l on l.profile_id = p.user_id where l.account_id = a.id and p.subscription_status in ('active', 'trialing', 'past_due')),
    (select count(*)::int from public.bd_opportunities o where o.account_id = a.id and o.stage not in ('active', 'lost')),
    (select coalesce(sum(o.potential_value), 0) from public.bd_opportunities o where o.account_id = a.id and o.stage not in ('active', 'lost', 'on_hold')),
    exists (select 1 from public.bd_partners pa where pa.account_id = a.id),
    (select max(x.at) from (
       select ma.created_at at from public.marketing_activities ma join public.marketing_leads l on l.id = ma.lead_id where l.account_id = a.id
       union all select ba.completed_at from public.bd_activities ba where ba.account_id = a.id) x),
    (select b.name from public.crm_accounts b where b.dedupe_key = a.dedupe_key and b.id <> a.id and b.merged_into is null and (b.created_at, b.id) < (a.created_at, a.id) order by b.created_at limit 1),
    a.updated_at
  from public.crm_accounts a where a.merged_into is null
  order by a.updated_at desc;
end; $$;
revoke all on function public.bd_accounts() from public, anon;
grant execute on function public.bd_accounts() to authenticated;

create or replace function public.bd_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_bd_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  with o as (select * from public.bd_opportunities where stage not in ('active', 'lost'))
  select jsonb_build_object(
    'activeOpportunities', (select count(*) from o where stage <> 'on_hold'),
    'onHold', (select count(*) from o where stage = 'on_hold'),
    'pipelineValue', (select coalesce(sum(potential_value), 0) from o where stage <> 'on_hold'),
    'weightedValue', (select coalesce(round(sum(potential_value * case stage when 'identification' then 0.05 when 'qualification' then 0.1
        when 'meeting' then 0.2 when 'proposal' then 0.4 when 'negotiation' then 0.6 when 'agreement' then 0.8 when 'activation' then 0.9 else 0 end)), 0) from o),
    'pendingProposals', (select count(*) from public.bd_proposals where status in ('draft', 'pending_approval', 'approved', 'sent')),
    'awaitingApproval', (select count(*) from public.bd_proposals where status = 'pending_approval'),
    'upcomingMeetings', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'subject', a.subject, 'kind', a.kind, 'dueAt', a.due_at,
        'opportunityId', a.opportunity_id, 'accountId', a.account_id, 'account', (select name from public.crm_accounts where id = a.account_id),
        'owner', public.actor_label(a.owner)) order by a.due_at)
      from public.bd_activities a where a.status = 'planned' and a.kind in ('meeting', 'demo', 'call') and a.due_at between now() and now() + interval '14 days'), '[]'),
    'overdue', coalesce((select jsonb_agg(x order by x->>'due') from (
        select jsonb_build_object('kind', 'activity', 'id', a.id, 'label', a.subject, 'due', a.due_at, 'opportunityId', a.opportunity_id,
          'accountId', a.account_id, 'owner', public.actor_label(a.owner)) x
        from public.bd_activities a where a.status = 'planned' and a.due_at < now()
        union all
        select jsonb_build_object('kind', 'next_action', 'id', o.id, 'label', o.title || ' — ' || coalesce(o.next_action, 'next action'),
          'due', o.next_action_at, 'opportunityId', o.id, 'accountId', o.account_id, 'owner', public.actor_label(o.assigned_to))
        from o where o.next_action_at < current_date and o.stage <> 'on_hold'
      ) z), '[]'),
    'stalled', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title, 'stage', o.stage,
        'days', (current_date - greatest(o.stage_changed_at, coalesce(o.last_activity_at, o.stage_changed_at))::date),
        'accountId', o.account_id) order by o.stage_changed_at)
      from o where o.stage not in ('on_hold') and greatest(o.stage_changed_at, coalesce(o.last_activity_at, o.stage_changed_at)) < now() - interval '21 days'), '[]'),
    'byStage', coalesce((select jsonb_object_agg(stage, n) from (select stage, count(*) n from public.bd_opportunities group by 1) s), '{}')
  ) into v;
  return v;
end; $$;
revoke all on function public.bd_dashboard() from public, anon;
grant execute on function public.bd_dashboard() to authenticated;

-- Forecast (estimated) and actual (subscriptions / payments) kept apart;
-- actual revenue counts each customer account once, however many
-- opportunities or partners touched it.
create or replace function public.bd_analytics(p_from date, p_to date, p_staff uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_to timestamptz := (p_to + 1)::timestamptz;
begin
  if not public.is_bd_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  if not public.is_bd_supervisor() then p_staff := auth.uid(); end if;
  with o as (select * from public.bd_opportunities where (p_staff is null or assigned_to = p_staff)),
  won as (select * from o where stage = 'active' and payment_verified_at >= p_from and payment_verified_at < v_to),
  won_profiles as (select distinct public.bd_opportunity_profile(id) pid from o where stage in ('activation', 'active')),
  pr as (select p.* from public.bd_proposals p join o on o.id = p.opportunity_id where p.created_at >= p_from and p.created_at < v_to),
  partner_profiles as (
    select pa.id partner_id, l.profile_id pid from public.bd_partner_referrals r
    join public.bd_partners pa on pa.id = r.partner_id join public.marketing_leads l on l.id = r.lead_id where l.profile_id is not null)
  select jsonb_build_object(
    'forecast', jsonb_build_object(
      'openPipeline', (select coalesce(sum(potential_value), 0) from o where stage not in ('active', 'lost', 'on_hold')),
      'expectedInRange', (select coalesce(sum(potential_value), 0) from o where stage not in ('active', 'lost', 'on_hold') and expected_close between p_from and p_to),
      'estimatedProperties', (select coalesce(sum(est_property_count), 0) from o where stage not in ('lost'))),
    'actual', jsonb_build_object(
      'subscribedProperties', (select count(*) from public.properties p where p.user_id in (select pid from won_profiles where pid is not null)
                                and p.subscription_status in ('active', 'trialing', 'past_due')),
      'registeredProperties', (select count(*) from public.properties p where p.user_id in (select pid from won_profiles where pid is not null)),
      'confirmedRevenueCents', (select coalesce(sum(amount_cents), 0) from public.subscription_events se
                                 where se.kind = 'renewed' and se.created_at >= p_from and se.created_at < v_to
                                   and se.profile_id in (select pid from won_profiles where pid is not null)),
      'customersActivated', (select count(*) from won)),
    'byStage', coalesce((select jsonb_object_agg(stage, n) from (select stage, count(*) n from o group by 1) s), '{}'),
    'lostReasons', coalesce((select jsonb_agg(jsonb_build_object('reason', stage_reason, 'n', n)) from
        (select stage_reason, count(*) n from o where stage = 'lost' and stage_changed_at >= p_from and stage_changed_at < v_to group by 1 order by 2 desc limit 8) r), '[]'),
    'proposals', jsonb_build_object('created', (select count(*) from pr), 'sent', (select count(*) from pr where sent_at is not null),
        'accepted', (select count(*) from pr where status in ('accepted', 'signed')), 'declined', (select count(*) from pr where status = 'declined')),
    'avgSalesCycleDays', (select round(avg(extract(epoch from payment_verified_at - created_at) / 86400)) from won),
    'byChannel', coalesce((select jsonb_object_agg(coalesce(source_channel, 'unknown'), jsonb_build_object('opportunities', n, 'won', w)) from
        (select source_channel, count(*) n, count(*) filter (where stage = 'active') w from o group by 1) c), '{}'),
    'partners', coalesce((select jsonb_agg(jsonb_build_object('id', pa.id, 'name', a.name, 'agreement', pa.agreement_status,
        'manager', public.actor_label(pa.manager),
        'referred', (select count(*) from public.bd_partner_referrals r where r.partner_id = pa.id),
        'converted', (select count(*) from partner_profiles pp where pp.partner_id = pa.id),
        'subscribedProperties', (select count(*) from public.properties p where p.user_id in (select pid from partner_profiles pp where pp.partner_id = pa.id)
                                  and p.subscription_status in ('active', 'trialing', 'past_due')),
        'revenueCents', (select coalesce(sum(se.amount_cents), 0) from public.subscription_events se where se.kind = 'renewed'
                          and se.created_at >= p_from and se.created_at < v_to
                          and se.profile_id in (select pid from partner_profiles pp where pp.partner_id = pa.id)),
        'lastReferral', (select max(created_at) from public.bd_partner_referrals r where r.partner_id = pa.id)) order by a.name)
      from public.bd_partners pa join public.crm_accounts a on a.id = pa.account_id), '[]'),
    'workload', case when public.is_bd_supervisor() then coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', public.actor_label(s.id),
        'open', (select count(*) from public.bd_opportunities x where x.assigned_to = s.id and x.stage not in ('active', 'lost')),
        'pipeline', (select coalesce(sum(potential_value), 0) from public.bd_opportunities x where x.assigned_to = s.id and x.stage not in ('active', 'lost', 'on_hold')),
        'overdue', (select count(*) from public.bd_activities a where a.owner = s.id and a.status = 'planned' and a.due_at < now())
                   + (select count(*) from public.bd_opportunities x where x.assigned_to = s.id and x.next_action_at < current_date and x.stage not in ('active', 'lost', 'on_hold')),
        'accounts', (select count(*) from public.crm_accounts a where a.relationship_owner = s.id and a.merged_into is null)) order by 2)
      from public.profiles s where s.bd_admin or s.is_admin), '[]') else '[]' end
  ) into v;
  return v;
end; $$;
revoke all on function public.bd_analytics(date, date, uuid) from public, anon;
grant execute on function public.bd_analytics(date, date, uuid) to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'bd_opportunities') then
    alter publication supabase_realtime add table public.bd_opportunities;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'bd_activities') then
    alter publication supabase_realtime add table public.bd_activities;
  end if;
end $$;

-- CRM contacts created by Business Development / referral partners
alter table public.marketing_leads drop constraint if exists marketing_leads_source_check;
alter table public.marketing_leads add constraint marketing_leads_source_check check (source in
  ('invited', 'manual', 'beta_signup', 'registered', 'referral', 'website', 'import', 'event', 'podio', 'research', 'business_development', 'partner'));

-- Referral link (?partner=CODE): once the visitor has an account, their own
-- CRM record is attributed to the partner — one attribution, never overwritten.
create or replace function public.bd_attribute_partner(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_partner uuid; v_lead uuid;
begin
  if auth.uid() is null then return false; end if;
  select id into v_partner from public.bd_partners where referral_code = upper(trim(p_code)) and agreement_status <> 'terminated';
  if v_partner is null then return false; end if;
  select id into v_lead from public.marketing_leads where profile_id = auth.uid() order by created_at limit 1;
  if v_lead is null then return false; end if;
  insert into public.bd_partner_referrals (partner_id, lead_id, method, note)
  values (v_partner, v_lead, 'link', 'Signed up through the partner link') on conflict (lead_id) do nothing;
  return found;
end; $$;
revoke all on function public.bd_attribute_partner(text) from public, anon;
grant execute on function public.bd_attribute_partner(text) to authenticated;
