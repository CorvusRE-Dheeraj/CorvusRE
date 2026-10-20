-- Design module: the land survey for a design request (2026-10-20).
-- One survey file per design request (PNG, JPEG or PDF, up to 15 MB), kept in
-- a private bucket under <user id>/<design request id>/… so each owner can
-- only reach their own. Later steps (setback fit, schematic plans) read it.

alter table public.design_requests
  add column if not exists survey_path text,
  add column if not exists survey_name text,
  add column if not exists survey_type text,
  add column if not exists survey_size integer,
  add column if not exists survey_uploaded_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('design-surveys', 'design-surveys', false, 15728640,
        array['image/png', 'image/jpeg', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- owner-only: the first folder of the path is the owner's user id
drop policy if exists "design surveys: owner read" on storage.objects;
create policy "design surveys: owner read" on storage.objects for select to authenticated
  using (bucket_id = 'design-surveys'
         and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin())));
drop policy if exists "design surveys: owner insert" on storage.objects;
create policy "design surveys: owner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'design-surveys' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "design surveys: owner update" on storage.objects;
create policy "design surveys: owner update" on storage.objects for update to authenticated
  using (bucket_id = 'design-surveys' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "design surveys: owner delete" on storage.objects;
create policy "design surveys: owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'design-surveys' and (storage.foldername(name))[1] = (select auth.uid())::text);
