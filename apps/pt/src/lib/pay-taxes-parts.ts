import type { PropertyRecord } from "./properties";
import { countyParts } from "../../../../supabase/pt/functions/_shared/multi-county";

// Pay Taxes shows a property that pays taxes in two counties ("Bexar County,
// Kendall County") as one entry per county, each with that county's account,
// tax office, deadlines and payment plans. The entries share the property's
// record: `sourceId` is the real property id (bills, receipts and uploads
// are saved against it), `id` is unique per entry ("<id>~Bexar").
export type PayProperty = PropertyRecord & {
  sourceId: string;
  // the county this entry is for, when the property is split
  countyPart: string | null;
  // the account field as saved (both counties' numbers), for cache checks
  sourceAccountNumber: string | null;
};

export function expandByCounty(p: PropertyRecord): PayProperty[] {
  const parts = countyParts(p.cad, p.accountNumber);
  if (parts.length < 2)
    return [{ ...p, sourceId: p.id, countyPart: null, sourceAccountNumber: p.accountNumber }];
  return parts.map((part) => ({
    ...p,
    id: `${p.id}~${part.county}`,
    sourceId: p.id,
    countyPart: part.county,
    sourceAccountNumber: p.accountNumber,
    cad: `${part.county} County`,
    accountNumber: part.accountNumber,
    // the saved value is the two counties together — not one county's, so
    // no estimate is made from it; each county's tax office gives its own
    totalValue: null,
    taxAmountDue: null,
    paymentDueDate: null,
    paidAt: null,
  }));
}

export const sourceIdOf = (p: PropertyRecord): string =>
  (p as Partial<PayProperty>).sourceId ?? p.id;
