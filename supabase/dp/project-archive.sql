-- Project archive (2026-10-25): a project marked completed moves to the
-- Archive — out of the active project list, the switcher and the dashboard —
-- and can be reopened. A design request moves there when staff set its stage
-- to "completed".
alter table public.projects add column if not exists completed_at timestamptz;
alter table public.design_requests add column if not exists completed_at timestamptz;

-- completed_at follows the stage: set when it becomes "completed", cleared
-- when it's reopened
create or replace function public.stamp_completed_at() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.stage = 'completed' and (tg_op = 'INSERT' or old.stage is distinct from 'completed') then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.stage is distinct from 'completed' then
    new.completed_at := null;
  end if;
  return new;
end; $$;

drop trigger if exists stamp_completed_at on public.projects;
create trigger stamp_completed_at before insert or update of stage on public.projects
  for each row execute function public.stamp_completed_at();
drop trigger if exists stamp_completed_at on public.design_requests;
create trigger stamp_completed_at before insert or update of stage on public.design_requests
  for each row execute function public.stamp_completed_at();

create index if not exists projects_user_active_idx on public.projects (user_id, updated_at desc) where completed_at is null;
create index if not exists design_requests_user_active_idx on public.design_requests (user_id, updated_at desc) where completed_at is null;
