-- Security-definer functions only signed-in users (or triggers) need are no
-- longer callable by anonymous visitors (Supabase advisor
-- anon_security_definer_function_executable). Each already checks auth.uid()
-- inside; this is defence in depth. Functions used inside RLS policies
-- (is_admin, member_access, member_access_protest, property_is_paid,
-- bpp_is_paid) keep anon EXECUTE — policies run for anonymous queries too.
revoke execute on function public.accept_account_invite(text) from public, anon;
grant execute on function public.accept_account_invite(text) to authenticated;
revoke execute on function public.get_my_referrals() from public, anon;
grant execute on function public.get_my_referrals() to authenticated;
-- Trigger functions: nobody calls these directly (triggers don't need EXECUTE).
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.prevent_duplicate_active_protest() from public, anon, authenticated;
-- pg_trgm out of the public schema (advisor extension_in_public); nothing uses it.
alter extension pg_trgm set schema extensions;
