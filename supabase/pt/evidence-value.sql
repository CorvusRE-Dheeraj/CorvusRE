-- What an uploaded evidence document says about the property's value (see the
-- extract-evidence-value edge function and src/lib/evidence-value.ts). Written ONLY by that
-- function (service role) — never by the browser — so it is deliberately NOT added to the
-- column grant on public.documents. value_signal is the structured result; value_signal_at
-- is when the file was read. The AI Report scores and the savings estimate are computed from
-- these stored results, so they change when evidence is uploaded, never on a plain refresh.
alter table public.documents
  add column if not exists value_signal jsonb,
  add column if not exists value_signal_at timestamptz;
