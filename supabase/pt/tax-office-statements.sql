-- The county tax office's live account page, per property (2026-11-11) —
-- Pay Taxes shows the year's levy, amount due, half-payment amount and
-- deadline, last payment, values, exemptions, jurisdictions (each one's levy)
-- and the payment history exactly as the tax office lists them.
--
-- Written only by the property-tax-history edge function (service role,
-- {"kind":"statement"}), refreshed after 12 hours. Bexar for now
-- (bexar.acttax.com, found by the BCAD property ID); other counties get a row
-- with statement = null so they aren't asked again for a day.
--
-- statement = { county, taxAccount, taxYear, ownerLines[], siteAddress, legal,
--   levy, yearAmountDue, delinquentAfter, halfPaymentAmount, halfPaymentDeadline,
--   priorYearsDue, totalDue, lastPaymentAmount, lastPayer, lastPaymentDate,
--   pendingPayments, marketValue, landValue, improvementValue, cappedValue,
--   agValue, exemptions, jurisdictionsNote, jurisdictions[{year, name,
--   taxableValue, levy, fees, totalDue}], payments[{date, rollYear, amount,
--   description, payer}], links{account, statement, delinquentStatement,
--   paymentHistory, jurisdictions, paymentRecord, autoPay, map} }
create table if not exists public.property_tax_statements (
  property_id uuid primary key references public.properties (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  account_number text,
  statement jsonb,
  source_url text,
  retrieved_at timestamptz not null default now()
);
alter table public.property_tax_statements enable row level security;
drop policy if exists "Owners and members read tax statements" on public.property_tax_statements;
create policy "Owners and members read tax statements" on public.property_tax_statements
  for select to authenticated
  using ((select auth.uid()) = user_id or public.member_access(user_id, property_id, false) or (select public.is_admin()));
revoke all on public.property_tax_statements from anon;
grant select on public.property_tax_statements to authenticated;
grant all on public.property_tax_statements to service_role;

-- 2026-11-12: why a read came back empty (error from the county site, or
-- "no account for this number"), so a failing county can be diagnosed.
alter table public.property_tax_statements add column if not exists error text;
