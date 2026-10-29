// The Documents page's pop-ups: a document's record and versions, a package
// requirement, uploading, reviewing an imported file's match, a source's
// settings, connecting a source, and one submitted round's record.
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Download, ExternalLink, FolderOpen, Landmark, Mail, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Pill } from "@/components/dp-ui";
import { inputCls } from "@/components/dp-ui";
import {
  ACCEPTED_EXTS,
  DISCIPLINES,
  DOC_KINDS,
  IMPORT_LABEL,
  MAX_FILES,
  PREP_LABEL,
  RELEASE_LABEL,
  changeVsPrevious,
  createSource,
  fileExt,
  fileImport,
  fileProblem,
  formatBytes,
  groupOf,
  ignoreImport,
  inboxAddress,
  nextRound,
  permitRequirements,
  prepOf,
  releaseVersion,
  selectForRequirement,
  signedUrl,
  suggestRevision,
  updateRequirement,
  updateSource,
  uploadVersions,
  type PrepStatus,
  type SourceRow,
} from "@/lib/doc-workspace";
import {
  cityClock,
  engineerWindow,
  fmtDate,
  fmtDays,
  fmtStamp,
  OUTCOME_LABEL,
  permitRounds,
} from "@/lib/permit-history";
import { Notice, VersionLink, type DocCtx, type DocDialog } from "./views";
import { destinationLabel, importTone, prepTone, releaseTone } from "./helpers";

type Props = { c: DocCtx; refresh: () => Promise<unknown>; close: () => void };

function Head({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-3 border-b border-border pb-3 pr-8">
      <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
        {kicker}
      </div>
      <h2 className="mt-1 text-xl font-semibold">{title}</h2>
      {children && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">{children}</div>}
    </div>
  );
}

function DataField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 py-1.5">
      <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

function F({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="grid min-w-0 gap-1 text-xs font-medium">
      {label}
      {children}
      {hint && <span className="text-[11px] font-normal text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function DialogBody({ d, ...p }: Props & { d: DocDialog }) {
  switch (d.type) {
    case "doc":
      return <DocRecord id={d.id} {...p} />;
    case "req":
      return <RequirementRecord id={d.id} {...p} />;
    case "upload":
      return <UploadForm d={d} {...p} />;
    case "import":
      return <ImportReview id={d.id} {...p} />;
    case "source":
      return <SourceSettings id={d.id} {...p} />;
    case "connect":
      return <ConnectSource {...p} />;
    case "submission":
      return <SubmissionRecord id={d.id} {...p} />;
    case "release":
      return <ReleaseForm id={d.id} {...p} />;
  }
}

// ── a document version ──────────────────────────────────────────────────────
function DocRecord({ id, c }: Props & { id: string }) {
  const v = c.versions.get(id);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (v?.storage_path) void signedUrl(v.storage_path).then(setUrl);
  }, [v?.storage_path]);
  if (!v)
    return <p className="text-sm text-muted-foreground">This document is no longer available.</p>;
  const g = c.groups.find((x) => x.id === groupOf(v))!;
  const usedIn = c.ws.submissions.filter((s) => s.manifest?.some((m) => m.doc_group === g.id));
  const sentThis = c.ws.submissions.filter((s) => s.manifest?.some((m) => m.document_id === v.id));
  const imp = c.ws.imports.find((i) => i.filed_document_id === v.id);
  const src = imp ? c.ws.sources.find((s) => s.id === imp.source_id) : undefined;
  const permit = c.ws.permits.find((p) => p.id === v.permit_id);
  const ext = fileExt(v.storage_path ?? v.name);
  return (
    <>
      <Head
        kicker={`Document record · ${permit ? permit.name : "Shared project file"}`}
        title={g.title}
      >
        <Pill tone="blue">{v.version_label ?? "No revision"}</Pill>
        <Pill tone={releaseTone(v.release_status)}>{RELEASE_LABEL[v.release_status]}</Pill>
        {sentThis.length ? (
          <Pill tone="green">Sent in {sentThis.length} submission(s)</Pill>
        ) : (
          <Pill tone="amber">Not in a submitted round</Pill>
        )}
      </Head>
      {imp && (
        <section className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
          <h3 className="text-sm font-semibold">Source &amp; collection trail</h3>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <DataField label="Source">{src?.name ?? "Removed source"}</DataField>
            <DataField label="From">{imp.from_address ?? "—"}</DataField>
            <DataField label="Email subject">{imp.subject || "—"}</DataField>
            <DataField label="Received">{fmtStamp(imp.source_at)}</DataField>
            <DataField label="Collected">{fmtStamp(imp.collected_at)}</DataField>
            <DataField label="Filed">{fmtStamp(imp.decided_at)}</DataField>
            <DataField label="Match">{imp.match_summary ?? "—"}</DataField>
            <DataField label="Round evidence">{imp.round_evidence ?? "—"}</DataField>
          </div>
        </section>
      )}
      <div className="grid gap-x-4 sm:grid-cols-2">
        <DataField label="This version">{v.name}</DataField>
        <DataField label="Latest version">
          {g.latest.id === v.id
            ? "This is the latest"
            : `${g.latest.version_label ?? ""} · ${fmtDate(g.latest.created_at)}`}
        </DataField>
        <DataField label="Uploaded">{fmtStamp(v.created_at)}</DataField>
        <DataField label="Type / discipline">{`${v.doc_kind ?? "—"} · ${v.category}`}</DataField>
        <DataField label="Responsible party">{v.owner_party ?? "—"}</DataField>
        <DataField label="Size">{formatBytes(v.size_bytes)}</DataField>
        {v.release_note && <DataField label="Release note">{v.release_note}</DataField>}
        {v.submission_id && (
          <DataField label="Supporting record for">
            {(() => {
              const s = c.ws.submissions.find((x) => x.id === v.submission_id);
              return s ? `Submission ${s.round} (not part of what it sent)` : "—";
            })()}
          </DataField>
        )}
      </div>
      {g.latest.id !== v.id && (
        <Notice tone="warn">
          <b>You're viewing an older version.</b> Submitted rounds keep pointing at the exact
          version they sent.
        </Notice>
      )}
      <div className="my-3 overflow-hidden rounded-lg border border-border bg-muted/30">
        {url && ["png", "jpg", "jpeg"].includes(ext) ? (
          <img
            src={url}
            alt={`Preview of ${v.name}`}
            className="mx-auto max-h-[380px] object-contain"
          />
        ) : url && ext === "pdf" ? (
          <object
            data={url}
            type="application/pdf"
            className="h-[420px] w-full"
            aria-label={`Preview of ${v.name}`}
          >
            <p className="p-6 text-center text-sm">
              PDF preview isn't available in this browser — open the file instead.
            </p>
          </object>
        ) : (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {v.storage_path
              ? "No inline preview for this file type — open or download it."
              : "No file is attached to this record."}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {url && (
          <a
            className="btn-outline px-2.5 py-1 text-xs"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Open file
          </a>
        )}
        {url && (
          <a className="btn-outline px-2.5 py-1 text-xs" href={url} download={v.name}>
            <Download className="h-3.5 w-3.5" aria-hidden /> Download
          </a>
        )}
        {v.release_status === "working_draft" && (
          <button
            type="button"
            className="btn-outline px-2.5 py-1 text-xs"
            onClick={() => c.open({ type: "release", id: v.id })}
          >
            Release for permitting
          </button>
        )}
        {v.release_status !== "city_approved" && (
          <button
            type="button"
            className="btn-accent px-2.5 py-1 text-xs"
            onClick={() => c.open({ type: "upload", docGroup: g.id, permitId: v.permit_id })}
          >
            Upload new revision
          </button>
        )}
      </div>
      <h3 className="mb-2 mt-5 text-sm font-semibold">Version history</h3>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Version</th>
              <th className="px-3 py-2">File</th>
              <th className="px-3 py-2">Release</th>
              <th className="px-3 py-2">Uploaded</th>
            </tr>
          </thead>
          <tbody>
            {[...g.versions].reverse().map((x) => (
              <tr
                key={x.id}
                className={cn("border-t border-border", x.id === v.id && "bg-emerald-50/60")}
              >
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="text-accent hover:underline"
                    onClick={() => c.open({ type: "doc", id: x.id })}
                  >
                    {x.version_label ?? "—"}
                  </button>
                </td>
                <td className="px-3 py-2 text-xs [overflow-wrap:anywhere]">{x.name}</td>
                <td className="px-3 py-2">
                  <Pill tone={releaseTone(x.release_status)}>
                    {RELEASE_LABEL[x.release_status]}
                  </Pill>
                </td>
                <td className="px-3 py-2 text-xs">{fmtDate(x.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="mb-2 mt-5 text-sm font-semibold">Used in submissions</h3>
      {usedIn.length ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Permit</th>
                <th className="px-3 py-2">Round</th>
                <th className="px-3 py-2">Version sent</th>
                <th className="px-3 py-2">Filed</th>
              </tr>
            </thead>
            <tbody>
              {usedIn.map((s) => {
                const item = s.manifest!.find((m) => m.doc_group === g.id)!;
                const p = c.ws.permits.find((x) => x.id === s.permit_id);
                return (
                  <tr key={s.id} className="border-t border-border">
                    <td className="px-3 py-2 text-xs">{p?.name}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="text-accent hover:underline"
                        onClick={() => c.open({ type: "submission", id: s.id })}
                      >
                        Submission {s.round}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="text-accent hover:underline"
                        onClick={() => c.open({ type: "doc", id: item.document_id })}
                      >
                        {item.version_label ?? item.name}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-xs">{fmtDate(s.submitted_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No submitted round includes this document yet.
        </p>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        A new revision never overwrites a submitted version or a city-approved copy.
      </p>
    </>
  );
}

function ReleaseForm({ id, c, refresh }: Props & { id: string }) {
  const v = c.versions.get(id);
  const [note, setNote] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!v) return null;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ok || note.trim().length < 5)
      return setErr("Confirm the release and describe the review done.");
    setBusy(true);
    try {
      await releaseVersion(id, note.trim());
      await refresh();
      toast.success(
        "Released for permitting. Each requirement still needs its own readiness review.",
      );
      c.open({ type: "doc", id });
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Couldn't release this version.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <Head
        kicker="Internal release · not city approval"
        title="Release this version for permitting"
      />
      <p className="text-sm">
        {v.name} · {v.version_label}
      </p>
      <Notice>
        Release says this exact file can be used to prepare permit packages. It isn't a city
        approval or a submission.
      </Notice>
      <F label="Release note *">
        <textarea
          className={inputCls}
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What was reviewed before release."
        />
      </F>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={ok}
          onChange={(e) => setOk(e.target.checked)}
          className="mt-1"
        />
        I reviewed this version for release. This isn't a city approval or a permit submission.
      </label>
      {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-outline" onClick={() => c.open({ type: "doc", id })}>
          Cancel
        </button>
        <button type="submit" className="btn-accent" disabled={busy}>
          {busy ? "Saving…" : "Confirm release"}
        </button>
      </div>
    </form>
  );
}

// ── a package requirement ───────────────────────────────────────────────────
function RequirementRecord({ id, c, refresh }: Props & { id: string }) {
  const r = c.ws.requirements.find((x) => x.id === id);
  const p = r ? c.ws.permits.find((x) => x.permit_key === r.permit_key) : undefined;
  const v = r?.document_id ? c.versions.get(r.document_id) : undefined;
  const g = v ? c.groups.find((x) => x.id === groupOf(v)) : undefined;
  const pkg = p
    ? c.ws.packages.find(
        (x) => x.permit_id === p.id && x.round === nextRound(c.ws.submissions, p.id),
      )
    : undefined;
  const locked = !p || p.status === "approved" || pkg?.status === "frozen";
  const [version, setVersion] = useState(v?.id ?? "");
  const [status, setStatus] = useState<PrepStatus>(r ? prepOf(r) : "missing");
  const [note, setNote] = useState(r?.review_note ?? "");
  const [owner, setOwner] = useState(r?.owner_party ?? "");
  const [due, setDue] = useState(r?.due_date ?? "");
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!r || !p)
    return (
      <p className="text-sm text-muted-foreground">This requirement is no longer available.</p>
    );
  const candidates = c.ws.versions.filter(
    (x) =>
      x.permit_id === p.id &&
      x.release_status !== "city_approved" &&
      !g?.versions.some((y) => y.id === x.id),
  );
  async function save(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const target = version ? c.versions.get(version) : undefined;
    if (status === "ready") {
      if (!target) return setErr("Choose a document version first.");
      if (target.release_status !== "released")
        return setErr("Only a version released for permitting can be marked ready.");
      if (!checked) return setErr("Confirm you reviewed the selected version.");
      if (!note.trim()) return setErr("Add a review note for the readiness decision.");
    }
    setBusy(true);
    try {
      if (target && target.id !== r!.document_id) {
        await selectForRequirement(r!.id, target.id, "internal_review", note.trim() || undefined);
        toast.success("New version selected — review it before marking it ready.");
      } else {
        await updateRequirement(r!.id, {
          prep_status: status,
          review_note: note.trim() || null,
          owner_party: owner.trim() || null,
          due_date: due || null,
        });
        toast.success("Saved. Nothing was submitted or approved.");
      }
      await refresh();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }
  async function markRequested() {
    setBusy(true);
    try {
      await updateRequirement(r!.id, {
        prep_status: "requested",
        owner_party: owner.trim() || null,
        due_date: due || null,
      });
      await refresh();
      toast.success(`Marked requested${owner ? ` from ${owner}` : ""}. No email was sent.`);
    } finally {
      setBusy(false);
    }
  }
  const st = prepOf(r);
  return (
    <form onSubmit={save}>
      <Head
        kicker={`Requirement · ${p.name}${p.permit_number ? ` / ${p.permit_number}` : ""}`}
        title={r.label}
      >
        <Pill tone={prepTone(st)}>{PREP_LABEL[st]}</Pill>
        <Pill tone="gray">{r.required ? "Required" : "Optional"}</Pill>
        <span className="text-muted-foreground">
          Working Submission {nextRound(c.ws.submissions, p.id)}
        </span>
      </Head>
      <div className="grid gap-3 sm:grid-cols-2">
        <F label="Responsible party">
          <input
            className={inputCls}
            value={owner}
            disabled={locked}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="Architect, civil engineer, owner…"
          />
        </F>
        <F label="Due date">
          <input
            type="date"
            className={inputCls}
            value={due}
            disabled={locked}
            onChange={(e) => setDue(e.target.value)}
          />
        </F>
      </div>
      {!v ? (
        <>
          <Notice tone="warn">
            No file received yet. State: <b>{PREP_LABEL[st]}</b>.
          </Notice>
          {!locked && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-outline" disabled={busy} onClick={markRequested}>
                Mark requested
              </button>
              <button
                type="button"
                className="btn-accent"
                onClick={() => c.open({ type: "upload", permitId: p.id, requirementId: r.id })}
              >
                <Upload className="h-4 w-4" aria-hidden /> Upload document
              </button>
            </div>
          )}
          {candidates.length > 0 && !locked && (
            <div className="mt-3">
              <F label="Or choose a file already uploaded for this permit">
                <select
                  className={inputCls}
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                >
                  <option value="">—</option>
                  {candidates.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} · {x.version_label ?? "—"} · {RELEASE_LABEL[x.release_status]}
                    </option>
                  ))}
                </select>
              </F>
              <div className="mt-3 flex justify-end">
                <button type="submit" className="btn-accent" disabled={!version || busy}>
                  Select this file
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <h3 className="mb-2 mt-4 text-sm font-semibold">Selected file &amp; review</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <F label="Exact version for this package">
              <select
                className={inputCls}
                value={version}
                disabled={locked}
                onChange={(e) => setVersion(e.target.value)}
              >
                {g?.versions.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.version_label ?? "—"} · {x.name} · {RELEASE_LABEL[x.release_status]}
                  </option>
                ))}
                {candidates.map((x) => (
                  <option key={x.id} value={x.id}>
                    Other: {x.name} · {x.version_label ?? "—"}
                  </option>
                ))}
              </select>
            </F>
            <F label="Preparation status (not city approval)">
              <select
                className={inputCls}
                value={status}
                disabled={locked}
                onChange={(e) => setStatus(e.target.value as PrepStatus)}
              >
                {(
                  ["received", "internal_review", "revision_required", "ready"] as PrepStatus[]
                ).map((s) => (
                  <option key={s} value={s}>
                    {PREP_LABEL[s]}
                  </option>
                ))}
              </select>
            </F>
          </div>
          <div className="mt-3">
            <F label="Reviewer note">
              <textarea
                className={inputCls}
                rows={3}
                value={note}
                disabled={locked}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Why this version is accepted, or what needs revising."
              />
            </F>
          </div>
          {!locked ? (
            <>
              <label className="mt-3 flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                  className="mt-1"
                />
                I reviewed the selected version for this package (needed to mark it ready).
              </label>
              <Notice>
                Choosing another version sends this requirement back to internal review. A working
                draft can't be marked ready until it's released for permitting.
              </Notice>
              {err && <p className="text-sm text-red-700">{err}</p>}
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => c.open({ type: "doc", id: v.id })}
                >
                  View selected file
                </button>
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() =>
                    c.open({
                      type: "upload",
                      permitId: p.id,
                      requirementId: r.id,
                      docGroup: groupOf(v),
                    })
                  }
                >
                  Upload new revision
                </button>
                <button type="submit" className="btn-accent" disabled={busy}>
                  {busy ? "Saving…" : "Save review"}
                </button>
              </div>
            </>
          ) : (
            <Notice>
              This package is frozen or the permit is approved — selections can't change here.
            </Notice>
          )}
        </>
      )}
      {err && !v && <p className="mt-2 text-sm text-red-700">{err}</p>}
    </form>
  );
}

// ── upload ──────────────────────────────────────────────────────────────────
type QueueItem = { key: string; file: File; title: string; kind: string; revision: string };
function UploadForm({ d, c, refresh }: Props & { d: Extract<DocDialog, { type: "upload" }> }) {
  const startGroup = d.docGroup ? c.groups.find((g) => g.id === d.docGroup) : undefined;
  const [permitId, setPermitId] = useState<string>(d.permitId ?? c.permit?.id ?? "");
  const permit = c.ws.permits.find((p) => p.id === permitId) ?? null;
  const destOptions = useMemo(() => {
    const o: [string, string][] = [];
    if (!permit)
      return [["library", "Shared project files · no submission round"]] as [string, string][];
    if (permit.status !== "approved")
      o.push([
        "draft",
        `Working Submission ${nextRound(c.ws.submissions, permit.id)} · not yet submitted`,
      ]);
    o.push(["library", "Permit document library · not in a package"]);
    for (const s of c.ws.submissions.filter((x) => x.permit_id === permit.id))
      o.push([`support:${s.id}`, `Submission ${s.round} · supporting record only`]);
    return o;
  }, [permit, c.ws.submissions]);
  const [dest, setDest] = useState<string>(d.submissionId ? `support:${d.submissionId}` : "");
  const destination = destOptions.some(([v]) => v === dest) ? dest : destOptions[0][0];
  const reqs = permit && destination === "draft" ? permitRequirements(c.ws, permit) : [];
  const [reqId, setReqId] = useState<string>(d.requirementId ?? "");
  const requirement = reqs.find((r) => r.id === reqId) ?? null;
  const [mode, setMode] = useState<"new" | "revision">(startGroup ? "revision" : "new");
  const [groupId, setGroupId] = useState<string>(startGroup?.id ?? "");
  const group = mode === "revision" ? c.groups.find((g) => g.id === groupId) : undefined;
  const [discipline, setDiscipline] = useState(
    startGroup?.latest.category && DISCIPLINES.includes(startGroup.latest.category)
      ? startGroup.latest.category
      : "General / Administration",
  );
  const [owner, setOwner] = useState(
    requirement?.owner_party ?? startGroup?.latest.owner_party ?? "",
  );
  const [notes, setNotes] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [done, setDone] = useState<{ created: string[]; duplicates: string[] } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const keyRef = useRef(0);
  const approvedPermit = permit?.status === "approved";

  const add = (files: FileList | File[] | null | undefined) => {
    const errs: string[] = [];
    const next = [...queue];
    for (const f of Array.from(files ?? [])) {
      const problem = fileProblem(f);
      if (problem) {
        errs.push(problem);
        continue;
      }
      if (
        next.some(
          (x) =>
            x.file.name === f.name &&
            x.file.size === f.size &&
            x.file.lastModified === f.lastModified,
        )
      ) {
        errs.push(`${f.name}: already selected.`);
        continue;
      }
      if (next.length >= MAX_FILES) {
        errs.push(`Up to ${MAX_FILES} files at a time.`);
        break;
      }
      next.push({
        key: `f${++keyRef.current}`,
        file: f,
        title:
          group?.title ??
          requirement?.label ??
          f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "),
        kind: approvedPermit
          ? "Issued permit"
          : (group?.latest.doc_kind ??
            (["pdf", "dwg", "dxf"].includes(fileExt(f.name)) ? "Design drawings" : "Other")),
        revision: suggestRevision(group),
      });
    }
    setQueue(next);
    setErrors(errs);
  };
  // files dropped on the page arrive with the dialog
  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current && d.files?.length) {
      seeded.current = true;
      add(d.files);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    const errs: string[] = [];
    if (!queue.length) errs.push("Select at least one file.");
    if (!owner.trim()) errs.push("Enter the responsible party.");
    if ((mode === "revision" || requirement) && queue.length !== 1)
      errs.push("Add one file at a time for a new revision or a specific requirement.");
    if (mode === "revision" && !group) errs.push("Choose the document this is a new revision of.");
    for (const q of queue) {
      if (!q.title.trim() || !q.revision.trim())
        errs.push(`${q.file.name}: title and revision are required.`);
      if (
        group?.versions.some(
          (x) => (x.version_label ?? "").toLowerCase() === q.revision.trim().toLowerCase(),
        )
      )
        errs.push(`Revision ${q.revision} already exists for this document — use a new label.`);
    }
    if (errs.length) return setErrors(errs);
    setBusy(true);
    try {
      const result = await uploadVersions(c.ws, {
        userId: c.userId,
        projectId: c.projectId,
        permitId: permit?.id ?? null,
        destination,
        requirementId: requirement?.id ?? null,
        docGroup: group?.id ?? null,
        discipline,
        owner,
        notes,
        items: queue.map((q) => ({
          file: q.file,
          title: q.title,
          kind: q.kind,
          revision: q.revision,
        })),
      });
      await refresh();
      setDone(result);
    } catch (e2) {
      setErrors([e2 instanceof Error ? e2.message : "Upload failed."]);
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <>
        <Head
          kicker="Review required"
          title={`${done.created.length} file${done.created.length === 1 ? "" : "s"} added`}
        />
        {done.duplicates.length > 0 && (
          <Notice tone="warn">
            Skipped — already on record with the same content: {done.duplicates.join(", ")}.
          </Notice>
        )}
        <ul className="grid gap-1.5 text-sm">
          {done.created.map((id) => (
            <li key={id} className="flex items-center gap-2">
              <VersionLink v={c.versions.get(id)} open={c.open} />
              <Pill tone="blue">Received</Pill>
            </li>
          ))}
        </ul>
        <Notice>
          {destination.startsWith("support:")
            ? "Linked as supporting records to that round — what it sent is unchanged."
            : requirement
              ? "The requirement now shows Received. Release the file and review it before marking it ready."
              : "Added as working drafts. Release them for permitting before they can be marked ready."}
        </Notice>
      </>
    );

  return (
    <form onSubmit={save} className="grid gap-4">
      <Head kicker="Project / Permit / Submission" title="Upload documents" />
      <section className="rounded-xl border border-border bg-muted/20 p-4">
        <h3 className="mb-2 text-sm font-semibold">1 · Where the documents belong</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <F label="Permit application">
            <select
              className={inputCls}
              value={permitId}
              onChange={(e) => {
                setPermitId(e.target.value);
                setReqId("");
              }}
            >
              <option value="">Shared project files</option>
              {c.ws.permits.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.permit_number ? ` / ${p.permit_number}` : ""}
                </option>
              ))}
            </select>
          </F>
          <F label="Submission / destination *">
            <select
              className={inputCls}
              value={destination}
              onChange={(e) => {
                setDest(e.target.value);
                setReqId("");
              }}
            >
              {destOptions.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </F>
        </div>
        {reqs.length > 0 && (
          <div className="mt-3">
            <F
              label="Satisfy a requirement (optional)"
              hint="One file for one requirement; it becomes Received and still needs review."
            >
              <select className={inputCls} value={reqId} onChange={(e) => setReqId(e.target.value)}>
                <option value="">No requirement</option>
                {reqs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                    {r.document_id ? " · replace working selection" : " · missing"}
                  </option>
                ))}
              </select>
            </F>
          </div>
        )}
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">2 · Select files</h3>
        <div
          role="button"
          tabIndex={0}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              input.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            add(e.dataTransfer.files);
          }}
          className={cn(
            "cursor-pointer rounded-xl border-2 border-dashed px-4 py-6 text-center",
            dragging ? "border-emerald-600 bg-emerald-50" : "border-emerald-300 bg-emerald-50/40",
          )}
        >
          <Upload className="mx-auto h-7 w-7 text-emerald-700" aria-hidden />
          <p className="mt-1 text-sm font-semibold">
            Drag and drop files here, or <span className="text-emerald-700 underline">browse</span>
          </p>
          <p className="text-[11px] text-muted-foreground">
            PDF, images, Word, Excel, DWG, DXF, CSV or TXT · 25 MB per file · up to {MAX_FILES}{" "}
            files
          </p>
        </div>
        <input
          ref={input}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          accept={ACCEPTED_EXTS.map((x) => `.${x}`).join(",")}
          onChange={(e) => {
            add(e.target.files);
            e.target.value = "";
          }}
        />
        <div className="mt-3 grid gap-2">
          {queue.length === 0 && (
            <p className="text-xs text-muted-foreground">No files selected yet.</p>
          )}
          {queue.map((q) => (
            <article key={q.key} className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="grid h-9 w-8 place-items-center rounded border border-border bg-muted/40 text-[9px] font-bold">
                  {fileExt(q.file.name).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <b className="[overflow-wrap:anywhere]">{q.file.name}</b>
                  <div className="text-[11px] text-muted-foreground">
                    {formatBytes(q.file.size)}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${q.file.name}`}
                  className="rounded px-2 text-lg text-muted-foreground hover:bg-red-50 hover:text-red-700"
                  onClick={() => setQueue(queue.filter((x) => x.key !== q.key))}
                >
                  ×
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-[1.6fr_1.2fr_0.6fr]">
                <F label="Document title *">
                  <input
                    className={inputCls}
                    value={q.title}
                    readOnly={mode === "revision"}
                    onChange={(e) =>
                      setQueue(
                        queue.map((x) => (x.key === q.key ? { ...x, title: e.target.value } : x)),
                      )
                    }
                  />
                </F>
                <F label="Type *">
                  <select
                    className={inputCls}
                    value={q.kind}
                    onChange={(e) =>
                      setQueue(
                        queue.map((x) => (x.key === q.key ? { ...x, kind: e.target.value } : x)),
                      )
                    }
                  >
                    {DOC_KINDS.map((k) => (
                      <option key={k}>{k}</option>
                    ))}
                  </select>
                </F>
                <F label="Revision *">
                  <input
                    className={inputCls}
                    value={q.revision}
                    onChange={(e) =>
                      setQueue(
                        queue.map((x) =>
                          x.key === q.key ? { ...x, revision: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </F>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="rounded-xl border border-border bg-muted/20 p-4">
        <h3 className="mb-2 text-sm font-semibold">3 · Version &amp; responsibility</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <F label="Add as">
            <select
              className={inputCls}
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
            >
              <option value="new">New document(s)</option>
              <option value="revision">New revision of an existing document</option>
            </select>
          </F>
          <F label={`Existing document${mode === "revision" ? " *" : ""}`}>
            <select
              className={inputCls}
              disabled={mode !== "revision"}
              value={groupId}
              onChange={(e) => {
                setGroupId(e.target.value);
                const g = c.groups.find((x) => x.id === e.target.value);
                if (g)
                  setQueue(
                    queue.map((x) => ({
                      ...x,
                      title: g.title,
                      revision: suggestRevision(g),
                      kind: g.latest.doc_kind ?? x.kind,
                    })),
                  );
              }}
            >
              <option value="">Choose a document</option>
              {c.groups
                .filter((g) => g.latest.release_status !== "city_approved")
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title} · latest {g.latest.version_label ?? "—"}
                  </option>
                ))}
            </select>
          </F>
          <F label="Discipline">
            <select
              className={inputCls}
              value={discipline}
              onChange={(e) => setDiscipline(e.target.value)}
            >
              {DISCIPLINES.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </F>
          <F label="Responsible party *">
            <input
              className={inputCls}
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="Architect, civil engineer, owner…"
            />
          </F>
        </div>
        <div className="mt-3">
          <F label="Notes (optional)">
            <textarea
              className={inputCls}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What changed in this revision, or where it came from."
            />
          </F>
        </div>
      </section>
      <Notice tone={destination.startsWith("support:") ? "warn" : "info"}>
        {destination.startsWith("support:")
          ? "These files become supporting records for that round. They won't be added to, or replace anything in, what that round sent."
          : "Files are added as Received working drafts. They don't become ready, submitted or approved until those steps are recorded separately."}
      </Notice>
      {errors.length > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
        >
          {errors.map((x) => (
            <div key={x}>{x}</div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <p className="max-w-md text-[11px] text-muted-foreground">
          Adding files isn't a city submission. Earlier submissions and city approvals stay
          unchanged.
        </p>
        <button type="submit" className="btn-accent" disabled={busy || !queue.length}>
          <Upload className="h-4 w-4" aria-hidden />
          {busy
            ? "Uploading…"
            : `Upload ${queue.length ? `${queue.length} file${queue.length === 1 ? "" : "s"}` : "documents"}`}
        </button>
      </div>
    </form>
  );
}

// ── reviewing an imported file ──────────────────────────────────────────────
function ImportReview({ id, c, refresh }: Props & { id: string }) {
  const imp = c.ws.imports.find((i) => i.id === id);
  const src = imp ? c.ws.sources.find((s) => s.id === imp.source_id) : undefined;
  const [permitId, setPermitId] = useState(imp?.permit_id ?? "");
  const permit = c.ws.permits.find((p) => p.id === permitId) ?? null;
  const [dest, setDest] = useState(imp?.destination ?? "library");
  const destOptions: [string, string][] = [["library", "Library · no submission round assigned"]];
  if (permit && permit.status !== "approved")
    destOptions.push([
      "draft",
      `Working Submission ${nextRound(c.ws.submissions, permit.id)} · received, pending review`,
    ]);
  if (permit)
    for (const s of c.ws.submissions.filter((x) => x.permit_id === permit.id))
      destOptions.push([`support:${s.id}`, `Submission ${s.round} · supporting record only`]);
  const destination = destOptions.some(([v]) => v === dest) ? dest : "library";
  const [groupId, setGroupId] = useState(imp?.doc_group ?? "");
  const group = c.groups.find((g) => g.id === groupId);
  const [title, setTitle] = useState(imp?.title ?? imp?.filename ?? "");
  const [revision, setRevision] = useState(imp?.revision ?? "");
  const [kind, setKind] = useState(
    imp?.doc_kind && DOC_KINDS.includes(imp.doc_kind) ? imp.doc_kind : "Other",
  );
  const [owner, setOwner] = useState("");
  const reqs = permit && destination === "draft" ? permitRequirements(c.ws, permit) : [];
  const [reqId, setReqId] = useState(imp?.requirement_id ?? "");
  const requirement = reqs.find((r) => r.id === reqId) ?? null;
  const [useForReq, setUseForReq] = useState(!!imp?.requirement_id);
  const [note, setNote] = useState("");
  const [verified, setVerified] = useState(false);
  const [ignoring, setIgnoring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (imp?.storage_path) void signedUrl(imp.storage_path).then(setUrl);
  }, [imp?.storage_path]);
  if (!imp)
    return <p className="text-sm text-muted-foreground">This import is no longer available.</p>;
  const uncertain = (imp.confidence ?? 0) < 0.85 || destination.startsWith("support:");

  if (["filed", "duplicate", "ignored"].includes(imp.status)) {
    const target = imp.filed_document_id ?? imp.existing_document_id;
    return (
      <>
        <Head kicker={`Import record · ${src?.name ?? "Removed source"}`} title={imp.filename}>
          <Pill tone={importTone(imp.status)}>{IMPORT_LABEL[imp.status]}</Pill>
        </Head>
        <p className="text-sm text-muted-foreground">{imp.reason}</p>
        <div className="mt-3 grid gap-x-4 sm:grid-cols-2">
          <DataField label="From">{imp.from_address ?? "—"}</DataField>
          <DataField label="Subject">{imp.subject || "—"}</DataField>
          <DataField label="Received">{fmtStamp(imp.source_at)}</DataField>
          <DataField label="Collected">{fmtStamp(imp.collected_at)}</DataField>
          <DataField label="Destination">
            {destinationLabel(c, imp.destination, imp.permit_id)}
          </DataField>
          <DataField label="Decision">
            {imp.decision_note ??
              (imp.status === "duplicate" ? "Same content already on record" : "—")}
          </DataField>
        </div>
        <Notice>
          {imp.status === "duplicate"
            ? "No new version was created — duplicates are detected by file content, not by name."
            : imp.status === "ignored"
              ? "This file was left out of the repository; its record stays in the activity log."
              : "Filed as a Received version. Filing doesn't confirm a submission or an approval."}
        </Notice>
        {target && (
          <button
            type="button"
            className="btn-accent"
            onClick={() => c.open({ type: "doc", id: target })}
          >
            Open the version on record
          </button>
        )}
      </>
    );
  }
  if (imp.status === "link_only")
    return (
      <>
        <Head kicker={src?.name ?? "Project inbox"} title="Notification — no file collected">
          <Pill tone="gray">Link only</Pill>
        </Head>
        <Notice tone="warn">{imp.reason}</Notice>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <DataField label="From">{imp.from_address ?? "—"}</DataField>
          <DataField label="Subject">{imp.subject || "—"}</DataField>
          <DataField label="Received">{fmtStamp(imp.source_at)}</DataField>
          <DataField label="Link">
            {imp.link_url ? (
              <a
                className="text-accent underline"
                href={imp.link_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open link
              </a>
            ) : (
              "—"
            )}
          </DataField>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          A link isn't a collected document. Open it (sign in to the portal if asked), download the
          file and upload it — don't mark a requirement received from a notification.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-accent"
            onClick={() => c.open({ type: "upload", permitId: imp.permit_id })}
          >
            Upload the document
          </button>
          <button
            type="button"
            className="btn-outline"
            onClick={async () => {
              await ignoreImport(imp, "Notification handled");
              await refresh();
              c.open({ type: "import", id });
            }}
          >
            Mark handled
          </button>
        </div>
      </>
    );

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!title.trim() || !revision.trim())
      return setErr("Confirm the document title and revision.");
    if (!verified) return setErr("Confirm you checked the match against the email.");
    if (uncertain && note.trim().length < 5)
      return setErr("Note how you verified the permit, version and round.");
    if (
      group?.versions.some(
        (x) => (x.version_label ?? "").toLowerCase() === revision.trim().toLowerCase(),
      )
    )
      return setErr(
        `Revision ${revision} already exists for that document — confirm the right revision.`,
      );
    if (useForReq && requirement?.document_id) {
      const cur = c.versions.get(requirement.document_id);
      if (cur && groupOf(cur) !== groupId)
        return setErr(
          "That requirement uses a different document. Choose it as the document identity, or don't select the requirement.",
        );
    }
    setBusy(true);
    try {
      const docId = await fileImport(c.ws, imp!, {
        permitId: permit?.id ?? null,
        destination,
        docGroup: groupId || null,
        title,
        revision,
        kind,
        owner,
        requirementId: requirement?.id ?? null,
        useForRequirement: useForReq && !!requirement,
        note,
      });
      await refresh();
      toast.success("Filed as a Received working draft. Earlier submissions are unchanged.");
      c.open({ type: "doc", id: docId });
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Couldn't file this import.");
    } finally {
      setBusy(false);
    }
  }
  if (ignoring)
    return (
      <IgnoreForm
        imp={imp}
        back={() => setIgnoring(false)}
        done={async () => {
          await refresh();
          c.open({ type: "import", id });
        }}
      />
    );
  return (
    <>
      <Head kicker="Review document match" title={imp.filename}>
        <Pill tone={importTone(imp.status)}>{IMPORT_LABEL[imp.status]}</Pill>
        {imp.confidence != null && (
          <Pill tone={imp.confidence >= 0.85 ? "blue" : "amber"}>
            {Math.round(imp.confidence * 100)}% match confidence
          </Pill>
        )}
      </Head>
      <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50/50 p-3 text-sm">
        <b>{imp.match_summary}</b>
        <p className="mt-1 text-muted-foreground">{imp.reason}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <section className="min-w-0 rounded-xl border border-border bg-muted/20 p-3">
          <h3 className="mb-1 text-sm font-semibold">Collected from</h3>
          <div className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <DataField label="Source">{src?.name ?? "—"}</DataField>
            <DataField label="From">{imp.from_address ?? "—"}</DataField>
            <DataField label="Subject">{imp.subject || "—"}</DataField>
            <DataField label="Received">{fmtStamp(imp.source_at)}</DataField>
            <DataField label="Size">{formatBytes(imp.size_bytes)}</DataField>
            <DataField label="Round evidence">{imp.round_evidence ?? "—"}</DataField>
          </div>
          {url && (
            <a
              className="btn-outline mt-2 px-2.5 py-1 text-xs"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Open the file
            </a>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            When the email arrived and when it was collected are kept separately; neither changes
            the city or engineer review clocks.
          </p>
        </section>
        <form onSubmit={confirm} className="grid min-w-0 gap-3">
          <F label="Permit application">
            <select
              className={inputCls}
              value={permitId}
              onChange={(e) => {
                setPermitId(e.target.value);
                setReqId("");
                setUseForReq(false);
              }}
            >
              <option value="">Shared project file / no permit</option>
              {c.ws.permits.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.permit_number ? ` / ${p.permit_number}` : ""}
                </option>
              ))}
            </select>
          </F>
          <F
            label="Submission / destination *"
            hint="Don't guess a round from the date or file name."
          >
            <select
              className={inputCls}
              value={destination}
              onChange={(e) => {
                setDest(e.target.value);
                setReqId("");
                setUseForReq(false);
              }}
            >
              {destOptions.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </F>
          <F label="Document identity">
            <select
              className={inputCls}
              value={groupId}
              onChange={(e) => {
                setGroupId(e.target.value);
                const g = c.groups.find((x) => x.id === e.target.value);
                if (g) {
                  setTitle(g.title);
                  setRevision(suggestRevision(g));
                  if (g.latest.doc_kind) setKind(g.latest.doc_kind);
                }
              }}
            >
              <option value="">A new document</option>
              {c.groups
                .filter((g) => g.latest.release_status !== "city_approved")
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    New revision of: {g.title}
                  </option>
                ))}
            </select>
          </F>
          <F label="Document title *">
            <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
          </F>
          <div className="grid gap-3 sm:grid-cols-2">
            <F label="Revision *">
              <input
                className={inputCls}
                value={revision}
                onChange={(e) => setRevision(e.target.value)}
                placeholder="Confirm the revision"
              />
            </F>
            <F label="Type *">
              <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value)}>
                {DOC_KINDS.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </F>
          </div>
          <F label="Responsible party">
            <input
              className={inputCls}
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="Who provided it"
            />
          </F>
          {reqs.length > 0 && (
            <>
              <F label="Working-package requirement">
                <select
                  className={inputCls}
                  value={reqId}
                  onChange={(e) => {
                    setReqId(e.target.value);
                    setUseForReq(!!e.target.value);
                  }}
                >
                  <option value="">Don't select it for a requirement yet</option>
                  {reqs.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </F>
              {requirement && (
                <label className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={useForReq}
                    onChange={(e) => setUseForReq(e.target.checked)}
                  />
                  Use this version for "{requirement.label}". It becomes Received and needs review
                  before it's ready.
                </label>
              )}
            </>
          )}
          <F label={`Verification note${uncertain ? " *" : ""}`}>
            <textarea
              className={inputCls}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="How you checked the permit, version and round."
            />
          </F>
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={verified}
              onChange={(e) => setVerified(e.target.checked)}
            />
            I checked this match against the email. Filing won't mark anything submitted or
            approved.
          </label>
          {err && <p className="text-sm text-red-700">{err}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-accent" disabled={busy}>
              {busy ? "Filing…" : "Confirm & file as Received"}
            </button>
            <button type="button" className="btn-outline" onClick={() => setIgnoring(true)}>
              Ignore this file
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

function IgnoreForm({
  imp,
  back,
  done,
}: {
  imp: { filename: string } & Parameters<typeof ignoreImport>[0];
  back: () => void;
  done: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (reason.trim().length < 5) return;
        setBusy(true);
        try {
          await ignoreImport(imp, reason.trim());
          done();
        } finally {
          setBusy(false);
        }
      }}
    >
      <Head kicker={imp.filename} title="Ignore this imported file?" />
      <p className="text-sm text-muted-foreground">
        It stays in the activity log but won't be added to the repository.
      </p>
      <div className="mt-3">
        <F label="Reason *">
          <textarea
            className={inputCls}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </F>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-outline" onClick={back}>
          Back
        </button>
        <button
          type="submit"
          className="btn-outline text-red-700"
          disabled={busy || reason.trim().length < 5}
        >
          Ignore file
        </button>
      </div>
    </form>
  );
}

// ── a source's settings ─────────────────────────────────────────────────────
function SourceSettings({ id, c, refresh }: Props & { id: string }) {
  const s = c.ws.sources.find((x) => x.id === id);
  const [autoFile, setAutoFile] = useState(s?.auto_file ?? false);
  const [permitIds, setPermitIds] = useState<string[]>(s?.permit_ids ?? []);
  const [domains, setDomains] = useState((s?.match_domains ?? []).join(", "));
  const [busy, setBusy] = useState(false);
  if (!s) return null;
  const address = s.type === "email" ? inboxAddress(s) : "";
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await updateSource(s!.id, {
        auto_file: autoFile,
        permit_ids: permitIds,
        ...(s!.type === "portal"
          ? {
              match_domains: domains
                .split(/[,\s]+/)
                .map((x) => x.trim().toLowerCase())
                .filter(Boolean),
            }
          : {}),
      });
      await refresh();
      toast.success("Collection settings saved.");
    } finally {
      setBusy(false);
    }
  }
  async function setStatus(status: SourceRow["status"]) {
    setBusy(true);
    try {
      await updateSource(s!.id, {
        status,
        message:
          status === "disconnected"
            ? "Collection is stopped. Files already collected and submission records are kept."
            : null,
      });
      await refresh();
      toast.success(
        status === "disconnected"
          ? "Source disconnected. Nothing was deleted."
          : "Source reconnected.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Head kicker="Connection settings" title={s.name}>
        <Pill tone={s.status === "connected" ? "green" : "amber"}>
          {s.status.replace("_", " ")}
        </Pill>
        <Pill tone="blue">Read-only collection</Pill>
      </Head>
      {address && (
        <div className="mb-3 rounded-xl border border-violet-200 bg-violet-50/60 p-3 text-sm">
          <div className="text-xs font-semibold text-violet-900">Project inbox address</div>
          <div className="mt-1 font-mono [overflow-wrap:anywhere]">{address}</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Forward or CC emails with documents here — consultants' transmittals, the owner's
            authorizations, city letters, and portal notifications. Attachments are collected the
            moment the email arrives.
          </p>
        </div>
      )}
      <div className="grid gap-x-4 sm:grid-cols-2">
        <DataField label="Provider">{s.provider ?? "—"}</DataField>
        <DataField label="Reference">{s.reference ?? "—"}</DataField>
        <DataField label="Last successful check">
          {s.last_success ? fmtStamp(s.last_success) : "Nothing collected yet"}
        </DataField>
        <DataField label="Last attempted check">
          {s.last_attempt ? fmtStamp(s.last_attempt) : "Not attempted"}
        </DataField>
      </div>
      <form onSubmit={save} className="mt-3 grid gap-3">
        {s.type === "portal" && (
          <F
            label="Portal sender domains"
            hint="Emails from these domains (e.g. accela.com, roundrocktexas.gov) are credited to this portal."
          >
            <input
              className={inputCls}
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
            />
          </F>
        )}
        <fieldset className="grid gap-1.5 rounded-lg border border-border p-3">
          <legend className="px-1 text-xs font-semibold">Linked permit applications</legend>
          {c.ws.permits.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={permitIds.includes(p.id)}
                onChange={(e) =>
                  setPermitIds(
                    e.target.checked ? [...permitIds, p.id] : permitIds.filter((x) => x !== p.id),
                  )
                }
              />
              {p.name}
              {p.permit_number ? ` / ${p.permit_number}` : ""}
            </label>
          ))}
          <span className="text-[11px] text-muted-foreground">
            None ticked = all permits in this project.
          </span>
        </fieldset>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={autoFile}
            onChange={(e) => setAutoFile(e.target.checked)}
          />
          Auto-file exact matches as Received. Anything uncertain — permit, version or round —
          always waits for review.
        </label>
        <Notice>
          Auto-filing only adds a working draft. It never selects a file for a requirement, releases
          it, marks it ready, records a submission or approves a permit.
        </Notice>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn-accent" disabled={busy}>
            Save settings
          </button>
          {s.status === "connected" ? (
            <>
              <button
                type="button"
                className="btn-outline"
                disabled={c.syncing.has(s.id)}
                onClick={() => c.syncNow(s)}
              >
                {c.syncing.has(s.id) ? "Checking…" : "Sync now"}
              </button>
              <button
                type="button"
                className="btn-outline text-red-700"
                disabled={busy}
                onClick={() => setStatus("disconnected")}
              >
                Disconnect
              </button>
            </>
          ) : s.status === "disconnected" ? (
            <button
              type="button"
              className="btn-outline"
              disabled={busy}
              onClick={() => setStatus("connected")}
            >
              Reconnect
            </button>
          ) : null}
          <button type="button" className="btn-outline" onClick={() => c.go("imports")}>
            View imported files
          </button>
        </div>
      </form>
    </>
  );
}

// ── connecting a source ─────────────────────────────────────────────────────
function ConnectSource({ c, refresh }: Props) {
  const [type, setType] = useState<"email" | "portal" | null>(null);
  const inbox = c.ws.sources.find((s) => s.type === "email");
  const [name, setName] = useState("");
  const [reference, setReference] = useState("");
  const [domains, setDomains] = useState("");
  const [permitIds, setPermitIds] = useState<string[]>(c.ws.permits.map((p) => p.id));
  const [owner, setOwner] = useState("Permit coordinator");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const projectId = c.projectId;
  async function create(e: FormEvent) {
    e.preventDefault();
    if (!projectId) return setErr("This project has no permits yet.");
    if (!type) return;
    if (type === "portal" && !domains.trim())
      return setErr("Enter at least one sender domain for the portal's emails.");
    setBusy(true);
    try {
      const s = await createSource({
        projectId,
        type,
        name: name.trim() || (type === "email" ? "Project inbox" : "City portal"),
        provider: type === "email" ? "CorvusDP project inbox" : "City portal notifications",
        reference: reference.trim(),
        matchDomains: domains
          .split(/[,\s]+/)
          .map((x) => x.trim().toLowerCase())
          .filter(Boolean),
        permitIds: permitIds.length === c.ws.permits.length ? [] : permitIds,
        owner,
        autoFile: false,
      });
      await refresh();
      toast.success(
        type === "email" ? "Project inbox ready." : "Portal connected to the project inbox.",
      );
      c.open({ type: "source", id: s.id });
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Couldn't connect.");
    } finally {
      setBusy(false);
    }
  }
  if (!type)
    return (
      <>
        <Head kicker="Project-scoped collection" title="Connect a document source" />
        <p className="mb-3 text-sm text-muted-foreground">Choose where documents will come from.</p>
        <div className="grid gap-3 md:grid-cols-3">
          <Choice
            icon={<Mail className="h-6 w-6" aria-hidden />}
            title="Project email inbox"
            text={
              inbox
                ? "Already set up for this project."
                : "A dedicated address for this project. Forward or CC emails with documents; attachments are collected as they arrive."
            }
            disabled={!!inbox}
            onClick={() => {
              setType("email");
              setName("Project inbox");
            }}
          />
          <Choice
            icon={<Landmark className="h-6 w-6" aria-hidden />}
            title="City portal"
            text="Point the portal's notification emails at the project inbox. Letters and receipts they attach are collected; sign-in-only links are flagged."
            disabled={!inbox}
            note={!inbox ? "Set up the project inbox first." : undefined}
            onClick={() => {
              setType("portal");
              setName("City portal");
            }}
          />
          <Choice
            icon={<FolderOpen className="h-6 w-6" aria-hidden />}
            title="Shared folder"
            text="Google Drive / Dropbox folder sync needs CorvusRE's app connection to be set up. Until then, share files to the project inbox or upload them."
            disabled
            note="Needs setup by CorvusRE"
          />
        </div>
        <Notice>
          Collection is read-only: no portal submissions, fees or signatures are ever made from
          here.
        </Notice>
      </>
    );
  return (
    <form onSubmit={create} className="grid gap-3">
      <Head
        kicker="Read-only collection"
        title={type === "email" ? "Set up the project inbox" : "Connect a city portal"}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <F label="Connection name *">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </F>
        <F label="Responsible person">
          <input className={inputCls} value={owner} onChange={(e) => setOwner(e.target.value)} />
        </F>
        {type === "portal" && (
          <>
            <F label="Portal / agency" hint="e.g. Round Rock eTRAKiT">
              <input
                className={inputCls}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </F>
            <F
              label="Portal sender domains *"
              hint="Where the portal's emails come from, e.g. accela.com, roundrocktexas.gov"
            >
              <input
                className={inputCls}
                value={domains}
                onChange={(e) => setDomains(e.target.value)}
              />
            </F>
          </>
        )}
      </div>
      <fieldset className="grid gap-1.5 rounded-lg border border-border p-3">
        <legend className="px-1 text-xs font-semibold">Link to permit applications</legend>
        {c.ws.permits.map((p) => (
          <label key={p.id} className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={permitIds.includes(p.id)}
              onChange={(e) =>
                setPermitIds(
                  e.target.checked ? [...permitIds, p.id] : permitIds.filter((x) => x !== p.id),
                )
              }
            />
            {p.name}
            {p.permit_number ? ` / ${p.permit_number}` : ""}
          </label>
        ))}
      </fieldset>
      {type === "portal" && inbox && (
        <Notice>
          Set the portal's notification email (in your portal account) to{" "}
          <b className="font-mono">{inboxAddress(inbox)}</b>.
        </Notice>
      )}
      {err && <p className="text-sm text-red-700">{err}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-outline" onClick={() => setType(null)}>
          Back
        </button>
        <button type="submit" className="btn-accent" disabled={busy}>
          {busy ? "Connecting…" : type === "email" ? "Create project inbox" : "Connect portal"}
        </button>
      </div>
    </form>
  );
}

function Choice({
  icon,
  title,
  text,
  onClick,
  disabled,
  note,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  onClick?: () => void;
  disabled?: boolean;
  note?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="grid gap-2 rounded-xl border border-border bg-card p-4 text-left hover:border-emerald-400 hover:bg-emerald-50/40 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className="text-emerald-700">{icon}</span>
      <b className="text-sm">{title}</b>
      <small className="text-xs text-muted-foreground">{text}</small>
      {note && <small className="text-[11px] font-semibold text-amber-800">{note}</small>}
    </button>
  );
}

// ── a submitted round ───────────────────────────────────────────────────────
function SubmissionRecord({ id, c }: Props & { id: string }) {
  const s = c.ws.submissions.find((x) => x.id === id);
  const p = s ? c.ws.permits.find((x) => x.id === s.permit_id) : undefined;
  if (!s || !p) return null;
  const round = permitRounds(p, c.ws.submissions, c.ws.comments).find((r) => r.id === id)!;
  const now = new Date();
  const city = cityClock(round, now);
  const eng = engineerWindow(round, now);
  const prev = c.ws.submissions.find((x) => x.permit_id === p.id && x.round === s.round - 1);
  const omitted =
    prev?.manifest?.filter((m) => !s.manifest?.some((n) => n.doc_group === m.doc_group)) ?? [];
  const supporting = c.ws.versions.filter((v) => v.submission_id === s.id);
  const exportManifest = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            permit: { name: p.name, number: p.permit_number },
            round: s.round,
            filed: s.submitted_at,
            basis: s.manifest_basis,
            files: s.manifest ?? [],
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(p.permit_number || p.name).replace(/[^\w-]+/g, "_")}_Submission_${s.round}_manifest.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  };
  return (
    <>
      <Head
        kicker={`${p.name}${p.permit_number ? ` / ${p.permit_number}` : ""}`}
        title={`Submission ${s.round}`}
      >
        <Pill tone="green">Submitted</Pill>
        <Pill
          tone={s.outcome === "approved" ? "green" : s.outcome === "comments" ? "amber" : "blue"}
        >
          {OUTCOME_LABEL[s.outcome]}
        </Pill>
      </Head>
      <Notice>
        <b>What this round sent can't change.</b> These are the exact versions recorded when it was
        filed
        {s.manifest_basis === "selected_at_filing"
          ? " (the selections at filing — the package wasn't frozen first)"
          : ""}
        , even if newer revisions exist.
      </Notice>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <DataField label="Filed">{fmtStamp(s.submitted_at)}</DataField>
        <DataField label="City review started">{fmtStamp(s.review_started_at)}</DataField>
        <DataField label="Expected city response">
          {s.expected_at
            ? `${fmtStamp(s.expected_at)}${s.expected_basis ? ` · ${s.expected_basis}` : ""}`
            : "Not estimated"}
        </DataField>
        <DataField label="City response">
          {s.city_returned_at ? fmtStamp(s.city_returned_at) : "Awaiting response"}
        </DataField>
        <DataField label="Method / confirmation">
          {[s.method, s.confirmation].filter(Boolean).join(" · ") || "Not recorded"}
        </DataField>
        <DataField label="Submitted by">{s.submitted_by ?? "Not recorded"}</DataField>
      </div>
      <div className="my-3 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border p-3">
          <div className="text-xs text-muted-foreground">City time</div>
          <b className="text-lg">{city.value == null ? city.state : fmtDays(city.value)}</b>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="text-xs text-muted-foreground">Engineer window</div>
          <b className="text-lg">{eng.value == null ? eng.state : fmtDays(eng.value)}</b>
        </div>
      </div>
      <h3 className="mb-2 text-sm font-semibold">
        Exactly what was sent ({s.manifest?.length ?? 0} files)
      </h3>
      {s.manifest?.length ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Document</th>
                <th className="px-3 py-2">Exact version</th>
                <th className="px-3 py-2">Vs. prior round</th>
              </tr>
            </thead>
            <tbody>
              {s.manifest.map((m) => {
                const ch = changeVsPrevious(m, prev?.manifest);
                return (
                  <tr key={m.requirement_id + m.document_id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="text-left text-accent hover:underline"
                        onClick={() => c.open({ type: "doc", id: m.document_id })}
                      >
                        {m.name}
                      </button>
                      <div className="text-xs text-muted-foreground">{m.requirement}</div>
                    </td>
                    <td className="px-3 py-2">
                      <Pill tone="blue">{m.version_label ?? "—"}</Pill>
                    </td>
                    <td className="px-3 py-2">
                      <Pill tone={ch === "Revised" ? "amber" : ch === "Reused" ? "blue" : "gray"}>
                        {ch}
                      </Pill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No file list was recorded for this round
          {s.manifest
            ? " — no documents were selected when it was filed"
            : " — it was filed before file lists were kept"}
          .
        </p>
      )}
      {omitted.length > 0 && (
        <Notice tone="warn">
          <b>Not included from the prior round:</b> {omitted.map((m) => m.name).join("; ")}. The
          earlier record is unchanged.
        </Notice>
      )}
      <h3 className="mb-2 mt-4 text-sm font-semibold">Supporting records</h3>
      <p className="mb-2 text-xs text-muted-foreground">
        City letters, receipts and other records linked to this round — not part of what it sent.
      </p>
      {supporting.length ? (
        <ul className="grid gap-1 text-sm">
          {supporting.map((v) => (
            <li key={v.id}>
              <VersionLink v={v} open={c.open} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">None yet.</p>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className="btn-outline"
          onClick={() => c.open({ type: "upload", permitId: p.id, submissionId: s.id })}
        >
          Add supporting record
        </button>
        <button type="button" className="btn-accent" onClick={exportManifest}>
          Export file list
        </button>
      </div>
    </>
  );
}
