-- Security-definer functions only signed-in users (or triggers) need are no
-- longer callable by anonymous visitors (Supabase advisor
-- anon_security_definer_function_executable). Each already checks auth.uid()
-- / is_admin inside; this is defence in depth. is_admin and owns_project keep
-- anon EXECUTE — RLS policies call them for anonymous queries too.
revoke execute on function public.admin_set_is_admin(uuid, boolean) from public, anon;
grant execute on function public.admin_set_is_admin(uuid, boolean) to authenticated;
revoke execute on function public.get_my_referrals() from public, anon;
grant execute on function public.get_my_referrals() to authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
