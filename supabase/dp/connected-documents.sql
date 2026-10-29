-- Documents page: connected sources, imported-file review, versions and
-- submission packages (Project → Permit → Submission round).
--
-- * project_documents rows are file VERSIONS; versions of one logical document
--   share doc_group (null = the row is its own group). A version is a working
--   draft until it's released for permitting; city-approved copies are their
--   own release state. Each version keeps where it came from (manual upload or
--   a connected source).
-- * A permit's requirements are its submission checklist items; each points at
--   the exact version selected for the next package and carries a preparation
--   status (missing → requested → received → internal review → revision
--   required → ready). Ready needs a released version.
-- * permit_packages: the working package for a permit's next round; freezing
--   it locks the exact version selections. When the round is filed (the
--   permit_submissions trigger), the frozen list — or, if nothing was frozen,
--   whatever was selected — is copied into permit_submissions.manifest, which
--   customers can never edit.
-- * document_sources / document_imports / document_source_log: collection
--   from a project's own email inbox (dp-<token>@inbox.corvusre.com, which
--   city portals' notification emails can go to as well). Collected files wait
--   in document_imports for review; filing one creates a Received version —
--   never Submitted or Approved.

-- ── versions ───────────────────────────────────────────────────────────────
alter table public.project_documents add column if not exists doc_group uuid;
alter table public.project_documents add column if not exists version_label text;
alter table public.project_documents add column if not exists release_status text;
alter table public.project_documents add column if not exists doc_kind text;
alter table public.project_documents add column if not exists owner_party text;
alter table public.project_documents add column if not exists permit_id uuid
  references public.project_permits(id) on delete set null;
alter table public.project_documents add column if not exists submission_id uuid
  references public.permit_submissions(id) on delete set null;
alter table public.project_documents add column if not exists content_hash text;
alter table public.project_documents add column if not exists released_at timestamptz;
alter table public.project_documents add column if not exists release_note text;
alter table public.project_documents add column if not exists source_id uuid;
alter table public.project_documents add column if not exists source_record text;
alter table public.project_documents add column if not exists source_at timestamptz;
-- everything already on file was in use before versions existed: released
update public.project_documents set release_status = 'released' where release_status is null;
alter table public.project_documents alter column release_status set default 'working_draft';
alter table public.project_documents alter column release_status set not null;
alter table public.project_documents drop constraint if exists project_documents_release_status_check;
alter table public.project_documents add constraint project_documents_release_status_check
  check (release_status in ('working_draft', 'released', 'city_approved'));
create index if not exists project_documents_group_idx on public.project_documents (doc_group);
create index if not exists project_documents_hash_idx on public.project_documents (project_id, content_hash);

revoke update on public.project_documents from authenticated, anon;
grant update (name, category, note, discipline, mime_type, size_bytes, page_count, cad_summary,
  doc_group, version_label, release_status, doc_kind, owner_party, permit_id, submission_id,
  released_at, release_note, content_hash)
  on public.project_documents to authenticated;

-- ── requirements (a permit's submission checklist items) ──────────────────
alter table public.project_checklist_items add column if not exists document_id uuid
  references public.project_documents(id) on delete set null;
alter table public.project_checklist_items add column if not exists prep_status text;
alter table public.project_checklist_items add column if not exists owner_party text;
alter table public.project_checklist_items add column if not exists due_date date;
alter table public.project_checklist_items add column if not exists review_note text;
alter table public.project_checklist_items drop constraint if exists project_checklist_items_prep_status_check;
alter table public.project_checklist_items add constraint project_checklist_items_prep_status_check
  check (prep_status is null or prep_status in
    ('missing', 'requested', 'received', 'internal_review', 'revision_required', 'ready'));

-- Ready means a released version is selected; ticking it done keeps the
-- Checklist page in step. A new selection goes back to internal review.
create or replace function public.guard_requirement()
returns trigger language plpgsql as $$
declare v_release text;
begin
  if new.document_id is distinct from old.document_id and new.document_id is not null
     and coalesce(new.prep_status, '') = coalesce(old.prep_status, '') then
    new.prep_status := 'internal_review';
  end if;
  if new.document_id is null and new.prep_status in ('received', 'internal_review', 'ready') then
    new.prep_status := 'missing';
  end if;
  if new.prep_status = 'ready' then
    select release_status into v_release from public.project_documents where id = new.document_id;
    if v_release is distinct from 'released' then
      raise exception 'Only a version released for permitting can be marked ready.';
    end if;
  end if;
  if new.prep_status is distinct from old.prep_status then
    if new.prep_status = 'ready' then new.done := true;
    elsif old.prep_status = 'ready' then new.done := false;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_requirement on public.project_checklist_items;
create trigger guard_requirement before update on public.project_checklist_items
  for each row execute function public.guard_requirement();

-- ── working packages ───────────────────────────────────────────────────────
create table if not exists public.permit_packages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  permit_id uuid not null references public.project_permits(id) on delete cascade,
  round integer not null,
  status text not null default 'draft' check (status in ('draft', 'frozen', 'submitted')),
  frozen_at timestamptz,
  frozen_manifest jsonb,
  reopen_log jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (permit_id, round)
);
alter table public.permit_packages enable row level security;
drop policy if exists "packages: all" on public.permit_packages;
create policy "packages: all" on public.permit_packages
  for all using (public.owns_project(project_id)) with check (public.owns_project(project_id));
revoke update on public.permit_packages from authenticated, anon;
grant update (status, frozen_at, frozen_manifest, reopen_log, updated_at)
  on public.permit_packages to authenticated;

-- Freezing locks the exact selections and needs every required item ready; a
-- submitted package can't be reopened or edited.
create or replace function public.guard_package()
returns trigger language plpgsql as $$
declare v_missing int; v_key text;
begin
  if old.status = 'submitted' and current_user <> 'postgres' then
    raise exception 'This package has been submitted and can no longer change.';
  end if;
  if new.status = 'frozen' and old.status = 'draft' then
    select permit_key into v_key from public.project_permits where id = new.permit_id;
    select count(*) into v_missing from public.project_checklist_items c
      where c.project_id = new.project_id and c.permit_key = v_key and c.kind = 'submission'
        and c.required and coalesce(c.prep_status, 'missing') <> 'ready';
    if v_missing > 0 then
      raise exception '% required document(s) are not ready for the package.', v_missing;
    end if;
    new.frozen_at := now();
    new.frozen_manifest := (
      select coalesce(jsonb_agg(jsonb_build_object(
        'requirement_id', c.id, 'requirement', c.label,
        'document_id', d.id, 'doc_group', coalesce(d.doc_group, d.id),
        'name', d.name, 'version_label', d.version_label
      ) order by c.label), '[]'::jsonb)
      from public.project_checklist_items c
      join public.project_documents d on d.id = c.document_id
      where c.project_id = new.project_id and c.permit_key = v_key and c.kind = 'submission');
  end if;
  if new.status = 'submitted' and old.status <> 'submitted' and current_user <> 'postgres' then
    raise exception 'A package becomes submitted only when the permit is filed.';
  end if;
  if new.status = 'draft' and old.status = 'frozen' then
    new.reopen_log := old.reopen_log || jsonb_build_array(jsonb_build_object(
      'at', now(), 'frozen_at', old.frozen_at, 'manifest', old.frozen_manifest));
    new.frozen_at := null;
    new.frozen_manifest := null;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists guard_package on public.permit_packages;
create trigger guard_package before update on public.permit_packages
  for each row execute function public.guard_package();

-- ── submitted manifests ────────────────────────────────────────────────────
alter table public.permit_submissions add column if not exists manifest jsonb;
alter table public.permit_submissions add column if not exists manifest_basis text;

create or replace function public.snapshot_submission_manifest()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_pkg public.permit_packages; v_key text;
begin
  select * into v_pkg from public.permit_packages
    where permit_id = new.permit_id and round = new.round;
  if v_pkg.id is not null and v_pkg.status = 'frozen' then
    new.manifest := v_pkg.frozen_manifest;
    new.manifest_basis := 'frozen_package';
    update public.permit_packages set status = 'submitted', updated_at = now() where id = v_pkg.id;
  else
    select permit_key into v_key from public.project_permits where id = new.permit_id;
    new.manifest := (
      select coalesce(jsonb_agg(jsonb_build_object(
        'requirement_id', c.id, 'requirement', c.label,
        'document_id', d.id, 'doc_group', coalesce(d.doc_group, d.id),
        'name', d.name, 'version_label', d.version_label
      ) order by c.label), '[]'::jsonb)
      from public.project_checklist_items c
      join public.project_documents d on d.id = c.document_id
      where c.project_id = new.project_id and c.permit_key = v_key and c.kind = 'submission');
    new.manifest_basis := 'selected_at_filing';
    if v_pkg.id is not null then
      update public.permit_packages set status = 'submitted', updated_at = now() where id = v_pkg.id;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.snapshot_submission_manifest() from public, anon, authenticated;
drop trigger if exists snapshot_submission_manifest on public.permit_submissions;
create trigger snapshot_submission_manifest before insert on public.permit_submissions
  for each row execute function public.snapshot_submission_manifest();

-- ── connected sources ──────────────────────────────────────────────────────
create table if not exists public.document_sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  type text not null check (type in ('email', 'portal', 'folder')),
  name text not null,
  provider text,
  reference text,
  inbox_token text unique default encode(gen_random_bytes(5), 'hex'),
  match_domains text[] not null default '{}',
  permit_ids uuid[] not null default '{}',
  status text not null default 'connected'
    check (status in ('connected', 'needs_setup', 'disconnected', 'sync_failed')),
  last_success timestamptz,
  last_attempt timestamptz,
  auto_file boolean not null default false,
  owner_party text,
  message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists document_sources_project_idx on public.document_sources (project_id);
alter table public.document_sources enable row level security;
drop policy if exists "sources: all" on public.document_sources;
create policy "sources: all" on public.document_sources
  for all using (public.owns_project(project_id)) with check (public.owns_project(project_id));
revoke update on public.document_sources from authenticated, anon;
grant update (name, provider, reference, match_domains, permit_ids, status, auto_file,
  owner_party, message, updated_at) on public.document_sources to authenticated;

alter table public.project_documents drop constraint if exists project_documents_source_fk;
alter table public.project_documents add constraint project_documents_source_fk
  foreign key (source_id) references public.document_sources(id) on delete set null;

create table if not exists public.document_imports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source_id uuid references public.document_sources(id) on delete set null,
  source_record text not null,
  from_address text,
  subject text,
  filename text not null,
  storage_path text,
  mime_type text,
  size_bytes bigint,
  content_hash text,
  source_at timestamptz,
  collected_at timestamptz not null default now(),
  status text not null default 'needs_review'
    check (status in ('ready', 'needs_review', 'filed', 'duplicate', 'link_only', 'ignored')),
  -- the AI's suggested match (always shown as a suggestion, with its reason)
  permit_id uuid references public.project_permits(id) on delete set null,
  requirement_id uuid references public.project_checklist_items(id) on delete set null,
  doc_group uuid,
  title text,
  doc_kind text,
  discipline text,
  revision text,
  destination text not null default 'library',
  confidence numeric,
  match_summary text,
  reason text,
  round_evidence text,
  link_url text,
  existing_document_id uuid references public.project_documents(id) on delete set null,
  filed_document_id uuid references public.project_documents(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  unique (project_id, source_record)
);
create index if not exists document_imports_project_idx on public.document_imports (project_id, status);
alter table public.document_imports enable row level security;
drop policy if exists "imports: read" on public.document_imports;
create policy "imports: read" on public.document_imports
  for select using (public.owns_project(project_id));
drop policy if exists "imports: update" on public.document_imports;
create policy "imports: update" on public.document_imports
  for update using (public.owns_project(project_id)) with check (public.owns_project(project_id));
revoke insert, delete, update on public.document_imports from authenticated, anon;
grant update (status, permit_id, requirement_id, doc_group, title, doc_kind, discipline, revision,
  destination, filed_document_id, existing_document_id, decided_at, decision_note)
  on public.document_imports to authenticated;

-- An import is filed, skipped or ignored by a person; filing never marks
-- anything submitted or approved (the version it creates is a working draft).
create or replace function public.guard_import()
returns trigger language plpgsql as $$
begin
  if old.status in ('filed', 'duplicate', 'ignored') and new.status <> old.status
     and current_user <> 'postgres' then
    raise exception 'This imported file has already been decided.';
  end if;
  if new.status = 'filed' and new.filed_document_id is null then
    raise exception 'Filing needs the version it created.';
  end if;
  if new.status <> old.status then new.decided_at := now(); end if;
  return new;
end $$;
drop trigger if exists guard_import on public.document_imports;
create trigger guard_import before update on public.document_imports
  for each row execute function public.guard_import();

create table if not exists public.document_source_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source_id uuid references public.document_sources(id) on delete set null,
  at timestamptz not null default now(),
  result text not null,
  detail text
);
create index if not exists document_source_log_project_idx on public.document_source_log (project_id, at desc);
alter table public.document_source_log enable row level security;
drop policy if exists "source log: read" on public.document_source_log;
create policy "source log: read" on public.document_source_log
  for select using (public.owns_project(project_id));
drop policy if exists "source log: add" on public.document_source_log;
create policy "source log: add" on public.document_source_log
  for insert with check (public.owns_project(project_id));
revoke update, delete on public.document_source_log from authenticated, anon;

-- Files collected by the server are stored without an owner; give them to the
-- project's owner so storage's owner-only rule lets them open the file.
create or replace function public.set_project_doc_owner(p_name text, p_owner uuid)
returns void language sql security definer set search_path = public, storage as $$
  update storage.objects set owner = p_owner, owner_id = p_owner::text
  where bucket_id = 'project-docs' and name = p_name;
$$;
revoke all on function public.set_project_doc_owner(text, uuid) from public, anon, authenticated;
grant execute on function public.set_project_doc_owner(text, uuid) to service_role;
