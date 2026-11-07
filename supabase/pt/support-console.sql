-- Customer Support Admin console (2026-11-06) — builds on the Support role,
-- Marketing → Support handoffs (marketing-followups.sql), shared history,
-- transfers and Super Admin approvals (shared-admin.sql). Applied live.
--
-- Who can do what:
--   Customer Support Admin (profiles.support_admin) — customers, onboarding,
--     tickets, property status (read-only), document issues, billing help,
--     the AI workspace. Never changes valuations, accepts settlements or makes
--     filing decisions (those stay with the customer / Operations).
--   Support Supervisor (profiles.support_supervisor, set by a Super Admin) —
--     also assigns work across the team, sees each person's workload and
--     exports reports.
--   Super Admin — everything, plus the switches in support_permissions
--     (opening customer documents, payment links, policy discounts …), the
--     knowledge base, reminder templates and discount policies. Refunds,
--     pricing exceptions and subscription-term overrides go through
--     approval_requests and only a Super Admin decides them.
-- Full card numbers are never stored or shown — Stripe keeps them; support
-- sees brand + last 4 only (support-console edge function).

-- ── roles ───────────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists support_supervisor boolean not null default false;

create or replace function public.is_support_supervisor()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin or (p.support_admin and p.support_supervisor)
                   from public.profiles p where p.id = auth.uid()), false);
$$;
grant execute on function public.is_support_supervisor() to authenticated;

create or replace function public.set_support_supervisor(target uuid, enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if not public.is_admin() then
    raise exception 'Only a Super Admin can change supervisor access' using errcode = '42501';
  end if;
  update public.profiles set support_supervisor = enabled where id = target returning email into v_email;
  if not found then raise exception 'No such user'; end if;
  insert into public.admin_audit_log (actor_id, actor_email, action, target_user_id, target_email, detail)
  values (auth.uid(), (select email from public.profiles where id = auth.uid()),
          case when enabled then 'grant_support_supervisor' else 'revoke_support_supervisor' end, target, v_email,
          case when enabled then 'Support Supervisor access granted' else 'Support Supervisor access removed' end);
end; $$;
revoke all on function public.set_support_supervisor(uuid, boolean) from public, anon;
grant execute on function public.set_support_supervisor(uuid, boolean) to authenticated;

-- ── Super Admin switches ────────────────────────────────────────────────────
create table if not exists public.support_permissions (
  key text primary key,
  label text not null,
  description text,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.support_permissions (key, label, description, enabled) values
  ('view_documents', 'Open customer documents', 'Support staff can open the files a customer uploaded (notices, statements, receipts). Off = they see the document list and its issues, not the file.', false),
  ('send_payment_links', 'Send payment links', 'Email a customer a secure link to update their card or pay an open invoice.', true),
  ('resend_invoices', 'Resend invoices', 'Re-send a Stripe invoice email to the customer.', true),
  ('policy_discounts', 'Apply approved discounts', 'Apply a discount from the approved discount policies below. Anything else needs a Super Admin pricing-exception approval.', false),
  ('policy_cancellations', 'Cancel by policy', 'Schedule a cancellation for a customer when their plan''s cancellation policy allows it (12-month commitment, 60 days'' notice).', false),
  ('automated_replies', 'Automated workflow replies', 'Messages from an approved automated workflow (e.g. the "we received your request" acknowledgement) send without a review step.', true),
  ('export_reports', 'Export reports', 'Supervisors can download the analytics as CSV. Super Admins always can.', true)
on conflict (key) do nothing;
alter table public.support_permissions enable row level security;
drop policy if exists "Support reads permissions" on public.support_permissions;
create policy "Support reads permissions" on public.support_permissions for select to authenticated
  using ((select public.is_support_admin()));
drop policy if exists "Super Admins edit permissions" on public.support_permissions;
create policy "Super Admins edit permissions" on public.support_permissions for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.support_permissions from anon;
grant select, update on public.support_permissions to authenticated;

create or replace function public.support_can(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.is_support_admin()
    and coalesce((select enabled from public.support_permissions where key = p_key), false));
$$;
grant execute on function public.support_can(text) to authenticated;

-- Discounts support may apply without an approval (a Stripe coupon each).
create table if not exists public.support_discount_policies (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  stripe_coupon_id text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid
);
alter table public.support_discount_policies enable row level security;
drop policy if exists "Support reads discount policies" on public.support_discount_policies;
create policy "Support reads discount policies" on public.support_discount_policies for select to authenticated
  using ((select public.is_support_admin()));
drop policy if exists "Super Admins manage discount policies" on public.support_discount_policies;
create policy "Super Admins manage discount policies" on public.support_discount_policies for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.support_discount_policies from anon;
grant select, insert, update, delete on public.support_discount_policies to authenticated;

-- ── knowledge base (the AI answers only from this) ─────────────────────────
create table if not exists public.support_knowledge (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('faq', 'instruction', 'policy')),
  title text not null,
  body text not null,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.support_knowledge enable row level security;
drop policy if exists "Support reads knowledge" on public.support_knowledge;
create policy "Support reads knowledge" on public.support_knowledge for select to authenticated
  using ((select public.is_support_admin()));
drop policy if exists "Super Admins manage knowledge" on public.support_knowledge;
create policy "Super Admins manage knowledge" on public.support_knowledge for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.support_knowledge from anon;
grant select, insert, update, delete on public.support_knowledge to authenticated;

insert into public.support_knowledge (kind, title, body)
select * from (values
  ('policy', 'What support can and can''t do',
   'Support explains platform steps, helps with onboarding, documents, billing and account questions, and requests information from the customer. Support never changes a property''s value, accepts or rejects a settlement offer, or decides whether or what to file — those decisions belong to the customer (Owner-Managed) or Operations (Corvus-Managed). Questions needing that judgment are escalated to Operations.'),
  ('policy', 'Plans and cancellation',
   'Owner-Managed is $199/month and Corvus-Managed $299/month, billed monthly with a 12-month commitment, or yearly upfront with 50% off the first year. Monthly plans: once 13 months are complete the customer can give notice to cancel; the plan ends 60 days later. Yearly plans end at the end of the paid year if cancelled. Refunds, pricing exceptions and changes to the commitment need Super Admin approval.'),
  ('instruction', 'Adding a property',
   'Dashboard → Properties → Add Property. Enter the address (AI finds the county record) or upload the appraisal notice. Several properties at once: Properties or Pay Taxes → Add Properties (Excel/CSV, PDF or a Podio app).'),
  ('instruction', 'Signing the engagement packet',
   'The first time a customer starts a protest they sign the engagement packet: Terms, Privacy, the Service Agreement and the Appointment of Agent (Form 50-162). It is in Dashboard → Agreements; it can be skipped for now but is needed before CorvusPT can file.'),
  ('instruction', 'Uploading documents',
   'Dashboard → Documents, or the Upload button on a property. Notices, tax statements, photos and receipts are read by AI; anything unclear is flagged for review rather than changed automatically.'),
  ('instruction', 'Paying taxes',
   'Dashboard → Pay Taxes shows every property''s bill, due date and payment plans, and opens the county''s own payment page. CorvusPT does not collect tax payments.'),
  ('faq', 'When is the protest deadline?',
   'Usually May 15, or 30 days after the appraisal notice was mailed, whichever is later. Each property''s deadline is on its Journey Map and the Calendar.'),
  ('faq', 'How do I update my card?',
   'Dashboard → Billing → Manage billing opens the secure Stripe page. Support can also email a secure payment link.')
) v(kind, title, body)
where not exists (select 1 from public.support_knowledge);

-- ── approved reminder / request templates ──────────────────────────────────
-- Placeholders: {{first_name}} {{next_step}} {{property_address}} {{link}} {{issue}}
create table if not exists public.support_templates (
  id uuid primary key default gen_random_uuid(),
  key text unique,
  purpose text not null check (purpose in ('onboarding', 'documents', 'correction', 'billing', 'acknowledgement', 'resolved', 'other')),
  name text not null,
  subject text not null,
  body text not null,
  approved boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.support_templates enable row level security;
drop policy if exists "Support reads templates" on public.support_templates;
create policy "Support reads templates" on public.support_templates for select to authenticated
  using ((select public.is_support_admin()));
drop policy if exists "Super Admins manage templates" on public.support_templates;
create policy "Super Admins manage templates" on public.support_templates for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.support_templates from anon;
grant select, insert, update, delete on public.support_templates to authenticated;

insert into public.support_templates (key, purpose, name, subject, body) values
  ('onboarding_next_step', 'onboarding', 'Finish setting up', 'Your next step in CorvusPT',
   E'Hi {{first_name}},\n\nYou''re almost set up. Your next step: {{next_step}}.\n\nPick up where you left off: {{link}}\n\nReply to this email if anything is unclear — we''re happy to walk you through it.\n\nThe CorvusPT Support team'),
  ('upload_request', 'documents', 'Upload a document', 'Please upload a document for {{property_address}}',
   E'Hi {{first_name}},\n\nTo keep {{property_address}} moving, please upload: {{issue}}.\n\nUpload it securely here (you''ll sign in first): {{link}}\n\nThe CorvusPT Support team'),
  ('correction_request', 'correction', 'Confirm or correct information', 'Please confirm a detail for {{property_address}}',
   E'Hi {{first_name}},\n\nWe noticed something that needs your confirmation for {{property_address}}:\n\n{{issue}}\n\nWe haven''t changed anything. Please check it here and reply with the correct detail or upload a corrected document: {{link}}\n\nThe CorvusPT Support team'),
  ('payment_link', 'billing', 'Update payment', 'Update your CorvusPT payment',
   E'Hi {{first_name}},\n\nYour last payment didn''t go through. You can update your card or pay securely here: {{link}}\n\nThe link opens Stripe''s secure page — CorvusPT never sees your full card number.\n\nThe CorvusPT Support team'),
  ('ticket_received', 'acknowledgement', 'We received your request', 'We received your request (#{{ticket}})',
   E'Hi {{first_name}},\n\nThanks for reaching out — we received your request and a member of the Support team will reply soon.\n\nThe CorvusPT Support team'),
  ('ticket_resolved', 'resolved', 'Request resolved', 'Your request is resolved (#{{ticket}})',
   E'Hi {{first_name}},\n\nWe''ve marked your request as resolved. If anything still isn''t right, just reply and we''ll reopen it.\n\nHow did we do? {{link}}\n\nThe CorvusPT Support team')
on conflict (key) do nothing;

-- ── onboarding ownership ───────────────────────────────────────────────────
create table if not exists public.support_onboarding (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  owner uuid references public.profiles (id) on delete set null,
  status text not null default 'in_progress' check (status in ('not_started', 'in_progress', 'complete')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  last_reminder_at timestamptz,
  reminders_sent integer not null default 0,
  notes text,
  updated_at timestamptz not null default now()
);
alter table public.support_onboarding enable row level security;
drop policy if exists "Support manages onboarding" on public.support_onboarding;
create policy "Support manages onboarding" on public.support_onboarding for all to authenticated
  using ((select public.is_support_admin())) with check ((select public.is_support_admin()));
revoke all on public.support_onboarding from anon;
grant select, insert, update on public.support_onboarding to authenticated;

-- A Marketing handoff accepted by someone makes them the onboarding owner
-- (one customer, one onboarding record — no duplicates).
create or replace function public.support_handoff_to_onboarding() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.profile_id is not null then
    insert into public.support_onboarding (profile_id, owner)
    values (new.profile_id, new.assigned_to)
    on conflict (profile_id) do update
      set owner = coalesce(public.support_onboarding.owner, excluded.owner), updated_at = now();
  end if;
  return new;
end; $$;
drop trigger if exists support_handoff_onboarding on public.support_handoffs;
create trigger support_handoff_onboarding after insert or update of assigned_to, profile_id on public.support_handoffs
  for each row execute function public.support_handoff_to_onboarding();

-- ── tickets ────────────────────────────────────────────────────────────────
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  profile_id uuid references public.profiles (id) on delete set null,
  property_id uuid references public.properties (id) on delete set null,
  subject text not null,
  category text check (category in ('onboarding', 'billing', 'documents', 'protest', 'deadlines', 'pay_taxes', 'account', 'technical', 'other')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'waiting_on_customer', 'escalated', 'resolved', 'closed')),
  source text not null default 'staff' check (source in ('staff', 'chat_escalation', 'email', 'phone')),
  assigned_to uuid references public.profiles (id) on delete set null,
  created_by uuid,
  -- the response deadline (by priority — see support_sla_hours)
  due_at timestamptz not null default now() + interval '24 hours',
  first_response_at timestamptz,
  resolved_at timestamptz,
  reopened_count integer not null default 0,
  escalated_to text check (escalated_to in ('operations', 'super_admin', 'marketing')),
  escalation_reason text,
  escalation_id uuid references public.support_escalations (id) on delete set null,
  ai_summary text,
  ai_summary_at timestamptz,
  overdue_alerted_at timestamptz,
  rating integer check (rating between 1 and 5),
  rating_comment text,
  rated_at timestamptz,
  feedback_token text unique default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
);
create index if not exists support_tickets_status_idx on public.support_tickets (status, due_at);
create index if not exists support_tickets_profile_idx on public.support_tickets (profile_id, created_at desc);
create index if not exists support_tickets_assignee_idx on public.support_tickets (assigned_to, status);
create unique index if not exists support_tickets_escalation_uidx on public.support_tickets (escalation_id) where escalation_id is not null;
alter table public.support_tickets enable row level security;
drop policy if exists "Support manages tickets" on public.support_tickets;
create policy "Support manages tickets" on public.support_tickets for all to authenticated
  using ((select public.is_support_admin())) with check ((select public.is_support_admin()));
revoke all on public.support_tickets from anon;
grant select, insert, update on public.support_tickets to authenticated;

create or replace function public.support_sla_hours(p_priority text) returns integer
language sql immutable as $$
  select case p_priority when 'urgent' then 4 when 'high' then 8 when 'low' then 72 else 24 end;
$$;

create or replace function public.support_ticket_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.due_at := new.created_at + make_interval(hours => public.support_sla_hours(new.priority));
  else
    -- priority changed before the first response: move the deadline with it
    if new.priority is distinct from old.priority and new.first_response_at is null then
      new.due_at := new.created_at + make_interval(hours => public.support_sla_hours(new.priority));
      new.overdue_alerted_at := null;
    end if;
    if new.status in ('resolved', 'closed') and old.status not in ('resolved', 'closed') then
      new.resolved_at := now();
    end if;
    -- reopened
    if old.status in ('resolved', 'closed') and new.status not in ('resolved', 'closed') then
      new.reopened_count := old.reopened_count + 1;
      new.resolved_at := null;
      new.due_at := now() + make_interval(hours => public.support_sla_hours(new.priority));
      new.first_response_at := null;
      new.overdue_alerted_at := null;
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists support_ticket_touch on public.support_tickets;
create trigger support_ticket_touch before insert or update on public.support_tickets
  for each row execute function public.support_ticket_touch();

-- every ticket change lands in the customer's shared history
create or replace function public.support_ticket_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_summary text;
begin
  if tg_op = 'INSERT' then
    v_summary := format('Ticket #%s opened: %s', new.number, new.subject);
  elsif new.status is distinct from old.status then
    v_summary := format('Ticket #%s %s', new.number,
      case new.status when 'resolved' then 'resolved' when 'closed' then 'closed' when 'escalated' then 'escalated to ' || coalesce(new.escalated_to, 'a specialist')
        when 'waiting_on_customer' then 'waiting on the customer'
        else case when old.status in ('resolved', 'closed') then 'reopened' else 'moved to ' || replace(new.status, '_', ' ') end end);
  elsif new.assigned_to is distinct from old.assigned_to then
    v_summary := format('Ticket #%s assigned to %s', new.number,
      coalesce((select coalesce(nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), email) from public.profiles where id = new.assigned_to), 'nobody'));
  elsif new.priority is distinct from old.priority then
    v_summary := format('Ticket #%s priority %s → %s', new.number, old.priority, new.priority);
  else
    return new;
  end if;
  perform public.log_record_event('support', 'ticket', new.id, case when tg_op = 'INSERT' then 'ticket_opened' else 'ticket_updated' end,
    v_summary, new.profile_id, null, new.property_id);
  return new;
end; $$;
drop trigger if exists support_ticket_log on public.support_tickets;
create trigger support_ticket_log after insert or update on public.support_tickets
  for each row execute function public.support_ticket_log();

create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets (id) on delete cascade,
  created_at timestamptz not null default now(),
  author_id uuid,
  kind text not null check (kind in ('internal_note', 'customer_reply', 'customer_message', 'system')),
  body text not null,
  ai_drafted boolean not null default false,
  automated boolean not null default false,
  sent_at timestamptz,
  send_error text
);
create index if not exists support_ticket_messages_ticket_idx on public.support_ticket_messages (ticket_id, created_at);
alter table public.support_ticket_messages enable row level security;
drop policy if exists "Support reads ticket messages" on public.support_ticket_messages;
create policy "Support reads ticket messages" on public.support_ticket_messages for select to authenticated
  using ((select public.is_support_admin()));
-- staff write notes and logged customer messages directly; customer replies
-- (emails) only through the support-console function, which sends them
drop policy if exists "Support adds notes" on public.support_ticket_messages;
create policy "Support adds notes" on public.support_ticket_messages for insert to authenticated
  with check ((select public.is_support_admin()) and kind in ('internal_note', 'customer_message') and author_id = (select auth.uid()));
revoke all on public.support_ticket_messages from anon;
grant select, insert on public.support_ticket_messages to authenticated;

-- a customer message (logged by staff) restarts the response clock
create or replace function public.support_message_effects() returns trigger
language plpgsql security definer set search_path = public as $$
declare t public.support_tickets;
begin
  select * into t from public.support_tickets where id = new.ticket_id;
  if new.kind = 'customer_reply' and new.sent_at is not null then
    update public.support_tickets
      set first_response_at = coalesce(first_response_at, new.sent_at),
          status = case when status = 'open' then 'in_progress' else status end
      where id = new.ticket_id;
  elsif new.kind = 'customer_message' then
    update public.support_tickets
      set due_at = now() + make_interval(hours => public.support_sla_hours(t.priority)),
          first_response_at = null, overdue_alerted_at = null,
          status = case when status in ('resolved', 'closed', 'waiting_on_customer') then 'open' else status end
      where id = new.ticket_id;
  end if;
  if new.kind in ('customer_reply', 'customer_message') then
    perform public.log_record_event('support', 'ticket', t.id,
      case new.kind when 'customer_reply' then 'reply_sent' else 'customer_message' end,
      format('Ticket #%s — %s: %s', t.number, case new.kind when 'customer_reply' then 'reply sent' else 'customer wrote' end,
             left(regexp_replace(new.body, '\s+', ' ', 'g'), 140)),
      t.profile_id, null, t.property_id);
  end if;
  return new;
end; $$;
drop trigger if exists support_message_effects on public.support_ticket_messages;
create trigger support_message_effects after insert on public.support_ticket_messages
  for each row execute function public.support_message_effects();

-- An Ask AI "talk to someone" escalation becomes a ticket automatically.
create or replace function public.support_escalation_to_ticket() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.support_tickets (profile_id, subject, priority, source, escalation_id, created_by)
  values (new.user_id,
          coalesce(nullif(left(trim(new.summary), 140), ''), 'Support request from the Ask AI chat'),
          case when new.contact_method = 'call' then 'high' else 'normal' end,
          'chat_escalation', new.id, new.user_id)
  on conflict do nothing;
  insert into public.support_ticket_messages (ticket_id, kind, body, author_id)
  select t.id, 'customer_message',
         coalesce(nullif(trim(new.summary), ''), '(no summary)') || E'\n\nPreferred contact: ' || new.contact_method ||
         coalesce(E'\n\nChat transcript:\n' || (select string_agg(upper(x->>'role') || ': ' || (x->>'text'), E'\n')
                                               from jsonb_array_elements(new.transcript) x), ''),
         new.user_id
  from public.support_tickets t where t.escalation_id = new.id
    and not exists (select 1 from public.support_ticket_messages m where m.ticket_id = t.id);
  return new;
end; $$;
drop trigger if exists support_escalation_ticket on public.support_escalations;
create trigger support_escalation_ticket after insert on public.support_escalations
  for each row execute function public.support_escalation_to_ticket();

-- backfill: every escalation not resolved yet gets its ticket
insert into public.support_tickets (profile_id, subject, priority, source, escalation_id, created_at, created_by)
select e.user_id, coalesce(nullif(left(trim(e.summary), 140), ''), 'Support request from the Ask AI chat'),
       case when e.contact_method = 'call' then 'high' else 'normal' end, 'chat_escalation', e.id, e.created_at, e.user_id
from public.support_escalations e
where e.status <> 'resolved' and not exists (select 1 from public.support_tickets t where t.escalation_id = e.id);

-- ── subscription history (renewals, cancellations, failed payments) ────────
create table if not exists public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  profile_id uuid references public.profiles (id) on delete set null,
  property_id uuid references public.properties (id) on delete set null,
  stripe_subscription_id text,
  kind text not null check (kind in ('started', 'renewed', 'payment_failed', 'cancel_scheduled', 'cancel_reverted', 'canceled')),
  amount_cents integer,
  detail text,
  stripe_event_id text unique
);
create index if not exists subscription_events_profile_idx on public.subscription_events (profile_id, created_at desc);
create index if not exists subscription_events_kind_idx on public.subscription_events (kind, created_at desc);
alter table public.subscription_events enable row level security;
drop policy if exists "Support reads subscription events" on public.subscription_events;
create policy "Support reads subscription events" on public.subscription_events for select to authenticated
  using ((select public.is_support_admin()));
revoke all on public.subscription_events from anon, authenticated;
grant select on public.subscription_events to authenticated;

-- ── onboarding steps (one place, used by the list, the dashboard and AI) ───
create or replace function public.support_onboarding_steps(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with pr as (select * from public.properties where user_id = p_user),
  f as (
    select
      (select count(*) from pr) props,
      (select count(*) from pr where subscription_status in ('active', 'trialing', 'past_due')) paid,
      (select count(*) from pr where nullif(trim(account_number), '') is null) no_acct,
      (select count(*) from pr where verification_status in ('needs_review', 'rejected')) flagged,
      exists (select 1 from public.engagement_packets where user_id = p_user and voided_at is null) packet,
      exists (select 1 from public.terms_acceptances where user_id = p_user) terms,
      (select nullif(trim(phone), '') from public.profiles where id = p_user) phone
  )
  select jsonb_build_array(
    jsonb_build_object('key', 'terms', 'label', 'Accept the Terms', 'done', f.terms),
    jsonb_build_object('key', 'phone', 'label', 'Add a phone number', 'done', f.phone is not null),
    jsonb_build_object('key', 'property', 'label', 'Add a property', 'done', f.props > 0),
    jsonb_build_object('key', 'account', 'label', 'CAD account number on every property', 'done', f.props > 0 and f.no_acct = 0,
                       'detail', case when f.no_acct > 0 then format('%s missing', f.no_acct) end),
    jsonb_build_object('key', 'verified', 'label', 'Properties verified', 'done', f.props > 0 and f.flagged = 0,
                       'detail', case when f.flagged > 0 then format('%s flagged for review', f.flagged) end),
    jsonb_build_object('key', 'subscribed', 'label', 'Subscribe', 'done', f.paid > 0,
                       'detail', case when f.props > f.paid and f.paid > 0 then format('%s of %s subscribed', f.paid, f.props) end),
    jsonb_build_object('key', 'packet', 'label', 'Sign the engagement packet', 'done', f.packet)
  ) from f;
$$;
revoke all on function public.support_onboarding_steps(uuid) from public, anon, authenticated;

create or replace function public.support_staff_label(p uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), email)
  from public.profiles where id = p;
$$;
revoke all on function public.support_staff_label(uuid) from public, anon, authenticated;

-- ── customer list ──────────────────────────────────────────────────────────
-- Every customer once — a Marketing lead that signed up is the same customer
-- (joined by profile), never a second row.
create or replace function public.support_customers() returns table (
  profile_id uuid, name text, email text, phone text, company text, created_at timestamptz,
  owner_entities text[], properties integer, subscribed integer, past_due integer,
  subscription_status text, plan text, onboarding jsonb, onboarding_done integer, onboarding_total integer,
  onboarding_owner uuid, onboarding_owner_label text, onboarding_status text, last_reminder_at timestamptz,
  source text, lead_id uuid, handoff_id uuid, open_tickets integer, next_deadline date
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_support_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  return query
  with c as (
    select p.* from public.profiles p
    where not (p.is_admin or p.marketing_admin or p.support_admin or p.operations_admin)
  )
  select c.id,
    nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''),
    c.email, c.phone, c.company_name, c.created_at,
    coalesce((select array_agg(distinct pr.owner_name order by pr.owner_name) from public.properties pr
              where pr.user_id = c.id and nullif(trim(pr.owner_name), '') is not null), '{}'),
    (select count(*)::int from public.properties pr where pr.user_id = c.id),
    (select count(*)::int from public.properties pr where pr.user_id = c.id and pr.subscription_status in ('active', 'trialing', 'past_due')),
    (select count(*)::int from public.properties pr where pr.user_id = c.id and pr.subscription_status in ('past_due', 'unpaid')),
    c.subscription_status, c.plan,
    s.steps,
    (select count(*)::int from jsonb_array_elements(s.steps) x where (x->>'done')::boolean),
    jsonb_array_length(s.steps),
    o.owner, public.support_staff_label(o.owner), o.status, o.last_reminder_at,
    coalesce(l.source, c.lead_source, 'Signed up directly'),
    l.id, h.id,
    (select count(*)::int from public.support_tickets t where t.profile_id = c.id and t.status not in ('resolved', 'closed')),
    (select min(d) from (
       select pr.protest_deadline::date d from public.properties pr where pr.user_id = c.id and pr.protest_deadline >= current_date
       union all
       select b.due_date from public.tax_bills b where b.user_id = c.id and b.due_date >= current_date and coalesce(b.status, 'unpaid') <> 'paid' and b.paid_at is null
       union all
       select pt.hearing_date::date from public.protests pt where pt.user_id = c.id and pt.hearing_date >= current_date
     ) dd)
  from c
  cross join lateral (select public.support_onboarding_steps(c.id) steps) s
  left join public.support_onboarding o on o.profile_id = c.id
  left join lateral (select ml.id, ml.source from public.marketing_leads ml
                     where ml.profile_id = c.id or (c.converted_from_lead is not null and ml.id = c.converted_from_lead)
                     order by ml.created_at limit 1) l on true
  left join public.support_handoffs h on h.profile_id = c.id
  order by c.created_at desc;
end; $$;
revoke all on function public.support_customers() from public, anon;
grant execute on function public.support_customers() to authenticated;

-- ── one customer, everything support may see ───────────────────────────────
create or replace function public.support_customer_detail(p_profile uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_support_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  select jsonb_build_object(
    'profile', (select jsonb_build_object('id', p.id, 'name', nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
        'email', p.email, 'phone', p.phone, 'company', p.company_name, 'createdAt', p.created_at, 'plan', p.plan,
        'subscriptionStatus', p.subscription_status, 'hasStripeCustomer', p.stripe_customer_id is not null,
        'source', p.lead_source)
      from public.profiles p where p.id = p_profile),
    'onboarding', jsonb_build_object('steps', public.support_onboarding_steps(p_profile),
      'record', (select to_jsonb(o) || jsonb_build_object('ownerLabel', public.support_staff_label(o.owner))
                 from public.support_onboarding o where o.profile_id = p_profile)),
    'lead', (select jsonb_build_object('id', ml.id, 'source', ml.source, 'stage', ml.stage, 'createdAt', ml.created_at,
               'ownerNames', ml.owner_names, 'assignedTo', public.support_staff_label(ml.assigned_to))
             from public.marketing_leads ml where ml.profile_id = p_profile order by ml.created_at limit 1),
    'handoff', (select jsonb_build_object('id', h.id, 'status', h.status, 'summary', h.summary, 'assignedTo', public.support_staff_label(h.assigned_to))
                from public.support_handoffs h where h.profile_id = p_profile),
    'properties', coalesce((select jsonb_agg(to_jsonb(pr) - 'value_history' order by pr.created_at) from public.properties pr where pr.user_id = p_profile), '[]'),
    'protests', coalesce((select jsonb_agg(to_jsonb(pt) order by pt.updated_at desc) from public.protests pt where pt.user_id = p_profile), '[]'),
    'bills', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'propertyId', b.property_id, 'taxYear', b.tax_year, 'amountDue', b.amount_due,
        'dueDate', b.due_date, 'status', b.status, 'paidAt', b.paid_at, 'installments', b.installments) order by b.tax_year desc)
      from public.tax_bills b where b.user_id = p_profile), '[]'),
    'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'propertyId', d.property_id, 'fileName', d.file_name,
        'type', d.document_type, 'category', d.category, 'uploadedAt', d.uploaded_at, 'aiVerdict', d.ai_verdict, 'aiNotes', d.ai_notes,
        'verificationStatus', d.verification_status, 'verificationFlags', d.verification_flags, 'editedFrom', d.edited_from,
        'duplicateOf', d.duplicate_of, 'deletedAt', d.deleted_at) order by d.uploaded_at desc)
      from public.documents d where d.user_id = p_profile), '[]'),
    'packetSigned', exists (select 1 from public.engagement_packets e where e.user_id = p_profile and e.voided_at is null),
    'tickets', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'number', t.number, 'subject', t.subject, 'status', t.status,
        'priority', t.priority, 'category', t.category, 'createdAt', t.created_at, 'dueAt', t.due_at, 'propertyId', t.property_id) order by t.created_at desc)
      from public.support_tickets t where t.profile_id = p_profile), '[]'),
    'events', coalesce((select jsonb_agg(jsonb_build_object('at', e.created_at, 'department', e.department, 'action', e.action,
        'summary', e.summary, 'actor', coalesce(e.actor_label, public.support_staff_label(e.actor_id))) order by e.created_at desc)
      from (select * from public.record_events where profile_id = p_profile order by created_at desc limit 80) e), '[]'),
    'subscriptionEvents', coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at desc)
      from public.subscription_events s where s.profile_id = p_profile), '[]')
  ) into v;
  return v;
end; $$;
revoke all on function public.support_customer_detail(uuid) from public, anon;
grant execute on function public.support_customer_detail(uuid) to authenticated;

-- ── dashboard ─────────────────────────────────────────────────────────────
create or replace function public.support_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_support_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  with customers as (
    select p.id from public.profiles p
    where not (p.is_admin or p.marketing_admin or p.support_admin or p.operations_admin)
  ), onb as (
    select c.id, (select count(*) from jsonb_array_elements(public.support_onboarding_steps(c.id)) x where not (x->>'done')::boolean) missing
    from customers c
    where exists (select 1 from public.properties pr where pr.user_id = c.id)
       or exists (select 1 from public.support_handoffs h where h.profile_id = c.id)
  ), open_t as (
    select * from public.support_tickets where status not in ('resolved', 'closed')
  ), deadlines as (
    select 'Protest deadline' kind, pr.protest_deadline::date d, pr.user_id profile_id, pr.id property_id, pr.address
    from public.properties pr join customers c on c.id = pr.user_id
    where pr.protest_deadline between current_date and current_date + 14
      and not exists (select 1 from public.protests pt where pt.property_id = pr.id and pt.status <> 'requested')
    union all
    select 'ARB hearing', pt.hearing_date::date, pt.user_id, pt.property_id, pr.address
    from public.protests pt join public.properties pr on pr.id = pt.property_id
    where pt.status = 'hearing_scheduled' and pt.hearing_date between current_date and current_date + 14
    union all
    select 'Tax payment due', b.due_date, b.user_id, b.property_id, pr.address
    from public.tax_bills b join public.properties pr on pr.id = b.property_id
    where b.due_date between current_date and current_date + 14 and coalesce(b.status, 'unpaid') not in ('paid') and b.paid_at is null
  )
  select jsonb_build_object(
    'openTickets', (select count(*) from open_t),
    'overdueTickets', (select count(*) from open_t where first_response_at is null and due_at < now()),
    'urgentTickets', (select count(*) from open_t where priority in ('urgent', 'high')),
    'escalatedTickets', (select count(*) from open_t where status = 'escalated'),
    'unassignedTickets', (select count(*) from open_t where assigned_to is null),
    'incompleteOnboarding', (select count(*) from onb where missing > 0),
    'failedPayments', (select count(distinct pr.user_id) from public.properties pr join customers c on c.id = pr.user_id
                       where pr.subscription_status in ('past_due', 'unpaid')),
    'upcomingDeadlines', (select count(*) from deadlines),
    'deadlines', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'date', d, 'profileId', profile_id, 'propertyId', property_id,
        'address', address, 'customer', public.support_staff_label(profile_id)) order by d) from (select * from deadlines order by d limit 40) x), '[]'),
    'priorityActions', coalesce((select jsonb_agg(a order by (a->>'rank')::int, a->>'at') from (
        select jsonb_build_object('rank', 0, 'kind', 'ticket', 'id', t.id, 'profileId', t.profile_id,
          'label', format('#%s %s', t.number, t.subject),
          'reason', case when t.first_response_at is null and t.due_at < now() then 'Response overdue'
                         when t.status = 'escalated' then 'Escalated' else initcap(t.priority) || ' priority' end,
          'at', t.due_at) a
        from open_t t
        where (t.first_response_at is null and t.due_at < now()) or t.priority = 'urgent' or t.status = 'escalated'
        union all
        select jsonb_build_object('rank', 1, 'kind', 'payment', 'id', pr.id, 'profileId', pr.user_id,
          'label', public.support_staff_label(pr.user_id) || ' — ' || pr.address, 'reason', 'Payment failed', 'at', now())
        from public.properties pr join customers c on c.id = pr.user_id where pr.subscription_status in ('past_due', 'unpaid')
        union all
        select jsonb_build_object('rank', 2, 'kind', 'deadline', 'id', d.property_id, 'profileId', d.profile_id,
          'label', public.support_staff_label(d.profile_id) || ' — ' || d.address,
          'reason', format('%s in %s day%s', d.kind, d.d - current_date, case when d.d - current_date = 1 then '' else 's' end),
          'at', d.d)
        from deadlines d where d.d <= current_date + 5
      ) z), '[]')
  ) into v;
  return v;
end; $$;
revoke all on function public.support_dashboard() from public, anon;
grant execute on function public.support_dashboard() to authenticated;

-- ── analytics ─────────────────────────────────────────────────────────────
create or replace function public.support_analytics(p_from date, p_to date, p_staff uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_to timestamptz := (p_to + 1)::timestamptz;
begin
  if not public.is_support_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  -- staff other than supervisors see only their own numbers
  if not public.is_support_supervisor() then p_staff := auth.uid(); end if;
  with t as (
    select * from public.support_tickets
    where created_at >= p_from and created_at < v_to and (p_staff is null or assigned_to = p_staff)
  ), onb as (
    select o.* from public.support_onboarding o where (p_staff is null or o.owner = p_staff)
  )
  select jsonb_build_object(
    'ticketsOpened', (select count(*) from t),
    'ticketsResolved', (select count(*) from t where resolved_at is not null),
    'openNow', (select count(*) from public.support_tickets where status not in ('resolved', 'closed') and (p_staff is null or assigned_to = p_staff)),
    'overdueNow', (select count(*) from public.support_tickets where status not in ('resolved', 'closed') and first_response_at is null and due_at < now() and (p_staff is null or assigned_to = p_staff)),
    'avgFirstResponseHours', (select round(avg(extract(epoch from first_response_at - created_at) / 3600)::numeric, 1) from t where first_response_at is not null),
    'avgResolutionHours', (select round(avg(extract(epoch from resolved_at - created_at) / 3600)::numeric, 1) from t where resolved_at is not null),
    'withinSla', (select round(100.0 * count(*) filter (where first_response_at <= due_at) / nullif(count(*) filter (where first_response_at is not null), 0)) from t),
    'reopened', (select count(*) from t where reopened_count > 0),
    'avgRating', (select round(avg(rating)::numeric, 1) from t where rating is not null),
    'ratings', (select count(*) from t where rating is not null),
    'byCategory', coalesce((select jsonb_object_agg(coalesce(category, 'uncategorized'), n) from (select category, count(*) n from t group by 1) x), '{}'),
    'onboardingOwned', (select count(*) from onb),
    'onboardingCompleted', (select count(*) from onb where status = 'complete' and completed_at >= p_from and completed_at < v_to),
    'onboardingInProgress', (select count(*) from onb where status <> 'complete'),
    'renewals', (select count(*) from public.subscription_events where kind = 'renewed' and created_at >= p_from and created_at < v_to),
    'cancellations', (select count(*) from public.subscription_events where kind = 'canceled' and created_at >= p_from and created_at < v_to),
    'cancelScheduled', (select count(*) from public.subscription_events where kind = 'cancel_scheduled' and created_at >= p_from and created_at < v_to),
    'failedPayments', (select count(*) from public.subscription_events where kind = 'payment_failed' and created_at >= p_from and created_at < v_to),
    'feedbackResponses', (select count(*) from public.beta_feedback_responses where completed_at >= p_from and completed_at < v_to),
    'workload', case when public.is_support_supervisor() then coalesce((select jsonb_agg(w order by w->>'name') from (
        select jsonb_build_object('id', s.id, 'name', public.support_staff_label(s.id), 'supervisor', s.support_supervisor,
          'openTickets', (select count(*) from public.support_tickets x where x.assigned_to = s.id and x.status not in ('resolved', 'closed')),
          'overdue', (select count(*) from public.support_tickets x where x.assigned_to = s.id and x.status not in ('resolved', 'closed') and x.first_response_at is null and x.due_at < now()),
          'resolvedInRange', (select count(*) from public.support_tickets x where x.assigned_to = s.id and x.resolved_at >= p_from and x.resolved_at < v_to),
          'onboarding', (select count(*) from public.support_onboarding o where o.owner = s.id and o.status <> 'complete')) w
        from public.profiles s where s.support_admin or s.is_admin) z), '[]') else '[]' end,
    'recurring', coalesce((select jsonb_agg(jsonb_build_object('subject', subject, 'count', n) order by n desc) from (
        select lower(regexp_replace(subject, '[^a-zA-Z ]', '', 'g')) subject, count(*) n from t group by 1 having count(*) > 1 order by 2 desc limit 8) r), '[]')
  ) into v;
  return v;
end; $$;
revoke all on function public.support_analytics(date, date, uuid) from public, anon;
grant execute on function public.support_analytics(date, date, uuid) to authenticated;

-- staff the support team can assign to
create or replace function public.support_team() returns table (id uuid, name text, supervisor boolean, super_admin boolean)
language sql stable security definer set search_path = public as $$
  select p.id, public.support_staff_label(p.id), p.support_supervisor, p.is_admin
  from public.profiles p
  where (p.support_admin or p.is_admin) and public.is_support_admin()
  order by 2;
$$;
revoke all on function public.support_team() from public, anon;
grant execute on function public.support_team() to authenticated;

-- ── approvals: subscription-term overrides ─────────────────────────────────
alter table public.approval_requests drop constraint if exists approval_requests_kind_check;
alter table public.approval_requests add constraint approval_requests_kind_check
  check (kind in ('access_change', 'pricing_exception', 'refund', 'agreement_change', 'automation_permission', 'subscription_override'));

-- live updates in the console (useLiveRefresh)
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'support_tickets') then
    alter publication supabase_realtime add table public.support_tickets;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'support_ticket_messages') then
    alter publication supabase_realtime add table public.support_ticket_messages;
  end if;
end $$;
