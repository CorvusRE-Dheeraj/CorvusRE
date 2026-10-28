-- Permitting Train-Track Map v4 (2026-10-28): per-permit submission history.
-- Every filing of a permit is one round: submitted → city review → comments
-- (engineer response, QA) → resubmitted as the next round, or approved.
-- Rounds are written by triggers from the workflow the app already has
-- (advancing a permit's status, assigning / addressing / closing review
-- comments), so the history is what actually happened — never made up. The
-- planning fields (expected return + its basis, method, receipt, package
-- version, submitted by, notes) are editable by the project owner.

create table if not exists public.permit_submissions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  permit_id uuid not null references public.project_permits (id) on delete cascade,
  round integer not null,
  submitted_at timestamptz,
  review_started_at timestamptz,
  expected_at timestamptz,
  expected_basis text,
  city_returned_at timestamptz,
  outcome text not null default 'under_review', -- under_review|comments|approved|rejected
  method text,
  confirmation text,
  package_version text,
  submitted_by text,
  qa_passed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (permit_id, round),
  constraint permit_submissions_outcome_check check (outcome in ('under_review','comments','approved','rejected'))
);
create index if not exists permit_submissions_project_idx on public.permit_submissions (project_id);
alter table public.permit_submissions enable row level security;
drop policy if exists "permit submissions: read" on public.permit_submissions;
create policy "permit submissions: read" on public.permit_submissions
  for select using (public.owns_project(project_id));
drop policy if exists "permit submissions: update" on public.permit_submissions;
create policy "permit submissions: update" on public.permit_submissions
  for update using (public.owns_project(project_id)) with check (public.owns_project(project_id));
-- rounds come from the triggers; owners edit only the planning / evidence fields
revoke insert, update, delete on public.permit_submissions from authenticated, anon;
grant update (submitted_at, expected_at, expected_basis, city_returned_at, method, confirmation,
              package_version, submitted_by, notes, updated_at)
  on public.permit_submissions to authenticated;

-- review comments: which round, and the engineer clock
alter table public.review_comments
  add column if not exists round integer,
  add column if not exists discipline text,
  add column if not exists assigned_at timestamptz,
  add column if not exists due_at timestamptz,
  add column if not exists responded_at timestamptz,
  add column if not exists verified_at timestamptz;

-- ── permit status → rounds ─────────────────────────────────────────────────
create or replace function public.track_permit_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  latest public.permit_submissions%rowtype;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  select * into latest from public.permit_submissions
   where permit_id = new.id order by round desc limit 1;

  if new.status = 'submitted' and latest.id is null then
    insert into public.permit_submissions (project_id, permit_id, round, submitted_at)
    values (new.project_id, new.id, 1, coalesce(new.submitted_at, now()));
  elsif new.status = 'resubmitted' then
    -- a resubmission closes the previous round (if the city return wasn't
    -- logged) and starts the next one
    if latest.id is not null and latest.city_returned_at is null then
      update public.permit_submissions
         set city_returned_at = now(), outcome = 'comments', updated_at = now()
       where id = latest.id;
    end if;
    insert into public.permit_submissions (project_id, permit_id, round, submitted_at)
    values (new.project_id, new.id, coalesce(latest.round, 0) + 1, now());
  elsif new.status = 'under_review' and latest.id is not null then
    update public.permit_submissions
       set review_started_at = coalesce(review_started_at, now()), updated_at = now()
     where id = latest.id;
  elsif new.status = 'comments' and latest.id is not null then
    update public.permit_submissions
       set city_returned_at = coalesce(city_returned_at, now()), outcome = 'comments', updated_at = now()
     where id = latest.id;
  elsif new.status = 'approved' and latest.id is not null then
    update public.permit_submissions
       set city_returned_at = coalesce(city_returned_at, new.approved_at, now()), outcome = 'approved',
           updated_at = now()
     where id = latest.id;
  end if;
  return new;
end;
$$;
revoke all on function public.track_permit_submission() from public, anon, authenticated;

drop trigger if exists track_permit_submission on public.project_permits;
create trigger track_permit_submission
  after insert or update of status on public.project_permits
  for each row execute function public.track_permit_submission();

-- ── review comments → round + engineer clock + QA ─────────────────────────
create or replace function public.stamp_review_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.round is null and new.permit_key is not null then
    select s.round into new.round
      from public.permit_submissions s
      join public.project_permits p on p.id = s.permit_id
     where p.project_id = new.project_id and p.permit_key = new.permit_key
     order by s.round desc limit 1;
  end if;
  if coalesce(trim(new.responsible), '') <> '' and new.assigned_at is null then
    new.assigned_at := now();
  end if;
  if new.status in ('addressed', 'closed') and new.responded_at is null then
    new.responded_at := now();
  end if;
  if new.status = 'closed' and new.verified_at is null then
    new.verified_at := now();
  end if;
  if new.status in ('open', 'in_progress') then
    new.responded_at := null;
    new.verified_at := null;
  end if;
  return new;
end;
$$;
revoke all on function public.stamp_review_comment() from public, anon, authenticated;

drop trigger if exists stamp_review_comment on public.review_comments;
create trigger stamp_review_comment
  before insert or update on public.review_comments
  for each row execute function public.stamp_review_comment();

-- QA / compliance passes for a round once every one of its comments is verified
create or replace function public.round_qa_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.round is null or new.permit_key is null then
    return new;
  end if;
  update public.permit_submissions s
     set qa_passed_at = case
           when not exists (
             select 1 from public.review_comments c
              where c.project_id = new.project_id and c.permit_key = new.permit_key
                and c.round = new.round and c.verified_at is null)
           then coalesce(s.qa_passed_at, now())
           else null end,
         updated_at = now()
    from public.project_permits p
   where p.id = s.permit_id and p.project_id = new.project_id
     and p.permit_key = new.permit_key and s.round = new.round;
  return new;
end;
$$;
revoke all on function public.round_qa_check() from public, anon, authenticated;

drop trigger if exists round_qa_check on public.review_comments;
create trigger round_qa_check
  after insert or update of status on public.review_comments
  for each row execute function public.round_qa_check();

-- ── backfill: permits already filed get their first round from what's recorded
insert into public.permit_submissions (project_id, permit_id, round, submitted_at, city_returned_at, outcome)
select p.project_id, p.id, 1, p.submitted_at,
       case when p.status = 'approved' then p.approved_at end,
       case p.status when 'approved' then 'approved' when 'comments' then 'comments' else 'under_review' end
  from public.project_permits p
 where p.status in ('submitted','under_review','comments','resubmitted','approved')
   and not exists (select 1 from public.permit_submissions s where s.permit_id = p.id);
