-- Campaign delivery + engagement (builds on the earlier marketing*.sql files).
--
--   * marketing_messages: one row per email / text sent (or text received) with
--     delivery, opens, clicks, bounces, complaints and replies. Written only by
--     the server (marketing-send, and the webhooks served by county-mail-inbound).
--   * marketing_campaign_metrics: per-campaign roll-up of those messages.
--   * Recurring campaigns (weekly / twice monthly / monthly / custom) and
--     engagement follow-up rules that run once the campaign is approved.
--   * Postal address for the CAN-SPAM footer; bounced addresses stop getting email.

create table if not exists public.marketing_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  lead_id uuid references public.marketing_leads(id) on delete cascade,
  campaign_id uuid references public.marketing_campaigns(id) on delete set null,
  followup_id uuid references public.marketing_followups(id) on delete set null,
  channel text not null check (channel in ('email', 'sms')),
  direction text not null default 'out' check (direction in ('out', 'in')),
  provider text not null default 'resend',
  provider_id text,
  to_address text,
  from_address text,
  subject text,
  body text,
  status text not null default 'sent' check (status in ('queued', 'sent', 'delivered', 'delivery_delayed', 'opened', 'clicked', 'bounced', 'complained', 'failed', 'received')),
  sent_at timestamptz not null default now(),
  delivered_at timestamptz,
  opened_at timestamptz,
  open_count int not null default 0,
  clicked_at timestamptz,
  click_count int not null default 0,
  last_click_url text,
  bounced_at timestamptz,
  bounce_type text,
  complained_at timestamptz,
  failed_reason text,
  replied_at timestamptz,
  run_no int
);
create unique index if not exists marketing_messages_provider on public.marketing_messages (provider, provider_id) where provider_id is not null;
create index if not exists marketing_messages_campaign on public.marketing_messages (campaign_id, sent_at desc);
create index if not exists marketing_messages_lead on public.marketing_messages (lead_id, sent_at desc);
alter table public.marketing_messages enable row level security;
drop policy if exists "Marketing admins read messages" on public.marketing_messages;
create policy "Marketing admins read messages" on public.marketing_messages for select to authenticated using ((select public.is_marketing_admin()));
revoke all on public.marketing_messages from anon, authenticated;
grant select on public.marketing_messages to authenticated;

create or replace view public.marketing_campaign_metrics with (security_invoker = true) as
select m.campaign_id,
       count(*) filter (where m.direction = 'out') sent,
       count(*) filter (where m.direction = 'out' and m.channel = 'email') emails,
       count(*) filter (where m.direction = 'out' and m.channel = 'sms') texts,
       count(*) filter (where m.delivered_at is not null) delivered,
       count(*) filter (where m.opened_at is not null) opened,
       count(*) filter (where m.clicked_at is not null) clicked,
       count(*) filter (where m.bounced_at is not null) bounced,
       count(*) filter (where m.complained_at is not null) complained,
       count(*) filter (where m.status = 'failed') failed,
       count(*) filter (where m.replied_at is not null) replied,
       count(distinct m.lead_id) filter (where l.unsubscribed_at is not null and l.unsubscribed_at > m.sent_at) unsubscribed,
       max(m.sent_at) last_sent_at
from public.marketing_messages m left join public.marketing_leads l on l.id = m.lead_id
where m.campaign_id is not null
group by m.campaign_id;
grant select on public.marketing_campaign_metrics to authenticated;

alter table public.marketing_campaigns
  add column if not exists frequency text not null default 'once' check (frequency in ('once', 'weekly', 'twice_monthly', 'monthly', 'custom')),
  add column if not exists custom_days int check (custom_days is null or custom_days between 1 and 365),
  add column if not exists ends_at timestamptz,
  add column if not exists last_sent_at timestamptz,
  add column if not exists run_count int not null default 0,
  -- [{trigger: "no_open"|"opened_no_click"|"clicked"|"no_reply", afterDays, action: "email"|"sms"|"call"|"task", subject?, body?}]
  add column if not exists followup_rules jsonb not null default '[]'::jsonb;

alter table public.marketing_settings add column if not exists postal_address text;

alter table public.marketing_leads add column if not exists email_bounced_at timestamptz;

create or replace function public.marketing_can_contact(p_lead uuid, p_channel text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when l.id is null then 'Lead not found'
    when l.stage = 'do_not_contact' then 'Do Not Contact'
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
grant execute on function public.marketing_can_contact(uuid, text) to authenticated, service_role;

-- the audit trail also records each send (by the system)
create or replace function public.marketing_messages_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.direction = 'in' then
    perform public.marketing_audit_write('communication', new.lead_id, 'sms_received', 'Text received from ' || coalesce(new.from_address, 'unknown'));
  end if;
  return null;
end; $$;
drop trigger if exists marketing_messages_audit on public.marketing_messages;
create trigger marketing_messages_audit after insert on public.marketing_messages for each row execute function public.marketing_messages_audit();

-- engagement events (clicks, bounces, spam complaints) in the lead history
alter table public.marketing_activities drop constraint if exists marketing_activities_kind_check;
alter table public.marketing_activities add constraint marketing_activities_kind_check check (kind in ('note','email','sms','call','meeting','stage','ai','follow_up','campaign','import','sync','research','assign','journey','engagement'));

-- follow-ups created by a campaign's engagement rules point back to it
alter table public.marketing_followups add column if not exists campaign_id uuid references public.marketing_campaigns(id) on delete set null;
