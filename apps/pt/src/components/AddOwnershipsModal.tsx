import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { searchPropertiesByOwner } from "@/lib/cad-owner-search";
import type { CadRecord } from "@/lib/cad-lookup";
import { addOwnership, type OwnershipRole } from "@/lib/ownerships";
import { addProperty, type PropertyRecord } from "@/lib/properties";
import { estimateSavings } from "@/lib/savings-estimate";
import { estimateSuccessProbability } from "@/lib/success-probability";
import { currency } from "@/lib/intake-store";

type Step = "entry" | "results" | "adding";

type Entry = { name: string; role: OwnershipRole };

type ResultRow = {
  record: CadRecord;
  ownershipName: string;
  savings: number | null;
  successProbabilityPct: number | null;
};

const ROLE_LABEL: Record<OwnershipRole, string> = {
  owner: "Owner",
  agent: "Agent",
  property_manager: "Property Manager",
};

// Same dedup key addProperty()/findExistingProperty() already use — account
// number is the real unique key for a CAD record, address is the fallback for
// records with none (a few counties don't publish one — see cad-owner-search).
function dedupeKey(r: CadRecord): string {
  return r.accountNumber && r.cad
    ? `${r.cad}::${r.accountNumber}`
    : `addr::${r.propertyAddress.trim().toLowerCase()}`;
}

export function AddOwnershipsModal({
  userId,
  onImported,
  onClose,
  initialMatch,
}: {
  userId: string;
  onImported: (properties: PropertyRecord[]) => void;
  onClose: () => void;
  // When the caller has already searched (e.g. sign-up's post-signup owner
  // lookup), skip the entry step and land straight on these results instead
  // of re-running the same search a second time.
  initialMatch?: { name: string; role: OwnershipRole; records: CadRecord[] };
}) {
  const nav = useNavigate();
  const [step, setStep] = useState<Step>("entry");
  const [entries, setEntries] = useState<Entry[]>([{ name: "", role: "owner" }]);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [estimatesLoading, setEstimatesLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState(0);
  const [suggestionsByEntry, setSuggestionsByEntry] = useState<
    { entryName: string; suggestions: string[] }[]
  >([]);

  function updateEntry(i: number, patch: Partial<Entry>) {
    setEntries((prev) => prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  }
  function addEntryRow() {
    setEntries((prev) => [...prev, { name: "", role: "owner" }]);
  }
  function removeEntryRow(i: number) {
    setEntries((prev) => prev.filter((_, idx) => idx !== i));
  }

  // Shared by a fresh search and by the initialMatch fast-path below: takes
  // already-deduped rows, shows them, and kicks off the (slower) per-row
  // savings estimate without blocking the results table from appearing.
  async function presentResults(rows: ResultRow[]) {
    setResults(rows);
    setSelected(new Set(rows.map((_, i) => i)));
    setStep("results");

    setEstimatesLoading(true);
    const [savingsResults, probabilityResults] = await Promise.all([
      Promise.all(
        rows.map((row) =>
          estimateSavings({
            cad: row.record.cad,
            accountNumber: row.record.accountNumber,
            address: row.record.propertyAddress,
            propertyType: row.record.propertyType,
            landValue: row.record.landValue,
            improvementValue: row.record.improvementValue,
            totalValue: row.record.totalValue,
            taxYear: row.record.taxYear,
          })
            .then((est) => est?.amount ?? null)
            .catch((err) => {
              console.error("Savings estimate failed for", row.record.propertyAddress, err);
              return null;
            }),
        ),
      ),
      Promise.all(
        rows.map((row) =>
          estimateSuccessProbability({
            cad: row.record.cad,
            accountNumber: row.record.accountNumber,
            address: row.record.propertyAddress,
            propertyType: row.record.propertyType,
            landValue: row.record.landValue,
            improvementValue: row.record.improvementValue,
            totalValue: row.record.totalValue,
            taxYear: row.record.taxYear,
          })
            .then((est) => est?.probabilityPct ?? null)
            .catch((err) => {
              console.error(
                "Success-probability estimate failed for",
                row.record.propertyAddress,
                err,
              );
              return null;
            }),
        ),
      ),
    ]);
    setResults((prev) =>
      prev.map((row, i) => ({
        ...row,
        savings: savingsResults[i],
        successProbabilityPct: probabilityResults[i],
      })),
    );
    setEstimatesLoading(false);
  }

  // Sign-up's post-signup owner search already ran and found matches by the
  // time this modal opens — jump straight to results instead of making the
  // user re-run the same search they've already (invisibly) done.
  useEffect(() => {
    if (!initialMatch) return;
    setEntries([{ name: initialMatch.name, role: initialMatch.role }]);
    const byKey = new Map<string, ResultRow>();
    for (const record of initialMatch.records) {
      const key = dedupeKey(record);
      if (!byKey.has(key)) {
        byKey.set(key, {
          record,
          ownershipName: initialMatch.name,
          savings: null,
          successProbabilityPct: null,
        });
      }
    }
    presentResults([...byKey.values()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Takes entries explicitly (rather than always reading the `entries` state
  // directly) so selectSuggestion() below can trigger an immediate re-search
  // with a corrected name without waiting a render for setEntries() to land
  // first — calling onSearch() right after setEntries() would still read the
  // stale array in the same tick.
  async function onSearch(searchEntries: Entry[] = entries) {
    const valid = searchEntries.filter((e) => e.name.trim().length >= 3);
    if (valid.length === 0) return;
    setSearching(true);
    setSuggestionsByEntry([]);
    try {
      const perEntry = await Promise.all(
        valid.map(async (e) => {
          try {
            const { matches, suggestions } = await searchPropertiesByOwner(e.name.trim());
            return { entry: e, matches, suggestions };
          } catch (err) {
            console.error(`Ownership search failed for "${e.name}":`, err);
            return { entry: e, matches: [] as CadRecord[], suggestions: [] as string[] };
          }
        }),
      );

      const byKey = new Map<string, ResultRow>();
      for (const { entry, matches } of perEntry) {
        for (const record of matches) {
          const key = dedupeKey(record);
          // First ownership name to surface a given property wins the credit —
          // the same real property, found under two different searched names,
          // is still exactly one property either way.
          if (!byKey.has(key)) {
            byKey.set(key, {
              record,
              ownershipName: entry.name.trim(),
              savings: null,
              successProbabilityPct: null,
            });
          }
        }
      }

      // Only worth surfacing for an entry that came up completely empty —
      // an entry that matched fine has nothing to "did you mean" about, even
      // if a sibling entry in the same search did.
      setSuggestionsByEntry(
        perEntry
          .filter(({ matches, suggestions }) => matches.length === 0 && suggestions.length > 0)
          .map(({ entry, suggestions }) => ({ entryName: entry.name.trim(), suggestions })),
      );

      await presentResults([...byKey.values()]);
    } finally {
      setSearching(false);
    }
  }

  // A misspelled name returns zero matches from every county (a typo breaks
  // a literal substring match same as a wholly wrong name would — see
  // cad-owner-search's own findSuggestions()) with no indication why. Rather
  // than a dead end, clicking a real "did you mean" suggestion corrects that
  // entry's name and re-searches immediately.
  function selectSuggestion(entryName: string, suggestion: string) {
    const nextEntries = entries.map((e) =>
      e.name.trim() === entryName ? { ...e, name: suggestion } : e,
    );
    setEntries(nextEntries);
    onSearch(nextEntries);
  }

  function toggle(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) =>
      prev.size === results.length ? new Set() : new Set(results.map((_, i) => i)),
    );
  }

  async function onConfirmAdd() {
    setStep("adding");
    setProgress(0);

    // Records the searched ownership names themselves (real intent the user
    // typed in, worth keeping even for names that turned up nothing this
    // time), independent of which individual properties end up selected below.
    const validEntries = entries.filter((e) => e.name.trim().length >= 3);
    for (const e of validEntries) {
      try {
        await addOwnership(userId, { name: e.name.trim(), role: e.role });
      } catch (err) {
        console.error(`Could not save ownership "${e.name}":`, err);
      }
    }

    const toAdd = [...selected].map((i) => results[i]);
    const added: PropertyRecord[] = [];
    for (let i = 0; i < toAdd.length; i++) {
      setProgress(i + 1);
      const row = toAdd[i];
      try {
        const property = await addProperty(userId, {
          address: row.record.propertyAddress,
          cad: row.record.cad,
          accountNumber: row.record.accountNumber ?? undefined,
          ownerName: row.record.ownerName ?? undefined,
          propertyType: row.record.propertyType ?? undefined,
          landValue: row.record.landValue ?? undefined,
          improvementValue: row.record.improvementValue ?? undefined,
          totalValue: row.record.totalValue ?? undefined,
          taxYear: row.record.taxYear ?? undefined,
        });
        added.push(property);
      } catch (err) {
        console.error("Could not save property:", row.record.propertyAddress, err);
      }
    }

    if (added.length > 0) {
      toast.success(
        `Added ${added.length} propert${added.length === 1 ? "y" : "ies"} to your dashboard.`,
        { action: { label: "Set up subscription →", onClick: () => nav({ to: "/pricing" }) } },
      );
    } else {
      toast.error("No properties were added.");
    }
    onImported(added);
    onClose();
  }

  return (
    <Modal onClose={onClose} wide={step === "results"}>
      <h3 className="font-serif text-xl font-semibold">Add Ownerships</h3>

      {step === "entry" && (
        <div className="mt-4 grid gap-4">
          <p className="text-sm text-muted-foreground">
            Enter one or more LLC/ownership names. We'll search real county appraisal records for
            every property on file under each name, across every county that publishes owner-name
            lookup.
          </p>
          <div className="grid gap-3">
            {entries.map((entry, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="e.g. Acme Commercial Holdings LLC"
                  value={entry.name}
                  onChange={(e) => updateEntry(i, { name: e.target.value })}
                  className="flex-1 min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <select
                  value={entry.role}
                  onChange={(e) => updateEntry(i, { role: e.target.value as OwnershipRole })}
                  className="rounded-md border border-input bg-background px-2 py-2 text-sm"
                >
                  {(Object.keys(ROLE_LABEL) as OwnershipRole[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
                {entries.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeEntryRow(i)}
                    aria-label={`Remove ${entry.name || "this ownership"}`}
                    className="btn-outline px-2 py-2 text-sm"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
          <button type="button" onClick={addEntryRow} className="btn-outline text-sm w-fit">
            + Add another ownership
          </button>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="btn-outline">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSearch()}
              disabled={searching || entries.every((e) => e.name.trim().length < 3)}
              className="btn-accent disabled:opacity-60"
            >
              {searching ? "Searching…" : "Search"}
            </button>
          </div>
        </div>
      )}

      {step === "results" && (
        <div className="mt-4 grid gap-4">
          <p className="text-sm text-muted-foreground">
            Found {results.length} propert{results.length === 1 ? "y" : "ies"} across{" "}
            {new Set(results.map((r) => r.record.cad)).size} count
            {new Set(results.map((r) => r.record.cad)).size === 1 ? "y" : "ies"}. Uncheck any you
            don't want to add.
          </p>

          {results.length === 0 ? (
            <div className="grid gap-3">
              <p className="text-sm text-muted-foreground">
                No matches found in any county that publishes owner-name records for the name(s) you
                entered.
              </p>
              {suggestionsByEntry.map(({ entryName, suggestions }) => (
                <div key={entryName} className="rounded-md border border-border p-3">
                  <p className="text-sm">
                    Did you mean one of these instead of{" "}
                    <span className="font-medium">&quot;{entryName}&quot;</span>?
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => selectSuggestion(entryName, s)}
                        className="btn-outline text-sm py-1.5"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="max-h-96 overflow-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-secondary text-left">
                  <tr>
                    <th className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.size === results.length}
                        onChange={toggleAll}
                        aria-label="Select all"
                      />
                    </th>
                    <th className="px-3 py-2">Address</th>
                    <th className="px-3 py-2">CAD Account #</th>
                    <th className="px-3 py-2">County</th>
                    <th className="px-3 py-2">Appraised Value</th>
                    <th className="px-3 py-2">Est. Savings</th>
                    <th className="px-3 py-2">Est. Success Probability</th>
                    <th className="px-3 py-2">Ownership</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((row, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selected.has(i)}
                          onChange={() => toggle(i)}
                          aria-label={row.record.propertyAddress || "Address not published"}
                        />
                      </td>
                      <td className="px-3 py-2">{row.record.propertyAddress || "Not published"}</td>
                      <td className="px-3 py-2">{row.record.accountNumber ?? "—"}</td>
                      <td className="px-3 py-2">{row.record.cad}</td>
                      <td className="px-3 py-2">
                        {row.record.totalValue != null ? currency(row.record.totalValue) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {estimatesLoading ? "…" : row.savings != null ? currency(row.savings) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {estimatesLoading
                          ? "…"
                          : row.successProbabilityPct != null
                            ? `${row.successProbabilityPct}%`
                            : "—"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{row.ownershipName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setStep("entry")} className="btn-outline">
              Back
            </button>
            <button
              type="button"
              onClick={onConfirmAdd}
              disabled={selected.size === 0}
              className="btn-accent disabled:opacity-60"
            >
              Add {selected.size || ""} to My Properties
            </button>
          </div>
        </div>
      )}

      {step === "adding" && (
        <div className="mt-4">
          <p className="text-sm text-muted-foreground">
            Adding {progress} of {selected.size}…
          </p>
          <div className="mt-2 h-2 w-full rounded-full bg-secondary">
            <div
              className="h-2 rounded-full bg-accent transition-all"
              style={{ width: `${(progress / (selected.size || 1)) * 100}%` }}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}
