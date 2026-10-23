-- AI-powered leads (builds on marketing.sql + marketing-crm.sql):
--   * property assessment facts: previous value + % change, the roll year,
--     when the county record was last read, and the assessment analysis
--   * lead rollups: biggest value change and how many properties are flagged
--   * prospect lists = segments with an approval step
--   * reusable message templates (seeded with defaults), tracked on what they send

-- ── Property assessment facts ───────────────────────────────────────────────
alter table public.marketing_lead_properties
  add column if not exists value_year int,
  add column if not exists prior_year int,
  add column if not exists refreshed_at timestamptz,
  -- {flags:[{kind, level, text}], comps:{count, median, subjectPerAcre, medianPerAcre}, explanation, analyzedAt, sources:[{label, url?}]}
  add column if not exists analysis jsonb,
  add column if not exists analyzed_at timestamptz,
  add column if not exists change_pct numeric generated always as (
    case when prior_value > 0 and assessed_value is not null
      then round((assessed_value / prior_value - 1) * 100, 1) end
  ) stored,
  add column if not exists flagged boolean generated always as (
    coalesce(jsonb_array_length(analysis -> 'flags') > 0, false)
  ) stored;

alter table public.marketing_leads
  add column if not exists max_change_pct numeric,
  add column if not exists flagged_count int not null default 0,
  add column if not exists last_refreshed_at timestamptz;

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
    owner_names = coalesce(l.owner_names, s.top_owner),
    max_change_pct = s.max_change,
    flagged_count = s.flagged,
    last_refreshed_at = s.refreshed
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
           coalesce(min(protest_deadline) filter (where protest_deadline >= current_date), max(protest_deadline)) deadline,
           max(change_pct) max_change,
           (count(*) filter (where flagged))::int flagged,
           max(refreshed_at) refreshed
    from public.marketing_lead_properties where lead_id = p_lead
  ) s
  where l.id = p_lead;
$$;
revoke all on function public.marketing_rollup_lead(uuid) from public, anon, authenticated;
-- backfill the new rollups
select public.marketing_rollup_lead(id) from public.marketing_leads;

-- ── Prospect lists (a segment with an approval step + county) ──────────────
alter table public.marketing_segments
  add column if not exists kind text not null default 'segment' check (kind in ('segment', 'list')),
  add column if not exists status text not null default 'draft' check (status in ('draft', 'approved')),
  add column if not exists county text,
  add column if not exists notes text,
  add column if not exists approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists approved_at timestamptz;

-- ── Message templates ───────────────────────────────────────────────────────
create table if not exists public.marketing_templates (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  objective text not null check (objective in (
    'initial_outreach', 'assessment_increase', 'deadline', 'registration_reminder', 'subscription_promo', 'follow_up')),
  channel text not null default 'email' check (channel in ('email', 'sms')),
  subject text,
  body text not null,
  active boolean not null default true,
  is_default boolean not null default false,
  ai_generated boolean not null default false,
  uses int not null default 0,
  last_used_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null
);
alter table public.marketing_templates enable row level security;
drop policy if exists "Marketing admins manage marketing_templates" on public.marketing_templates;
create policy "Marketing admins manage marketing_templates" on public.marketing_templates for all to authenticated
  using ((select public.is_marketing_admin())) with check ((select public.is_marketing_admin()));
revoke all on public.marketing_templates from anon;
grant select, insert, update, delete on public.marketing_templates to authenticated;
drop trigger if exists marketing_templates_touch on public.marketing_templates;
create trigger marketing_templates_touch before update on public.marketing_templates for each row execute function public.touch_updated_at();

alter table public.marketing_followups add column if not exists template_id uuid references public.marketing_templates(id) on delete set null;
alter table public.marketing_campaigns add column if not exists template_id uuid references public.marketing_templates(id) on delete set null;
alter table public.marketing_activities add column if not exists template_id uuid references public.marketing_templates(id) on delete set null;

-- Defaults. Personalisation tokens: {{first_name}} {{company}} {{property_address}}
-- {{county}} {{property_count}} {{portfolio_value}} {{value_change}} {{protest_deadline}}.
-- Never promise an outcome or a savings amount.
insert into public.marketing_templates (name, objective, channel, subject, body, is_default)
select v.*, true from (values
  ('Initial outreach', 'initial_outreach', 'email',
   'A second look at {{company}}''s property taxes',
   E'Hi {{first_name}},\n\nCorvusPT reviews Texas commercial assessments with AI and shows owners where a value may be too high — for {{property_address}} and the rest of your {{county}} County properties.\n\nYou run the protest yourself with our tools and guidance, and you keep 100% of any tax savings. No contingency fee.\n\nWant me to send a free assessment review for {{property_address}}?\n\nThe CorvusPT team'),
  ('Initial outreach (text)', 'initial_outreach', 'sms', null,
   'Hi {{first_name}}, CorvusPT here. We review Texas commercial property assessments with AI — you run the protest and keep 100% of any savings. Free review of {{property_address}}? Reply YES. Reply STOP to opt out.'),
  ('Assessment increase alert', 'assessment_increase', 'email',
   '{{property_address}}: assessed value up {{value_change}}',
   E'Hi {{first_name}},\n\nThe {{county}} County appraisal district raised the assessed value of {{property_address}} by {{value_change}} on last year. Increases like that are often worth a closer look.\n\nCorvusPT''s AI assessment review compares it with similar properties and helps you build your own protest — and you keep 100% of any tax savings.\n\nReply and I''ll send the review.\n\nThe CorvusPT team'),
  ('Assessment increase alert (text)', 'assessment_increase', 'sms', null,
   'Hi {{first_name}}, {{property_address}} was assessed {{value_change}} higher this year. CorvusPT can review it with AI before you protest — you keep 100% of any savings. Want the review? Reply STOP to opt out.'),
  ('Protest deadline reminder', 'deadline', 'email',
   '{{county}} County protest deadline: {{protest_deadline}}',
   E'Hi {{first_name}},\n\nThe protest deadline for {{property_address}} is {{protest_deadline}}. After that, this year''s value is usually locked in.\n\nCorvusPT gets you from AI assessment review to a filed protest quickly — you stay in control of the protest and keep 100% of any tax savings.\n\nStart here: reply and I''ll set it up with you.\n\nThe CorvusPT team'),
  ('Protest deadline reminder (text)', 'deadline', 'sms', null,
   'Hi {{first_name}}, the {{county}} County protest deadline for {{property_address}} is {{protest_deadline}}. CorvusPT can get your protest ready in time — keep 100% of any savings. Reply STOP to opt out.'),
  ('Registration reminder', 'registration_reminder', 'email',
   'Finish setting up CorvusPT for {{company}}',
   E'Hi {{first_name}},\n\nThanks for your interest in CorvusPT. Your account takes two minutes to finish — add {{property_address}} and our AI reviews its assessment right away.\n\nYou run your own protest with our tools and keep 100% of any tax savings.\n\nThe CorvusPT team'),
  ('Registration reminder (text)', 'registration_reminder', 'sms', null,
   'Hi {{first_name}}, your CorvusPT account is almost ready — add {{property_address}} and get its AI assessment review. Reply STOP to opt out.'),
  ('Subscription offer', 'subscription_promo', 'email',
   'Start your protest for {{property_address}}',
   E'Hi {{first_name}},\n\nYou''re set up in CorvusPT — the next step is starting the protest for {{property_address}}{{portfolio_note}}.\n\nWith a CorvusPT plan you get the AI assessment review, evidence and filing guidance, and hearing prep — and you keep 100% of any tax savings, with no contingency fee.\n\nThe CorvusPT team'),
  ('Subscription offer (text)', 'subscription_promo', 'sms', null,
   'Hi {{first_name}}, ready to protest {{property_address}}? A CorvusPT plan covers AI review, filing guidance and hearing prep — you keep 100% of any savings. Reply STOP to opt out.'),
  ('Follow-up', 'follow_up', 'email',
   'Following up on {{property_address}}',
   E'Hi {{first_name}},\n\nFollowing up on my last note about {{property_address}}. If a free AI assessment review would help before the {{county}} County deadline, just reply and I''ll send it.\n\nThe CorvusPT team'),
  ('Follow-up (text)', 'follow_up', 'sms', null,
   'Hi {{first_name}}, following up from CorvusPT about {{property_address}} — still want the free assessment review? Reply STOP to opt out.')
) v(name, objective, channel, subject, body)
where not exists (select 1 from public.marketing_templates where is_default);
update public.marketing_templates set is_default = true where created_by is null and is_default = false
  and name in ('Initial outreach','Initial outreach (text)','Assessment increase alert','Assessment increase alert (text)','Protest deadline reminder','Protest deadline reminder (text)','Registration reminder','Registration reminder (text)','Subscription offer','Subscription offer (text)','Follow-up','Follow-up (text)');
