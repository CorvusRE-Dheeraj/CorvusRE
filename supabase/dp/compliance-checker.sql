-- Design & Code Compliance Checker (2026-10-28).
-- A pre-submission quality-control pass over a project's drawing set before it
-- goes to the city — never a city review or a licensed professional's seal.
--
--  1. Upload: drawings live in project_documents (same files the Documents page
--     shows), tagged with their discipline. PDFs (incl. multi-page sets), DXF
--     (parsed in the browser into cad_summary), DWG (stored; needs a DXF/PDF
--     export until a DWG converter is connected).
--  2. Recognition + extraction: Corvus AI reads each PDF sheet by sheet into
--     drawing_index (sheet numbers/titles/discipline/scale, schedules, rooms,
--     dimensions, equipment, references) plus measurable design values, each
--     with its source, basis (printed annotation vs. derived) and confidence.
--  3. Validation: the team confirms or corrects values (compliance_values);
--     confirmed values always win over what the AI read.
--  4. Check: compliance_reviews / compliance_issues — each issue explains the
--     requirement, where it is in the drawings, a suggested fix, and the
--     responsible consultant (project_consultants).

alter table public.project_documents
  add column if not exists discipline text,
  add column if not exists mime_type text,
  add column if not exists size_bytes bigint,
  add column if not exists page_count integer,
  add column if not exists cad_summary jsonb,
  add column if not exists drawing_index jsonb,
  add column if not exists drawing_read_at timestamptz,
  add column if not exists drawing_read_error text;

-- ── consultants on a project ────────────────────────────────────────────────
create table if not exists public.project_consultants (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  discipline text not null,          -- architectural|civil|structural|mep|fire|survey|landscape|other
  firm text,
  contact_name text,
  email text,
  phone text,
  created_at timestamptz not null default now(),
  constraint project_consultants_discipline_check check (
    discipline in ('architectural','civil','structural','mep','fire','survey','landscape','other'))
);
create index if not exists project_consultants_project_idx on public.project_consultants (project_id);
alter table public.project_consultants enable row level security;
drop policy if exists "consultants: all" on public.project_consultants;
create policy "consultants: all" on public.project_consultants
  for all using (public.owns_project(project_id)) with check (public.owns_project(project_id));

-- ── confirmed / corrected design values ─────────────────────────────────────
create table if not exists public.compliance_values (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  key text not null,
  value text,
  unit text,
  status text not null default 'confirmed', -- confirmed|corrected|not_applicable
  consultant_id uuid references public.project_consultants (id) on delete set null,
  note text,
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (project_id, key),
  constraint compliance_values_status_check check (status in ('confirmed','corrected','not_applicable'))
);
alter table public.compliance_values enable row level security;
drop policy if exists "compliance values: all" on public.compliance_values;
create policy "compliance values: all" on public.compliance_values
  for all using (public.owns_project(project_id)) with check (public.owns_project(project_id));

-- ── check runs ──────────────────────────────────────────────────────────────
create table if not exists public.compliance_reviews (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  status text not null default 'running',  -- running|done|failed
  stage text,                               -- what it is doing right now, for the progress line
  document_ids uuid[] not null default '{}',
  summary jsonb,
  error text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint compliance_reviews_status_check check (status in ('running','done','failed'))
);
create index if not exists compliance_reviews_project_idx on public.compliance_reviews (project_id, created_at desc);
alter table public.compliance_reviews enable row level security;
-- runs are written only by the compliance-check function (service role)
drop policy if exists "compliance reviews: read" on public.compliance_reviews;
create policy "compliance reviews: read" on public.compliance_reviews
  for select using (public.owns_project(project_id));

create table if not exists public.compliance_issues (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.compliance_reviews (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  area text not null,          -- zoning|building_fire|civil|mep|accessibility|state|plat
  discipline text not null,    -- same set as project_consultants.discipline
  severity text not null default 'medium', -- critical|high|medium|low
  title text not null,
  requirement text,
  code_reference text,
  code_source text not null default 'ai', -- ai (cited by Corvus AI — verify) | icc | city
  document_id uuid references public.project_documents (id) on delete set null,
  sheet text,
  location text,
  problem text,
  suggested_fix text,
  confidence text not null default 'medium',
  needs_confirmation boolean not null default false,
  consultant_id uuid references public.project_consultants (id) on delete set null,
  status text not null default 'open',    -- open|in_progress|fixed|not_an_issue
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint compliance_issues_status_check check (status in ('open','in_progress','fixed','not_an_issue'))
);
create index if not exists compliance_issues_review_idx on public.compliance_issues (review_id);
create index if not exists compliance_issues_project_idx on public.compliance_issues (project_id);
create index if not exists compliance_issues_consultant_idx on public.compliance_issues (consultant_id);
create index if not exists compliance_issues_document_idx on public.compliance_issues (document_id);
create index if not exists compliance_values_consultant_idx on public.compliance_values (consultant_id);
alter table public.compliance_issues enable row level security;
drop policy if exists "compliance issues: read" on public.compliance_issues;
create policy "compliance issues: read" on public.compliance_issues
  for select using (public.owns_project(project_id));
-- the team works issues (status, assignee, note); everything the AI wrote stays as written
drop policy if exists "compliance issues: update" on public.compliance_issues;
create policy "compliance issues: update" on public.compliance_issues
  for update using (public.owns_project(project_id)) with check (public.owns_project(project_id));
revoke update on public.compliance_issues from authenticated, anon;
grant update (status, consultant_id, note, updated_at) on public.compliance_issues to authenticated;

-- what the AI read stays the AI's: clients can tag/describe a document but not
-- write its reading (the compliance-check function does, as service role)
revoke update on public.project_documents from authenticated, anon;
grant update (name, category, note, discipline, mime_type, size_bytes, page_count, cad_summary)
  on public.project_documents to authenticated;
