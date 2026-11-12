-- BPP rendition (Form 50-144): keep the copy that was actually signed
-- (2026-11-12). Either the e-signed PDF CorvusPT builds, or the owner's own
-- scan when they signed the printout by hand (rendition_signature_type =
-- 'upload'). Stored in the documents bucket under the owner's folder
-- ({user_id}/bpp/{account_id}/…, covered by the bucket's existing owner
-- policies); BPP accounts aren't properties, so it isn't a Documents row.
alter table public.bpp_accounts add column if not exists rendition_document_path text;
grant update (rendition_document_path) on public.bpp_accounts to authenticated;
