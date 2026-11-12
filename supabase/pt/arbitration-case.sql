-- Arbitration workflow state per protest (2026-11-12): application, evidence
-- copy, settlement, arbitrator/hearing, award and post-award tracking, one
-- jsonb like court_appeal (apps/pt/src/lib/arbitration-case.ts). Owner-
-- writable like the other protest fields.
alter table public.protests add column if not exists arbitration jsonb;
