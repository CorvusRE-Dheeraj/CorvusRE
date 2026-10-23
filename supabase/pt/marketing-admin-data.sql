-- Marketing Admin ← existing Admin data (2026-10-20).
-- Marketing staff get READ-ONLY, marketing-shaped views of Users, Owner
-- Managed, CorvusPT Managed, Invited Users, Beta Signups, Appointments,
-- Beta Feedback and the marketing part of the admin Activity Log, through
-- SECURITY DEFINER functions gated on is_marketing_admin(). The admin tables'
-- own RLS is unchanged, so County Mail, Support, Settings, cases, documents
-- and every admin write stay Super-Admin-only.

alter table public.marketing_leads
  add column if not exists account_plan text,
  add column if not exists invited_user_id uuid,
  add column if not exists invited_at timestamptz;
alter table public.marketing_leads drop constraint marketing_leads_source_check;
alter table public.marketing_leads add constraint marketing_leads_source_check CHECK ((source = ANY (ARRAY['invited'::text, 'manual'::text, 'beta_signup'::text, 'registered'::text, 'referral'::text, 'website'::text, 'import'::text, 'event'::text, 'podio'::text, 'research'::text])));

CREATE OR REPLACE FUNCTION public.marketing_sync_core()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- invited users (Admin → Invited Users): they've been sent a sign-up invite
  insert into public.marketing_leads (full_name, email, source, invited_user_id, invited_at, last_contacted_at, stage, created_at)
  select nullif(trim(concat_ws(' ', i.first_name, i.last_name)), ''), i.email, 'invited', i.id, i.invited_at, coalesce(i.last_sent_at, i.invited_at), 'contacted', i.invited_at
  from public.invited_users i
  where nullif(trim(i.email), '') is not null and i.email not ilike '%@example.com'
  on conflict (email_key) do update
    set invited_user_id = excluded.invited_user_id,
        invited_at = coalesce(marketing_leads.invited_at, excluded.invited_at),
        full_name = coalesce(marketing_leads.full_name, excluded.full_name)
    where marketing_leads.invited_user_id is distinct from excluded.invited_user_id;
  update public.marketing_leads l set invited_user_id = null
   where l.invited_user_id is not null and not exists (select 1 from public.invited_users i where i.id = l.invited_user_id);

  -- the account's plan (Owner Managed / CorvusPT Managed / …)
  update public.marketing_leads l set account_plan = p.plan
    from public.profiles p
   where l.profile_id = p.id and l.account_plan is distinct from p.plan;

  perform set_config('marketing.reason', '', true);
  perform public.marketing_apply_rules(null);
  perform public.marketing_refresh_handoffs();
  return jsonb_build_object('betaSignups', v_beta, 'registeredUsers', v_new, 'matched', v_linked, 'syncedAt', now());
end; $function$;
revoke all on function public.marketing_sync_core() from public, anon, authenticated;
grant execute on function public.marketing_sync_core() to service_role;

-- Dashboard summary: the Admin lists, counted.
create or replace function public.marketing_account_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_marketing_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  with u as (
    select p.*, exists (select 1 from public.properties pr where pr.user_id = p.id and pr.subscription_status in ('active','trialing','past_due'))
              or exists (select 1 from public.bpp_accounts b where b.user_id = p.id and b.subscription_status in ('active','trialing','past_due')) paying
    from public.profiles p
    where not coalesce(p.is_admin, false) and not coalesce(p.marketing_admin, false) and not coalesce(p.support_admin, false)
  )
  select jsonb_build_object(
    'users', (select count(*) from u),
    'usersNew30', (select count(*) from u where created_at > now() - interval '30 days'),
    'paying', (select count(*) from u where paying),
    'ownerManaged', (select count(*) from u where plan = 'owner_managed'),
    'corvusManaged', (select count(*) from u where plan = 'corvusrf_managed'),
    'plans', (select coalesce(jsonb_object_agg(k, n), '{}') from (select coalesce(plan, 'none') k, count(*) n from u group by 1) x),
    'invited', (select count(*) from public.invited_users i where not exists (select 1 from public.profiles p where lower(p.email) = lower(i.email))),
    'invitedTotal', (select count(*) from public.invited_users),
    'beta', (select count(*) from public.beta_leads),
    'betaNotInvited', (select count(*) from public.beta_leads b where b.invited_at is null),
    'betaNotRegistered', (select count(*) from public.beta_leads b where not exists (select 1 from public.profiles p where lower(p.email) = lower(b.work_email))),
    'betaNew30', (select count(*) from public.beta_leads where created_at > now() - interval '30 days'),
    'appointmentsUpcoming', (select count(*) from public.appointments where start_at > now() and coalesce(status, '') <> 'cancelled'),
    'feedbackResponses', (select count(*) from public.beta_feedback_responses where completed_at is not null)
  ) into r;
  return r;
end; $$;

-- Follow-ups: appointments (no manage tokens), matched to leads by email.
create or replace function public.marketing_appointments(p_days int default 120)
returns table (id uuid, lead_id uuid, name text, email text, phone text, meeting_type text, notes text,
               start_at timestamptz, end_at timestamptz, status text, meet_link text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_marketing_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  return query
    select a.id, (select l.id from public.marketing_leads l where l.email_key = lower(trim(a.email)) limit 1),
           a.name, a.email, a.phone, a.meeting_type, a.notes, a.start_at, a.end_at, a.status, a.meet_link, a.created_at
    from public.appointments a
    where a.start_at > now() - make_interval(days => greatest(1, least(p_days, 730)))
    order by a.start_at desc;
end; $$;

-- Analytics: beta feedback (AI insights + completed responses).
create or replace function public.marketing_beta_feedback() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_marketing_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  return jsonb_build_object(
    'insights', (select to_jsonb(i) from public.beta_feedback_insights i order by generated_at desc limit 1),
    'responses', (select coalesce(jsonb_agg(x order by x.completed_at desc), '[]') from (
        select r.completed_at, r.answers, p.email, (select l.id from public.marketing_leads l where l.profile_id = r.user_id limit 1) lead_id
        from public.beta_feedback_responses r left join public.profiles p on p.id = r.user_id
        where r.completed_at is not null order by r.completed_at desc limit 200) x)
  );
end; $$;

-- Analytics: the marketing part of the admin Activity Log (invites, sign-ups,
-- plan changes, removed accounts) — not impersonation, Stripe or case changes.
create or replace function public.marketing_activity_log(p_limit int default 200)
returns table (id uuid, actor_email text, action text, target_email text, detail text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_marketing_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  return query
    select a.id, a.actor_email, a.action, a.target_email, a.detail, a.created_at
    from public.admin_audit_log a
    where a.action in ('send_signup_invite', 'create_user', 'update_plan', 'delete_user', 'grant_marketing_admin', 'revoke_marketing_admin')
    order by a.created_at desc limit greatest(1, least(p_limit, 1000));
end; $$;

revoke all on function public.marketing_account_summary() from public, anon;
revoke all on function public.marketing_appointments(int) from public, anon;
revoke all on function public.marketing_beta_feedback() from public, anon;
revoke all on function public.marketing_activity_log(int) from public, anon;
grant execute on function public.marketing_account_summary() to authenticated;
grant execute on function public.marketing_appointments(int) to authenticated;
grant execute on function public.marketing_beta_feedback() to authenticated;
grant execute on function public.marketing_activity_log(int) to authenticated;

select public.marketing_sync_core();
