import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { updatePropertySavings, type PropertyRecord } from "@/lib/properties";
import { estimateSavings } from "@/lib/savings-estimate";

// Properties saved before estimated_savings existed, or where the estimate attempt
// at intake time errored, would otherwise sit blank forever — there was no way to
// write a value back onto an existing row until the properties UPDATE policy was
// added. This computes and persists the missing estimate once per property
// (estimateSavings always returns a real value when a totalValue exists, worst
// case the baseline tier), so a property is never permanently stuck with no
// savings shown, regardless of which dashboard page the user happens to land on.
export function useSavingsBackfill(
  properties: PropertyRecord[],
  setProperties: Dispatch<SetStateAction<PropertyRecord[]>>,
) {
  const backfilling = useRef<Set<string>>(new Set());

  useEffect(() => {
    const missing = properties.filter(
      (p) => p.estimatedSavings == null && p.totalValue != null && !backfilling.current.has(p.id),
    );
    for (const p of missing) {
      backfilling.current.add(p.id);
      estimateSavings({
        cad: p.cad,
        accountNumber: p.accountNumber,
        address: p.address,
        propertyType: p.propertyType,
        landValue: p.landValue,
        improvementValue: p.improvementValue,
        totalValue: p.totalValue,
        taxYear: p.taxYear,
      })
        .then((estimate) => {
          if (!estimate) return null;
          return updatePropertySavings(p.id, { estimatedSavings: estimate.amount, savingsBasis: estimate.basis });
        })
        .then((updated) => {
          if (!updated) return;
          setProperties((prev) => prev.map((pr) => (pr.id === updated.id ? updated : pr)));
        })
        .catch((err) => console.error("Savings backfill failed:", err));
    }
  }, [properties, setProperties]);
}
