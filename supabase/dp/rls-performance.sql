-- Generated 2026-10-18 from the live DP catalog by rls-initplan.mjs.
-- 1) RLS: wrap auth.*() / current_setting() in (select …) — same rules, evaluated once per query.
alter policy "own profile: select" on "public"."profiles" using (((select auth.uid()) = id));
alter policy "own profile: update" on "public"."profiles" using (((select auth.uid()) = id));
alter policy "own acceptances: select" on "public"."terms_acceptances" using ((((select auth.uid()) = user_id) OR is_admin()));
alter policy "own projects: all" on "public"."projects" using (((select auth.uid()) = user_id)) with check (((select auth.uid()) = user_id));
alter policy "own design: all" on "public"."design_requests" using (((select auth.uid()) = user_id)) with check (((select auth.uid()) = user_id));
alter policy "own engagement: all" on "public"."engagement_requests" using (((select auth.uid()) = user_id)) with check (((select auth.uid()) = user_id));
alter policy "own referral invites: select" on "public"."referral_invites" using ((referrer_id = (select auth.uid())));
alter policy "own referral invites: delete" on "public"."referral_invites" using ((referrer_id = (select auth.uid())));
-- 2) Index foreign keys that had no covering index.
create index if not exists "profiles_referred_by_fk_idx" on profiles (referred_by);
create index if not exists "terms_acceptances_user_id_fk_idx" on terms_acceptances (user_id);
create index if not exists "projects_user_id_fk_idx" on projects (user_id);
create index if not exists "project_permits_project_id_fk_idx" on project_permits (project_id);
create index if not exists "project_checklist_items_project_id_fk_idx" on project_checklist_items (project_id);
create index if not exists "project_notifications_project_id_fk_idx" on project_notifications (project_id);
create index if not exists "project_documents_project_id_fk_idx" on project_documents (project_id);
create index if not exists "city_communications_project_id_fk_idx" on city_communications (project_id);
create index if not exists "review_comments_project_id_fk_idx" on review_comments (project_id);
create index if not exists "design_requests_user_id_fk_idx" on design_requests (user_id);
create index if not exists "engagement_requests_project_id_fk_idx" on engagement_requests (project_id);
create index if not exists "engagement_requests_user_id_fk_idx" on engagement_requests (user_id);
create index if not exists "ai_logs_user_id_fk_idx" on ai_logs (user_id);
create index if not exists "invited_users_invited_by_fk_idx" on invited_users (invited_by);
create index if not exists "project_inspections_permit_id_fk_idx" on project_inspections (permit_id);
create index if not exists "project_inspections_project_id_fk_idx" on project_inspections (project_id);
create index if not exists "project_daily_logs_project_id_fk_idx" on project_daily_logs (project_id);
create index if not exists "project_rfis_project_id_fk_idx" on project_rfis (project_id);
create index if not exists "project_portal_logins_updated_by_fk_idx" on project_portal_logins (updated_by);
