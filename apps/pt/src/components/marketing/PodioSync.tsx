import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { getErrorMessage } from "@/lib/error-message";
import { connectPodio, podioStatus, podioWorkspaces, type PodioWorkspace } from "@/lib/podio";
import { relDays, saveSettings, type MarketingData, type SyncChange } from "@/lib/marketing";
import {
  PODIO_TARGETS,
  PODIO_TARGET_LABEL,
  guessPodioMapping,
  podioProposals,
} from "@/lib/marketing-crm";
import {
  applyChange,
  podioContacts,
  rejectChange,
  saveProposals,
  type PodioAppFields,
} from "@/lib/marketing-podio";

type Tab = "create" | "update" | "link" | "podio" | "history";
const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: "create", label: "New leads", hint: "Podio contacts not in the CRM yet" },
  {
    key: "update",
    label: "Updates",
    hint: "Fill blanks in the CRM from Podio. Values that differ are unticked — the CRM keeps its value unless you tick it.",
  },
  {
    key: "link",
    label: "Possible matches",
    hint: "Same or similar name only — confirm it's the same person or company before linking",
  },
  {
    key: "podio",
    label: "To Podio",
    hint: "CRM details that are empty in Podio. Only empty Podio fields are ever written.",
  },
  { key: "history", label: "History", hint: "What was approved, rejected or failed" },
];
const tabOf = (c: SyncChange): Tab =>
  c.status !== "pending"
    ? "history"
    : c.direction === "crm_to_podio"
      ? "podio"
      : c.kind === "create"
        ? "create"
        : c.kind === "link" && (c.matchConfidence ?? 1) < 0.8
          ? "link"
          : "update";
const defaultPicked = (c: SyncChange) =>
  c.changes.filter((x) => x.from == null || x.from === "").map((x) => x.field);

// CorvusPT CRM ↔ Podio contacts: read, match, propose — then a person approves.
export function PodioSync({
  data,
  reload,
  onClose,
}: {
  data: MarketingData;
  reload: () => Promise<void>;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<{ configured: boolean; connected: boolean } | null>(null);
  const [workspaces, setWorkspaces] = useState<PodioWorkspace[] | null>(null);
  const [appId, setAppId] = useState<number | null>(data.settings.podio.appId ?? null);
  const [fields, setFields] = useState<PodioAppFields | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>(data.settings.podio.mapping ?? {});
  const [busy, setBusy] = useState<string | null>(null);
  const pending = data.syncChanges.filter((c) => c.status === "pending");
  const [tab, setTab] = useState<Tab>(pending.length ? tabOf(pending[0]) : "create");
  const [picked, setPicked] = useState<Record<string, string[]>>({});

  useEffect(() => {
    podioStatus()
      .then((s) => {
        setStatus(s);
        if (s.connected)
          podioWorkspaces()
            .then((w) => {
              setWorkspaces(w);
              setAppId((cur) => cur ?? w[0]?.apps[0]?.appId ?? null);
            })
            .catch((e) => toast.error(getErrorMessage(e, "Couldn't list your Podio apps.")));
      })
      .catch(() => setStatus({ configured: false, connected: false }));
  }, []);

  const appName = useMemo(
    () =>
      workspaces
        ?.flatMap((w) => w.apps.map((a) => ({ ...a, label: `${w.space} › ${a.name}` })))
        .find((a) => a.appId === appId)?.label,
    [workspaces, appId],
  );
  const byTab = useMemo(() => {
    const m: Record<Tab, SyncChange[]> = {
      create: [],
      update: [],
      link: [],
      podio: [],
      history: [],
    };
    for (const c of data.syncChanges) m[tabOf(c)].push(c);
    return m;
  }, [data.syncChanges]);
  const pick = (c: SyncChange) => picked[c.id] ?? defaultPicked(c);

  async function check() {
    if (!appId) return;
    setBusy("check");
    try {
      const r = await podioContacts(appId);
      setFields(r.fields);
      const map =
        data.settings.podio.appId === appId && Object.keys(mapping).length
          ? mapping
          : guessPodioMapping(r.fields);
      setMapping(map);
      if (!Object.values(map).some((t) => ["email", "phone", "fullName", "company"].includes(t)))
        throw new Error(
          "Map at least a name, company, email or phone field below, then check again.",
        );
      const proposals = podioProposals(r.items, map, data.leads);
      await saveProposals(appId, proposals);
      await saveSettings({ podio: { appId, appName: appName ?? undefined, mapping: map } });
      await reload();
      setPicked({});
      toast.success(
        `${r.items.length} Podio contacts checked${r.truncated ? ` (first ${r.items.length} of ${r.total})` : ""} — ${proposals.length} change${proposals.length === 1 ? "" : "s"} to review.`,
      );
      const first = proposals[0];
      if (first)
        setTab(
          first.direction === "crm_to_podio"
            ? "podio"
            : first.kind === "create"
              ? "create"
              : first.kind === "link" && (first.matchConfidence ?? 1) < 0.8
                ? "link"
                : "update",
        );
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't read that Podio app."));
    } finally {
      setBusy(null);
    }
  }

  async function approve(list: SyncChange[]) {
    setBusy("apply");
    let ok = 0;
    const errs: string[] = [];
    for (const c of list) {
      try {
        await applyChange(c, data.leads, pick(c));
        ok++;
      } catch (err) {
        errs.push(`${c.title}: ${getErrorMessage(err, "failed")}`);
      }
    }
    await reload();
    setBusy(null);
    if (ok) toast.success(`${ok} change${ok === 1 ? "" : "s"} applied.`);
    if (errs.length) toast.error(errs.slice(0, 3).join("\n"));
  }

  async function reject(list: SyncChange[]) {
    setBusy("reject");
    try {
      for (const c of list) await rejectChange(c);
      await reload();
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't reject that."));
    } finally {
      setBusy(null);
    }
  }

  const list = byTab[tab];
  const safe = tab === "create" || tab === "update" || tab === "podio";
  return (
    <Modal onClose={busy ? () => undefined : onClose} xl>
      <div className="grid gap-4 p-5 sm:p-6">
        <div>
          <h2 className="font-serif text-2xl font-semibold">Podio sync</h2>
          <p className="text-sm text-muted-foreground">
            Matches your Podio contacts to CRM leads by Podio link, email, phone, then name. Nothing
            changes on either side until you approve it.
          </p>
        </div>

        {!status ? (
          <p className="text-sm text-muted-foreground">Checking your Podio connection…</p>
        ) : !status.configured ? (
          <p className="text-sm text-muted-foreground">
            Podio isn&apos;t switched on for this app yet.
          </p>
        ) : !status.connected ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-4">
            <p className="text-sm">Connect the Podio account that holds your contact database.</p>
            <button
              type="button"
              className="btn-primary btn-primary-hover text-sm"
              onClick={async () => {
                try {
                  if (!(await connectPodio("marketing?podio=1")))
                    toast.error("Podio connection isn't available right now.");
                } catch (e) {
                  toast.error(getErrorMessage(e, "Couldn't start the Podio connection."));
                }
              }}
            >
              Connect Podio
            </button>
          </div>
        ) : (
          <div className="grid gap-3 rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-end gap-2">
              <label className="grid min-w-0 flex-1 basis-64 gap-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">
                  Podio app with your contacts
                </span>
                <select
                  className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  value={appId ?? ""}
                  onChange={(e) => {
                    setAppId(Number(e.target.value) || null);
                    setFields(null);
                    setMapping({});
                  }}
                >
                  {!workspaces && <option>Loading apps…</option>}
                  {workspaces?.map((w) => (
                    <optgroup key={`${w.org}-${w.space}`} label={`${w.org} › ${w.space}`}>
                      {w.apps.map((a) => (
                        <option key={a.appId} value={a.appId}>
                          {a.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={!appId || !!busy}
                onClick={() => void check()}
                className="btn-primary btn-primary-hover inline-flex items-center gap-1.5 text-sm disabled:opacity-60"
              >
                {busy === "check" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <RefreshCw className="h-4 w-4" aria-hidden />
                )}
                {busy === "check" ? "Reading Podio…" : "Check for changes"}
              </button>
            </div>
            {fields && (
              <details className="text-sm">
                <summary className="cursor-pointer text-xs font-medium text-accent">
                  Field mapping ({Object.keys(mapping).length} of {fields.length} Podio fields used)
                </summary>
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {fields.map((f) => (
                    <label
                      key={f.externalId}
                      className="flex items-center justify-between gap-2 rounded-md bg-secondary/40 px-2 py-1"
                    >
                      <span className="min-w-0 truncate">
                        {f.label}{" "}
                        <span className="text-[10px] text-muted-foreground">({f.type})</span>
                      </span>
                      <select
                        className="rounded border border-input bg-background px-1 py-0.5 text-xs"
                        value={mapping[f.externalId] ?? ""}
                        onChange={(e) =>
                          setMapping((m) => {
                            const next = Object.fromEntries(
                              Object.entries(m).filter(
                                ([k, v]) => k !== f.externalId && v !== e.target.value,
                              ),
                            );
                            if (e.target.value) next[f.externalId] = e.target.value;
                            return next;
                          })
                        }
                      >
                        <option value="">— not used —</option>
                        {PODIO_TARGETS.map((t) => (
                          <option key={t} value={t}>
                            {PODIO_TARGET_LABEL[t]}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  * Press Check for changes again after editing the mapping.
                </p>
              </details>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-1 border-b border-border" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${tab === t.key ? "border-accent font-medium" : "border-transparent text-muted-foreground"}`}
            >
              {t.label} ({byTab[t.key].length})
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{TABS.find((t) => t.key === tab)!.hint}</p>

        {list.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {tab === "history"
              ? "Nothing reviewed yet."
              : "Nothing here. Press Check for changes to compare Podio with the CRM."}
          </p>
        ) : (
          <>
            {tab !== "history" && (
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => void reject(list)}
                  className="btn-outline text-xs"
                >
                  Reject all {list.length}
                </button>
                {safe && (
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => void approve(list)}
                    className="btn-primary btn-primary-hover text-xs"
                  >
                    {busy === "apply" ? "Applying…" : `Approve all ${list.length} (ticked fields)`}
                  </button>
                )}
              </div>
            )}
            <ul className="grid max-h-[46vh] gap-2 overflow-y-auto pr-1">
              {list.slice(0, 200).map((c) => (
                <li key={c.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium">{c.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.matchReason}
                        {c.matchConfidence != null &&
                          ` · ${Math.round(c.matchConfidence * 100)}% match`}
                        {c.status !== "pending" && ` · ${c.status} ${relDays(c.createdAt)}`}
                        {c.error && <span className="text-rose-700"> · {c.error}</span>}
                      </div>
                    </div>
                    {c.status === "pending" && (
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          disabled={!!busy}
                          className="btn-outline py-1 text-xs"
                          onClick={() => void reject([c])}
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          disabled={
                            !!busy ||
                            (c.changes.length > 0 && pick(c).length === 0 && c.kind !== "link")
                          }
                          className="btn-primary btn-primary-hover py-1 text-xs disabled:opacity-60"
                          onClick={() => void approve([c])}
                        >
                          {c.kind === "link" ? "Same — link" : "Approve"}
                        </button>
                      </div>
                    )}
                  </div>
                  {c.changes.length > 0 && (
                    <ul className="mt-2 grid gap-1">
                      {c.changes.map((x) => {
                        const on = pick(c).includes(x.field);
                        return (
                          <li key={x.field}>
                            <label className="flex items-start gap-2 text-xs">
                              <input
                                type="checkbox"
                                className="mt-0.5"
                                disabled={c.status !== "pending"}
                                checked={on}
                                onChange={() =>
                                  setPicked((p) => ({
                                    ...p,
                                    [c.id]: on
                                      ? pick(c).filter((f) => f !== x.field)
                                      : [...pick(c), x.field],
                                  }))
                                }
                              />
                              <span>
                                <b>{x.label}</b>:{" "}
                                {x.from ? (
                                  <>
                                    <s className="text-muted-foreground">{x.from}</s> →{" "}
                                  </>
                                ) : null}
                                {x.to}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}
