-- Pay Taxes → "Add BPP" (2026-11-10): a business personal property account's
-- own tax bill — amount due, amount paid, due date, and when it was paid —
-- so BPP accounts sit on Pay Taxes beside the real-estate properties. Kept on
-- bpp_accounts itself (BPP isn't real estate; tax_bills is per property).
alter table public.bpp_accounts add column if not exists tax_amount_due numeric;
alter table public.bpp_accounts add column if not exists tax_amount_paid numeric;
alter table public.bpp_accounts add column if not exists payment_due_date date;
alter table public.bpp_accounts add column if not exists paid_at timestamptz;

-- The owner's own entries, like properties' payment_due_date / tax_amount_due /
-- paid_at (column-level grants — see schema.sql).
grant insert (tax_amount_due, tax_amount_paid, payment_due_date, paid_at)
  on public.bpp_accounts to authenticated;
grant update (tax_amount_due, tax_amount_paid, payment_due_date, paid_at)
  on public.bpp_accounts to authenticated;
