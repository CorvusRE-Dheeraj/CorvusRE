-- Pay Taxes tab (2026-11-05): county-wise payment portals and payment plans
-- (editable by Operations and Super Admins, so a county that changes its policy offline is a row edit,
-- not a code change), plus per-bill payment status, installments and the
-- user-reported vs county-verified distinction on tax_bills.
--
-- county = the plain county name ("Bexar"), '*' for a statewide rule (Tax Code
-- §31.031 quarter payments). A plan is shown as available only when the
-- property's county has a row for it and the property fits property_types /
-- requirement — see src/lib/pay-taxes.ts planEligibility().

create table if not exists public.county_tax_settings (
  county text primary key,
  -- the county tax assessor-collector's online payment / account search page
  payment_portal_url text,
  -- deep link to one account, with {account} in it; used only when the
  -- property's account number matches account_pattern (a regex)
  account_url_template text,
  account_pattern text,
  -- month-day the year's taxes become delinquent (Tax Code §31.02: Feb 1)
  delinquency_month_day text not null default '02-01',
  notes text,
  source_url text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

create table if not exists public.county_payment_plans (
  id uuid primary key default gen_random_uuid(),
  county text not null,
  plan_key text not null,
  name text not null,
  kind text not null check (kind in ('half', 'quarter', 'monthly', 'prepay', 'discount', 'disaster', 'other')),
  -- 'commercial' | 'residential' | 'bpp'; empty = any property type
  property_types text[] not null default '{}',
  -- a taxpayer condition CorvusPT can't check from county data
  -- ('over65_disabled_dv_homestead', 'disaster_damage') — always "to be confirmed"
  requirement text,
  -- [{ "label": "First half", "pct": 50, "month": 11, "day": 30, "yearOffset": 0 }, …]
  -- dates are relative to the tax year (yearOffset 1 = the following year)
  schedule jsonb not null default '[]',
  enrollment_note text,
  status text not null default 'to_confirm' check (status in ('confirmed', 'to_confirm')),
  source_url text,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  unique (county, plan_key)
);

alter table public.county_tax_settings enable row level security;
alter table public.county_payment_plans enable row level security;
drop policy if exists "Anyone signed in reads county tax settings" on public.county_tax_settings;
create policy "Anyone signed in reads county tax settings" on public.county_tax_settings
  for select to authenticated using (true);
drop policy if exists "Admins edit county tax settings" on public.county_tax_settings;
drop policy if exists "Operations edit county tax settings" on public.county_tax_settings;
create policy "Operations edit county tax settings" on public.county_tax_settings
  for all to authenticated using ((select public.is_operations_admin())) with check ((select public.is_operations_admin()));
drop policy if exists "Anyone signed in reads payment plans" on public.county_payment_plans;
create policy "Anyone signed in reads payment plans" on public.county_payment_plans
  for select to authenticated using (true);
drop policy if exists "Admins edit payment plans" on public.county_payment_plans;
drop policy if exists "Operations edit payment plans" on public.county_payment_plans;
create policy "Operations edit payment plans" on public.county_payment_plans
  for all to authenticated using ((select public.is_operations_admin())) with check ((select public.is_operations_admin()));
revoke all on public.county_tax_settings, public.county_payment_plans from anon;
grant select, insert, update, delete on public.county_tax_settings, public.county_payment_plans to authenticated;
grant select, insert, update, delete on public.county_tax_settings, public.county_payment_plans to service_role;

-- Per-bill payment tracking. status is what the owner reported (or, once a
-- county feed confirms it, status_source = 'county' + verified_at); the app
-- never marks a bill paid because a payment link was clicked.
alter table public.tax_bills add column if not exists status text
  check (status in ('unpaid', 'initiated', 'partial', 'paid', 'overdue', 'verifying'));
alter table public.tax_bills add column if not exists status_source text not null default 'user'
  check (status_source in ('user', 'county'));
alter table public.tax_bills add column if not exists verified_at timestamptz;
alter table public.tax_bills add column if not exists plan_key text;
-- [{ "label", "dueDate", "amount", "paidAt", "amountPaid" }] — one per installment
alter table public.tax_bills add column if not exists installments jsonb not null default '[]';
alter table public.tax_bills add column if not exists notice_issued_at date;
-- [{ "name", "rate", "amount" }] — tax by taxing authority, from the statement
alter table public.tax_bills add column if not exists authority_breakdown jsonb not null default '[]';
-- 'statement' = the county tax statement (the real bill); revised/supplemental
-- statements after a protest are 'revised'
alter table public.tax_bills add column if not exists bill_kind text not null default 'statement'
  check (bill_kind in ('statement', 'revised'));
alter table public.tax_bills add column if not exists source text;
alter table public.tax_bills add column if not exists source_url text;
alter table public.tax_bills add column if not exists retrieved_at timestamptz;
alter table public.tax_bills add column if not exists receipt_document_id uuid
  references public.documents (id) on delete set null;
alter table public.tax_bills add column if not exists updated_at timestamptz not null default now();

-- ── Seed: researched 2026-11 (sources on each row). Statewide first. ──
insert into public.county_payment_plans
  (county, plan_key, name, kind, property_types, requirement, schedule, enrollment_note, status, source_url) values
  ('*', 'quarter_homestead', 'Quarter-Payment Plan (homestead)', 'quarter', '{residential}',
   'over65_disabled_dv_homestead',
   '[{"label":"1st quarter","pct":25,"month":1,"day":31,"yearOffset":1},{"label":"2nd quarter","pct":25,"month":3,"day":31,"yearOffset":1},{"label":"3rd quarter","pct":25,"month":5,"day":31,"yearOffset":1},{"label":"4th quarter","pct":25,"month":7,"day":31,"yearOffset":1}]',
   'For a residence homestead with an over-65, disabled, or disabled-veteran exemption. Pay the first quarter before the delinquency date with a notice that you''ll pay the rest in three installments (Tax Code §31.031).',
   'confirmed', 'https://statutes.capitol.texas.gov/Docs/TX/htm/TX.31.htm#31.031'),
  ('*', 'disaster_installments', 'Disaster Installment Plan', 'disaster', '{residential,commercial}',
   'disaster_damage',
   '[{"label":"1st installment","pct":25,"month":1,"day":31,"yearOffset":1},{"label":"2nd installment","pct":25,"month":3,"day":31,"yearOffset":1},{"label":"3rd installment","pct":25,"month":5,"day":31,"yearOffset":1},{"label":"4th installment","pct":25,"month":7,"day":31,"yearOffset":1}]',
   'Only for property damaged in a declared disaster area (homesteads and certain small-business property, Tax Code §31.032). The county tax office tells eligible owners with the bill.',
   'to_confirm', 'https://statutes.capitol.texas.gov/Docs/TX/htm/TX.31.htm#31.032'),
  ('Bexar', 'half_payment', 'Half-Payment Plan', 'half', '{}', null,
   '[{"label":"First half","pct":50,"month":11,"day":30,"yearOffset":0},{"label":"Second half","pct":50,"month":6,"day":30,"yearOffset":1}]',
   'Open to all taxpayers, including commercial real estate and business personal property. Paying the first half by November 30 is the enrollment; a late first half cancels the plan and the full balance is due January 31.',
   'confirmed', 'https://www.bexar.org/DocumentCenter/View/57770/'),
  ('Tarrant', 'half_payment', 'Half-Payment Plan', 'half', '{}', null,
   '[{"label":"First half","pct":50,"month":11,"day":30,"yearOffset":0},{"label":"Second half","pct":50,"month":6,"day":30,"yearOffset":1}]',
   'Pay half on or before November 30 and the rest on or before June 30 without penalty or interest. A late first half can''t be accepted for the plan.',
   'confirmed', 'https://www.tarrantcountytx.gov/en/tax/property-tax/when-to-pay-property-tax.html'),
  ('Galveston', 'half_payment', 'Half-Payment Plan', 'half', '{}', null,
   '[{"label":"First half","pct":50,"month":11,"day":30,"yearOffset":0},{"label":"Second half","pct":50,"month":6,"day":30,"yearOffset":1}]',
   'Pay half by November 30 and the rest by June 30 without penalty or interest.',
   'confirmed', 'https://galvestoncountytx.gov/home/showpublisheddocument/15058/638030005700400000'),
  ('Brazos', 'half_payment', 'Half-Payment Plan', 'half', '{}', null,
   '[{"label":"First half","pct":50,"month":11,"day":30,"yearOffset":0},{"label":"Second half","pct":50,"month":6,"day":30,"yearOffset":1}]',
   'Pay half by November 30 and the rest by June 30 without penalty or interest.',
   'confirmed', 'https://wtaw.com/brazos-county-tax-office-getting-new-automation-equipment-and-issues-reminder-for-upcoming-deadline-to-split-property-tax-payments/'),
  ('Wilson', 'half_payment', 'Half-Payment Plan', 'half', '{}', null,
   '[{"label":"First half","pct":50,"month":11,"day":30,"yearOffset":0},{"label":"Second half","pct":50,"month":6,"day":30,"yearOffset":1}]',
   'Pay half by November 30 and the rest by June 30 without penalty or interest.',
   'confirmed', 'https://newtools.cira.state.tx.us/page/wilson.TaxPaymentPlans'),
  ('Bandera', 'half_payment', 'Half-Payment Plan', 'half', '{}', null,
   '[{"label":"First half","pct":50,"month":11,"day":30,"yearOffset":0},{"label":"Second half","pct":50,"month":6,"day":30,"yearOffset":1}]',
   'Pay half by November 30 and the rest by June 30 without penalty or interest.',
   'confirmed', 'https://www.banderacounty.org/page/tax.landing')
on conflict (county, plan_key) do nothing;

insert into public.county_tax_settings (county, payment_portal_url, account_url_template, account_pattern, notes, source_url) values
  ('Bexar', 'https://bexar.acttax.com/act_webdev/bexar/index.jsp',
   'https://bexar.acttax.com/act_webdev/bexar/showdetail2.jsp?can={account}', '^\d{12}$',
   'Deep link needs the 12-digit tax office account number (not the BCAD property ID).',
   'https://bexar.acttax.com/act_webdev/bexar/index.jsp'),
  ('Tarrant', 'https://taxonline.tarrantcounty.com/TaxPayer/', null, null, null,
   'https://taxonline.tarrantcounty.com/TaxPayer/faq'),
  ('Harris', 'https://www.hctax.net/Property/PropertyTax', null, null,
   'Accepts full and partial payments online.', 'https://www.hctax.net/Property/PropertyTax'),
  ('Travis', 'https://tax-office.traviscountytx.gov/', null, null, null, 'https://tax-office.traviscountytx.gov/'),
  ('Dallas', 'https://www.dallascounty.org/departments/tax/', null, null,
   'Accepts partial payments in any amount at any time.', 'https://www.dallascounty.org/departments/tax/payment-arrangements.php')
on conflict (county) do nothing;

-- 2026-11-05: research for all 254 counties (apps/pt/scripts/build-tx-payment-plans.mjs
-- reads each tax office's own site). half_payment: what the county's site says
-- about the §31.03 split payment — 'offered' / 'not_offered' (an explicit
-- statement) / 'unknown' (the site says nothing either way → owners see "to be
-- confirmed"). The quote + page are kept as the evidence; other_options holds
-- the quarter/installment, partial-payment, discount and pre-pay findings.
alter table public.county_tax_settings add column if not exists half_payment text not null default 'unknown'
  check (half_payment in ('offered', 'not_offered', 'unknown'));
alter table public.county_tax_settings add column if not exists half_payment_quote text;
alter table public.county_tax_settings add column if not exists half_payment_url text;
alter table public.county_tax_settings add column if not exists other_options jsonb not null default '{}';
alter table public.county_tax_settings add column if not exists rules_checked_at date;
