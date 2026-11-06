-- Security review, November 2026.

-- 1. Pin search_path on the guard functions that didn't set one.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proconfig is null
      and p.proname in ('guard_requirement', 'guard_package', 'guard_import')
  loop
    execute format('alter function %s set search_path = public', f.sig);
  end loop;
end $$;

-- 2. Uploads: cap a single project document at 100 MB (drawing sets can be
--    large; the largest stored today is under 1 MB).
update storage.buckets set file_size_limit = 104857600 where id = 'project-docs';

-- 3. Leads come from the signed-out wizard, so anyone can insert one — keep
--    each row to a sensible size so the table can't be used to store junk.
alter table public.leads drop constraint if exists leads_size_sane;
alter table public.leads add constraint leads_size_sane check (
  coalesce(length(email), 0) <= 320
  and coalesce(length(name), 0) <= 200
  and coalesce(length(company), 0) <= 200
  and coalesce(pg_column_size(property), 0) + coalesce(pg_column_size(project), 0)
      + coalesce(pg_column_size(design), 0) <= 65536
) not valid;
