-- Security review, November 2026.
--
-- 1. Internal helpers that were callable by any signed-in user (and some by
--    signed-out visitors) through the REST API. None is called from the
--    browser — they run inside other database functions, triggers, scheduled
--    jobs and server functions, which keep working (those run as the owner
--    or the service role).
--      marketing_period_metrics  internal revenue / spend / staff figures
--      marketing_can_contact     a lead's contact status
--      actor_label, owner_label  any user's name or email from their id
--      pick_owner                which staff member gets the next case
--      property_hold_reason      any property's verification status
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('marketing_period_metrics', 'marketing_can_contact', 'actor_label',
                        'owner_label', 'pick_owner', 'property_hold_reason')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

-- 2. Pin search_path on the functions that didn't set one, so a function
--    can never resolve a table or function from an unexpected schema.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proconfig is null
      and p.proname in ('touch_updated_at', 'marketing_stage_label', 'marketing_rule_mode',
                        'marketing_next_business_morning', 'marketing_monthly_price',
                        'entity_department', 'transfer_allowed')
  loop
    execute format('alter function %s set search_path = public', f.sig);
  end loop;
end $$;

-- 3. Uploads: cap a single file at 50 MB (largest stored today is 6 MB).
update storage.buckets set file_size_limit = 52428800 where id = 'documents';
