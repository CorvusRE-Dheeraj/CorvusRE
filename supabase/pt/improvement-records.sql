-- Improvement Condition (Module 5) — what's built on the property, its
-- condition, defects and repairs, entered by the owner or suggested by AI from
-- an inspection report / photos / videos (improvement-evidence-extract).
--   improvement_buildings: one row per building (a property can have several).
--     improvement_types holds one type, or several for mixed-use; details holds
--     the building facts (area, floors, construction, year built, renovations,
--     major replacements) — any of them may be missing.
--   improvement_items: one condition record — a component (Roof, HVAC, a
--     daycare's playground surfacing, a warehouse's dock doors…) with its
--     condition ('Not Assessed' / 'Not Applicable' allowed), an issue, a
--     documented repair estimate and its source. AI suggestions start
--     'suggested' and only count once the owner confirms them; owner entries
--     are 'confirmed' from the start. Evidence links back to the document and
--     the page (reports) or the video timestamp (videos).
--   improvement_media: each report / photo / video AI read, deduplicated by
--     file content per property.
create table if not exists public.improvement_buildings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  property_id uuid not null references public.properties (id) on delete cascade,
  name text not null default 'Main building',
  improvement_types text[] not null default '{}',
  custom_features text[] not null default '{}',
  details jsonb not null default '{}'::jsonb,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint improvement_buildings_name_len check (length(name) between 1 and 80)
);
create index if not exists improvement_buildings_property_idx on public.improvement_buildings (property_id);

create table if not exists public.improvement_media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  property_id uuid not null references public.properties (id) on delete cascade,
  document_id uuid references public.documents (id) on delete set null,
  building_id uuid references public.improvement_buildings (id) on delete set null,
  kind text not null,
  file_name text not null,
  content_hash text not null,
  status text not null default 'reading',
  title text,
  report_date text,
  capture_date text,
  location_note text,
  summary text,
  quality_note text,
  error text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (property_id, content_hash),
  constraint improvement_media_kind check (kind in ('report', 'photo', 'video')),
  constraint improvement_media_status check (status in ('reading', 'read', 'failed'))
);
create index if not exists improvement_media_property_idx on public.improvement_media (property_id);

create table if not exists public.improvement_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  property_id uuid not null references public.properties (id) on delete cascade,
  building_id uuid references public.improvement_buildings (id) on delete cascade,
  media_id uuid references public.improvement_media (id) on delete set null,
  section text not null,
  component text not null,
  condition text not null default 'Not Assessed',
  issue text,
  observation text,
  repair_estimate numeric,
  estimate_source text,
  fixed_or_movable text,
  page integer,
  video_time text,
  needs_professional boolean not null default false,
  uncertain text,
  source text not null default 'owner',
  status text not null default 'confirmed',
  content_key text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, content_key),
  constraint improvement_items_condition check (
    condition in ('Good', 'Fair', 'Poor', 'Not Assessed', 'Not Applicable')
  ),
  constraint improvement_items_source check (source in ('owner', 'report', 'photo', 'video')),
  constraint improvement_items_status check (status in ('suggested', 'confirmed', 'rejected')),
  constraint improvement_items_fixed check (fixed_or_movable is null or fixed_or_movable in ('fixed', 'movable')),
  constraint improvement_items_estimate check (repair_estimate is null or repair_estimate >= 0),
  constraint improvement_items_text_len check (
    coalesce(length(issue), 0) <= 1000 and coalesce(length(observation), 0) <= 1000
  )
);
create index if not exists improvement_items_property_idx on public.improvement_items (property_id);
create index if not exists improvement_items_building_idx on public.improvement_items (building_id);

alter table public.improvement_buildings enable row level security;
alter table public.improvement_media enable row level security;
alter table public.improvement_items enable row level security;

do $do$
declare
  t text;
begin
  foreach t in array array['improvement_buildings', 'improvement_media', 'improvement_items'] loop
    execute format('drop policy if exists "Owners manage" on public.%I', t);
    execute format('create policy "Owners manage" on public.%I for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format('drop policy if exists "Admins read" on public.%I', t);
    execute format('create policy "Admins read" on public.%I for select using (public.is_admin())', t);
    execute format('drop policy if exists "Members read" on public.%I', t);
    execute format('create policy "Members read" on public.%I for select using (public.member_access(user_id, property_id, false))', t);
    execute format('drop policy if exists "Property managers write" on public.%I', t);
    execute format('create policy "Property managers write" on public.%I for insert with check (public.member_access(user_id, property_id, true))', t);
    execute format('drop policy if exists "Property managers update" on public.%I', t);
    execute format('create policy "Property managers update" on public.%I for update using (public.member_access(user_id, property_id, true)) with check (public.member_access(user_id, property_id, true))', t);
    execute format('drop policy if exists "Property managers delete" on public.%I', t);
    execute format('create policy "Property managers delete" on public.%I for delete using (public.member_access(user_id, property_id, true))', t);
    execute format('drop trigger if exists %I on public.%I', t || '_owner', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.site_report_owner()', t || '_owner', t);
  end loop;
end
$do$;

-- A building's / item's other ids must belong to the same property.
create or replace function public.improvement_item_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.building_id is not null and not exists (
    select 1 from public.improvement_buildings b where b.id = new.building_id and b.property_id = new.property_id
  ) then
    raise exception 'That building belongs to another property.';
  end if;
  if new.media_id is not null and not exists (
    select 1 from public.improvement_media m where m.id = new.media_id and m.property_id = new.property_id
  ) then
    raise exception 'That upload belongs to another property.';
  end if;
  -- an owner entry is the owner's own record; an AI suggestion starts unconfirmed
  if tg_op = 'INSERT' and new.source <> 'owner' and auth.uid() is not null then
    new.status := 'suggested';
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.decided_at := case when new.status = 'suggested' then null else now() end;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists improvement_item_guard on public.improvement_items;
create trigger improvement_item_guard before insert or update on public.improvement_items
  for each row execute function public.improvement_item_guard();

grant select, insert, update, delete on public.improvement_buildings to authenticated;
grant select, insert, update, delete on public.improvement_media to authenticated;
grant select, insert, update, delete on public.improvement_items to authenticated;
