-- Project Chat: every project (permitting or design) has its own thread
-- between the client and CorvusDP staff. Messages stay for the life of the
-- project; once it is completed the thread is read-only, and deleting the
-- project deletes its thread (on delete cascade).
create table if not exists public.project_messages (
  id uuid primary key default gen_random_uuid(),
  -- the client account the thread belongs to (set by trigger from the project)
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  design_request_id uuid references public.design_requests(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,
  sender_role text not null check (sender_role in ('client', 'staff')),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  -- when the other side read it
  read_at timestamptz,
  -- set once project-chat-notify has emailed about this message
  emailed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint project_messages_one_thread check ((project_id is null) <> (design_request_id is null))
);

create index if not exists project_messages_project_idx on public.project_messages (project_id, created_at);
create index if not exists project_messages_design_idx on public.project_messages (design_request_id, created_at);
create index if not exists project_messages_owner_idx on public.project_messages (owner_id, created_at desc);

-- Fills owner_id from the project, checks the sender is who they say, and
-- refuses new messages on a completed project.
create or replace function public.project_messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_completed timestamptz;
begin
  if new.project_id is not null then
    select user_id, completed_at into v_owner, v_completed from public.projects where id = new.project_id;
  else
    select user_id, completed_at into v_owner, v_completed from public.design_requests where id = new.design_request_id;
  end if;
  if v_owner is null then
    raise exception 'Project not found.';
  end if;
  if v_completed is not null then
    raise exception 'This project is completed, so its chat is closed.';
  end if;
  new.owner_id := v_owner;
  new.sender_id := auth.uid();
  new.read_at := null;
  new.emailed_at := null;
  new.created_at := now();
  if new.sender_role = 'client' and auth.uid() is distinct from v_owner then
    raise exception 'Only the project owner can post as the client.';
  end if;
  if new.sender_role = 'staff' and not public.is_admin() then
    raise exception 'Only CorvusDP staff can post as staff.';
  end if;
  return new;
end;
$$;

drop trigger if exists project_messages_before_insert on public.project_messages;
create trigger project_messages_before_insert
  before insert on public.project_messages
  for each row execute function public.project_messages_before_insert();

alter table public.project_messages enable row level security;

drop policy if exists "chat: read own or staff" on public.project_messages;
create policy "chat: read own or staff" on public.project_messages
  for select to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_admin()));

-- The trigger does the real checks; this keeps inserts to signed-in users
-- posting under their own id.
drop policy if exists "chat: post" on public.project_messages;
create policy "chat: post" on public.project_messages
  for insert to authenticated
  with check (
    (sender_role = 'client' and owner_id = (select auth.uid()))
    or (sender_role = 'staff' and (select public.is_admin()))
  );

-- No direct update/delete: reads are marked through mark_project_chat_read.
revoke update, delete on public.project_messages from authenticated, anon;

-- Marks the other side's messages in one thread as read: the owner marks
-- staff messages, staff mark client messages.
create or replace function public.mark_project_chat_read(p_project uuid, p_design uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.project_messages m
     set read_at = now()
   where m.read_at is null
     and ((p_project is not null and m.project_id = p_project)
       or (p_design is not null and m.design_request_id = p_design))
     and (
       (m.sender_role = 'staff' and m.owner_id = auth.uid())
       or (m.sender_role = 'client' and public.is_admin())
     );
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.mark_project_chat_read(uuid, uuid) from public, anon;
grant execute on function public.mark_project_chat_read(uuid, uuid) to authenticated;
revoke all on function public.project_messages_before_insert() from public, anon, authenticated;
