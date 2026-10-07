// The county's two IDs for a property, side by side: its internal Property ID
// (what CorvusPT keys on) and, where the county has a separate one, the
// Geographic ID / account number printed on the appraisal notice and tax bill
// (Denton: Property ID 34086, Account A1246A-000-0023-0000). Counties that
// key on the account number itself (Dallas, Tarrant, Harris) show just one.
export function PropertyIds({
  accountNumber,
  geoId,
}: {
  accountNumber: string | null | undefined;
  geoId: string | null | undefined;
}) {
  const showGeo = !!geoId && geoId !== accountNumber;
  return (
    <>
      <span className="font-bold text-foreground">PROPERTY ID: {accountNumber ?? "—"}</span>
      {showGeo && (
        <>
          {" · "}
          <span className="font-bold text-foreground">ACCOUNT: {geoId}</span>
        </>
      )}
    </>
  );
}
