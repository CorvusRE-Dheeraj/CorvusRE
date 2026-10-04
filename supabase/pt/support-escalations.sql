-- Support-bot escalations ("Talk to someone" / "Email us" from the Ask AI
-- widget's human-support persona — see AskAiWidget.tsx). Applied to the live
-- database and mirrored in schema.sql. A user files their own row directly
-- from the client (RLS below); admins read and manage every one from the
-- Admin -> Support tab. A "call" escalation also triggers a real staff email
-- via notifyStaff() at the call site, so the row is never the only record —
-- the "someone will get back to you" promise is backed by an actual notice.
create table if not exists public.support_escalations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  contact_method text not null check (contact_method in ('call', 'email')),
  summary text not null default '',
  -- The chat transcript at the moment they asked to escalate: [{role, text}].
  transcript jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'contacted', 'resolved')),
  created_at timestamptz not null default now()
);
create index if not exists support_escalations_created_idx
  on public.support_escalations (created_at desc);
alter table public.support_escalations enable row level security;

drop policy if exists "Users create their own support escalation" on public.support_escalations;
create policy "Users create their own support escalation"
  on public.support_escalations for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Admins manage support escalations" on public.support_escalations;
create policy "Admins manage support escalations"
  on public.support_escalations for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Table-level grant is broad; RLS above is the real gate — a non-admin's
-- own policy only covers insert, so select/update/delete on someone else's
-- row (or their own, post-insert) is refused regardless of this grant.
grant select, insert, update, delete on public.support_escalations to authenticated;
grant select, insert, update, delete on public.support_escalations to service_role;
