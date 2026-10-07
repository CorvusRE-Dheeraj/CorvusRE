import { BPP_PROPERTY_TYPE } from "../../../../supabase/pt/functions/_shared/bexar-tax-office";

// The county's two IDs for a property, labelled the way the county's own
// notices label them: the Property ID — the record number most owners (and
// other protest firms, e.g. O'Connor's "Account No.") call their account
// number — and, where the county has one, the Geographic ID, a map/plat
// reference (Bexar: Property ID 1149803, Geo ID 17728-009-0010). Counties that
// key on the account number itself (Dallas, Tarrant, Harris) show just one.
export function PropertyIds({
  accountNumber,
  geoId,
  propertyType,
}: {
  accountNumber: string | null | undefined;
  geoId: string | null | undefined;
  propertyType?: string | null;
}) {
  const showGeo = !!geoId && geoId !== accountNumber;
  return (
    <>
      <span className="font-bold text-foreground">PROPERTY ID: {accountNumber ?? "—"}</span>
      {showGeo && (
        <>
          {" · "}
          <span className="font-bold text-foreground">GEO ID: {geoId}</span>
        </>
      )}
      {propertyType === BPP_PROPERTY_TYPE && (
        <span className="ml-1.5 rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-violet-800 dark:text-violet-300">
          BPP · coming soon
        </span>
      )}
    </>
  );
}
