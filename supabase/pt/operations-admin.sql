-- Operations Admin (2026-10-20): the staff who run protest cases, the county
-- mailbox and appointments, without full Super Admin access. The Super Admin
-- page becomes a statistics dashboard with buttons into the Marketing, Support
-- and Operations dashboards; user/plan/role management and settings stay
-- Super-Admin-only (/admin-manage).
--
-- Operations access is granted table by table, mirroring the existing Super
-- Admin rules on CASE-WORK tables only (never DELETE). Users/plans, Stripe,
-- settings, beta, invites and marketing data are not included. Profiles stay
-- closed — operations_customer_contacts() returns just names and emails.
-- profiles.operations_admin can't be self-set: authenticated users may only
-- update first/last name, phone, company, notification prefs and calendar token.

alter table public.profiles add column if not exists operations_admin boolean not null default false;

create or replace function public.is_operations_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin or p.operations_admin from public.profiles p where p.id = auth.uid()), false);
$$;
revoke all on function public.is_operations_admin() from public, anon;
grant execute on function public.is_operations_admin() to authenticated;

create or replace function public.set_operations_admin(target uuid, enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if not public.is_admin() then
    raise exception 'Only a Super Admin can change operations access' using errcode = '42501';
  end if;
  update public.profiles set operations_admin = enabled where id = target returning email into v_email;
  if not found then raise exception 'No such user'; end if;
  insert into public.admin_audit_log (actor_id, actor_email, action, target_user_id, target_email, detail)
  values (auth.uid(), (select email from public.profiles where id = auth.uid()),
          case when enabled then 'grant_operations_admin' else 'revoke_operations_admin' end, target, v_email,
          case when enabled then 'Operations Admin access granted' else 'Operations Admin access removed' end);
end; $$;
revoke all on function public.set_operations_admin(uuid, boolean) from public, anon;
grant execute on function public.set_operations_admin(uuid, boolean) to authenticated;

-- names/emails/phones of customers for Operations (cases) and Support (escalations) —
-- nothing else from profiles
drop function if exists public.operations_customer_contacts(uuid[]);
create or replace function public.customer_contacts(p_ids uuid[])
returns table (id uuid, email text, first_name text, last_name text, phone text, company_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_operations_admin() or public.is_support_admin()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query select p.id, p.email, p.first_name, p.last_name, p.phone, p.company_name
    from public.profiles p where p.id = any(p_ids);
end; $$;
revoke all on function public.customer_contacts(uuid[]) from public, anon;
grant execute on function public.customer_contacts(uuid[]) to authenticated;

-- mirror the Super Admin rules on the case-work tables for Operations
do $$
declare
  r record;
  case_tables text[] := array[
    'protests', 'properties', 'documents', 'protest_evidence_items', 'protest_form_submissions',
    'hearing_notices', 'decision_notices', 'settlement_agreements', 'valuation_worksheets',
    'comp_selections', 'module_results', 'property_base_data', 'property_ai_scores',
    'assessment_changes', 'cad_evidence_reviews', 'case_audit_events', 'protest_authorizations',
    'engagement_packets', 'income_analysis', 'mock_hearings', 'property_issues', 'tax_bills',
    'savings_tax_inputs', 'county_emails', 'appointments', 'appointment_blocks',
    'appointment_settings', 'service_agreement_acceptances', 'admin_audit_log'];
  v_name text;
  v_sql text;
begin
  for r in
    select schemaname, tablename, policyname, cmd, permissive, roles, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and tablename = any(case_tables)
      and cmd <> 'DELETE'
      and (coalesce(qual, '') ilike '%is_admin()%' or coalesce(with_check, '') ilike '%is_admin()%')
      and policyname not ilike 'Operations:%'
      -- properties: read only (adding properties for users is account management)
      and not (tablename = 'properties' and cmd <> 'SELECT')
      -- the audit log: operations may write their own entries, not read everyone's
      and not (tablename = 'admin_audit_log' and cmd <> 'INSERT')
  loop
    v_name := left('Operations: ' || r.policyname, 63);
    execute format('drop policy if exists %I on %I.%I', v_name, r.schemaname, r.tablename);
    v_sql := format('create policy %I on %I.%I as %s for %s to %s', v_name, r.schemaname, r.tablename,
      r.permissive, r.cmd, array_to_string(r.roles, ', '));
    if r.qual is not null then
      v_sql := v_sql || format(' using (%s)', replace(r.qual, 'is_admin()', 'is_operations_admin()'));
    end if;
    if r.with_check is not null then
      v_sql := v_sql || format(' with check (%s)', replace(r.with_check, 'is_admin()', 'is_operations_admin()'));
    end if;
    execute v_sql;
  end loop;
end $$;

-- case documents in storage: operations can upload like Super Admins
drop policy if exists "Operations: upload case documents" on storage.objects;
create policy "Operations: upload case documents" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.is_operations_admin());

-- support escalations move to the Customer Support dashboard
drop policy if exists "Support staff manage support escalations" on public.support_escalations;
create policy "Support staff manage support escalations" on public.support_escalations for all to authenticated
  using (public.is_support_admin()) with check (public.is_support_admin());
