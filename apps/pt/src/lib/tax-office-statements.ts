import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";
import { countyFromCad } from "./tax-rates-official";
import type { TaxOfficeStatement } from "../../../../supabase/pt/functions/_shared/act-tax-office";
import {
  isTaxOfficeBlocked,
  isTaxOfficeConnected,
} from "../../../../supabase/pt/functions/_shared/tax-office";

export type {
  TaxOfficeStatement,
  TaxOfficeJurisdiction,
  TaxOfficePayment,
} from "../../../../supabase/pt/functions/_shared/act-tax-office";

// The county tax office's own account page for a property — the year's levy,
// amount due, half payment, last payment, values, jurisdictions and payment
// history (supabase/pt/functions/_shared/act-tax-office.ts). Read by
// property-tax-history ({"kind":"statement"}) and kept in
// public.property_tax_statements; refreshed after 12 hours.

// A property paying taxes in two counties has one statement per county —
// keyed "<propertyId>~<County>"; an ordinary property is keyed by its id.
export const statementKey = (propertyId: string, county?: string | null) =>
  county ? `${propertyId}~${county}` : propertyId;

export type SavedStatement = {
  propertyId: string;
  // the county part ("" for a single-county property)
  part?: string;
  accountNumber: string | null;
  statement: TaxOfficeStatement | null;
  retrievedAt: string;
};

const FRESH_MS = 12 * 60 * 60 * 1000;
// an empty read is usually the county site not answering — try again soon
const EMPTY_FRESH_MS = 60 * 60 * 1000;

// Counties whose tax office CorvusPT reads (supabase/pt/functions/_shared/tax-office.ts).
export function taxOfficeConnected(cad: string | null | undefined): boolean {
  return isTaxOfficeConnected(countyFromCad(cad ?? null));
}

// The county's tax office site blocks automated lookups (a bot check).
export function taxOfficeBlocked(cad: string | null | undefined): boolean {
  return isTaxOfficeBlocked(countyFromCad(cad ?? null));
}

export async function listTaxStatements(
  propertyIds: string[],
): Promise<Map<string, SavedStatement>> {
  const out = new Map<string, SavedStatement>();
  if (propertyIds.length === 0) return out;
  const { data, error } = await supabase
    .from("property_tax_statements")
    .select("property_id, part, account_number, statement, retrieved_at")
    .in("property_id", propertyIds);
  if (error || !data) return out;
  for (const r of data as {
    property_id: string;
    part: string | null;
    account_number: string | null;
    statement: TaxOfficeStatement | null;
    retrieved_at: string;
  }[])
    out.set(statementKey(r.property_id, r.part), {
      propertyId: r.property_id,
      part: r.part ?? "",
      accountNumber: r.account_number,
      statement: r.statement,
      retrievedAt: r.retrieved_at,
    });
  return out;
}

export function isStatementFresh(
  s: SavedStatement | undefined,
  accountNumber: string | null,
  now = Date.now(),
): boolean {
  if (!s || s.accountNumber !== accountNumber) return false;
  const maxAge = s.statement ? FRESH_MS : EMPTY_FRESH_MS;
  return now - new Date(s.retrievedAt).getTime() < maxAge;
}

export async function fetchTaxStatement(
  propertyId: string,
  accountNumber: string | null,
  refresh = false,
  // one county of a two-county property
  county?: string | null,
): Promise<SavedStatement> {
  const r = await invokeEdgeFunction<{
    statement: TaxOfficeStatement | null;
    retrievedAt: string;
  }>("property-tax-history", {
    propertyId,
    kind: "statement",
    refresh,
    ...(county ? { county } : {}),
  });
  return {
    propertyId,
    part: county ?? "",
    accountNumber,
    statement: r.statement ?? null,
    retrievedAt: r.retrievedAt,
  };
}
