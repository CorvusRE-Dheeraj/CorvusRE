-- Personal Property tab (2026-11-12): what the rebuilt BPP workflow keeps per
-- account (apps/pt/src/lib/bpp-accounts.ts). Files live in the documents
-- bucket under the owner's folder ({user_id}/bpp/{account_id}/…) — BPP
-- accounts aren't properties, so they aren't Documents rows.
alter table public.bpp_accounts
  -- the CorvusPT property the business operates at, when known (no duplicates)
  add column if not exists property_id uuid references public.properties (id) on delete set null,
  -- how the record was added: existing | document | manual | podio | csv
  add column if not exists source text,
  add column if not exists podio_item_id text,
  -- Form 50-144 answers and asset schedule, saved as the owner fills it
  add column if not exists rendition_values jsonb,
  -- submission (only ever set when the owner records it)
  add column if not exists rendition_submission_method text,
  add column if not exists rendition_submission_note text,
  add column if not exists rendition_confirmation_path text,
  -- Corvus AI's check of an uploaded hand-signed rendition
  add column if not exists rendition_verification jsonb,
  -- extension request (never assumed granted)
  add column if not exists extension_requested_at timestamptz,
  add column if not exists extension_granted_until date,
  -- the BPP tax bill
  add column if not exists taxable_value numeric,
  add column if not exists exemptions text,
  add column if not exists taxing_units jsonb,
  add column if not exists tax_bill_path text,
  add column if not exists payment_method text,
  add column if not exists payment_confirmation_path text;

grant update (
  property_id, source, podio_item_id, rendition_values, rendition_submission_method,
  rendition_submission_note, rendition_confirmation_path, rendition_verification,
  extension_requested_at, extension_granted_until, taxable_value, exemptions,
  taxing_units, tax_bill_path, payment_method, payment_confirmation_path
) on public.bpp_accounts to authenticated;
grant insert (property_id, source, podio_item_id) on public.bpp_accounts to authenticated;
