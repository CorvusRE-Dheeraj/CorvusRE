-- Client-chosen project name for a design request, entered before the
-- property on the Design Brief. Older rows have none; the app falls back to
-- the address.
alter table public.design_requests
  add column if not exists project_name text;

alter table public.design_requests
  drop constraint if exists design_requests_project_name_len;
alter table public.design_requests
  add constraint design_requests_project_name_len
  check (project_name is null or char_length(project_name) between 1 and 120);
