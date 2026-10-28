import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  FileText,
  Loader2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useActiveProjectBundle } from "@/hooks/use-project";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import {
  Section,
  Pill,
  EmptyProject,
  Loading,
  Field,
  inputCls,
  StepRail,
} from "@/components/dp-ui";
import { dateShort } from "@/lib/format";
import {
  ACCEPTED_DRAWINGS,
  AREAS,
  DISCIPLINES,
  addConsultant,
  areaLabel,
  clearConfirmedValue,
  consultantName,
  deleteConsultant,
  disciplineLabel,
  groupIssuesByDiscipline,
  isDaycare,
  issueCounts,
  latestReview,
  listComplianceDocs,
  listConfirmedValues,
  listConsultants,
  listIssues,
  mergeValues,
  readDrawing,
  saveConfirmedValue,
  setDocDiscipline,
  startComplianceCheck,
  updateIssue,
  uploadDrawing,
  type ComplianceDoc,
  type ComplianceIssue,
  type Consultant,
  type Discipline,
  type IssueStatus,
  type MergedValue,
} from "@/lib/compliance";

export const Route = createFileRoute("/dashboard/_layout/compliance")({
  head: () => ({ meta: [{ title: "Compliance Check — CorvusDP" }] }),
  component: Compliance,
});

const SEVERITY_TONE = { critical: "red", high: "amber", medium: "blue", low: "gray" } as const;
const CONF_TONE = { high: "green", medium: "amber", low: "red" } as const;
const STATE_LABEL: Record<
  MergedValue["state"],
  [string, "green" | "amber" | "red" | "blue" | "gray"]
> = {
  confirmed: ["Confirmed", "green"],
  not_applicable: ["Not applicable", "gray"],
  extracted: ["Read — confirm", "blue"],
  needs_confirmation: ["Needs confirmation", "amber"],
  missing: ["Missing", "red"],
};
const STATUS_OPTIONS: { id: IssueStatus; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "in_progress", label: "In progress" },
  { id: "fixed", label: "Fixed" },
  { id: "not_an_issue", label: "Not an issue" },
];

function Compliance() {
  const { loading, hasProject, project } = useActiveProjectBundle();
  const projectId = project?.id;
  const qc = useQueryClient();

  const docs = useQuery({
    queryKey: ["compliance-docs", projectId],
    queryFn: () => listComplianceDocs(projectId!),
    enabled: !!projectId,
  });
  const consultants = useQuery({
    queryKey: ["consultants", projectId],
    queryFn: () => listConsultants(projectId!),
    enabled: !!projectId,
  });
  const confirmed = useQuery({
    queryKey: ["compliance-values", projectId],
    queryFn: () => listConfirmedValues(projectId!),
    enabled: !!projectId,
  });
  const review = useQuery({
    queryKey: ["compliance-review", projectId],
    queryFn: () => latestReview(projectId!),
    enabled: !!projectId,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 4000 : false),
  });
  const reviewId = review.data?.status === "done" ? review.data.id : null;
  const issues = useQuery({
    queryKey: ["compliance-issues", reviewId],
    queryFn: () => listIssues(reviewId!),
    enabled: !!reviewId,
  });

  const daycare = project ? isDaycare(project) : false;
  const merged = useMemo(
    () => mergeValues(docs.data ?? [], confirmed.data ?? [], { daycare }),
    [docs.data, confirmed.data, daycare],
  );

  if (loading) return <Loading />;
  if (!hasProject || !project || !projectId) return <EmptyProject />;

  const docList = docs.data ?? [];
  const step = !docList.length
    ? 0
    : docList.some((d) => d.drawing_index || d.cad_summary)
      ? merged.some((m) => m.state === "confirmed")
        ? review.data
          ? 4
          : 3
        : 2
      : 1;

  return (
    <div className="grid gap-5">
      <Section
        title={
          <span className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-accent" aria-hidden /> Design & Code Compliance
            Check
          </span>
        }
        subtitle="Check the drawing set before it goes to the city — fewer review comments, fewer consultant revisions, a more complete first submission."
      >
        <StepRail
          steps={[
            "Upload drawings",
            "Corvus AI reads them",
            "Confirm values",
            "Run the check",
            "Fix & resolve",
          ]}
          current={step}
        />
        <p className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
          A pre-submission quality check, not the city's review and not a substitute for your
          licensed design professionals. Corvus AI flags <em>potential</em> issues; code citations
          are Corvus AI's own — verify them against the code editions and local amendments your city
          has adopted.
        </p>
      </Section>

      <DrawingSet
        projectId={projectId}
        docs={docList}
        loading={docs.isLoading}
        refetch={() => qc.invalidateQueries({ queryKey: ["compliance-docs", projectId] })}
      />
      <Consultants
        projectId={projectId}
        consultants={consultants.data ?? []}
        refetch={() => {
          qc.invalidateQueries({ queryKey: ["consultants", projectId] });
          qc.invalidateQueries({ queryKey: ["compliance-issues"] });
        }}
      />
      <DesignValues
        projectId={projectId}
        merged={merged}
        consultants={consultants.data ?? []}
        hasReadings={docList.some((d) => d.drawing_index)}
        refetch={() => qc.invalidateQueries({ queryKey: ["compliance-values", projectId] })}
      />
      <RunCheck
        projectId={projectId}
        docs={docList}
        merged={merged}
        review={review.data ?? null}
        refetch={() => qc.invalidateQueries({ queryKey: ["compliance-review", projectId] })}
      />
      {reviewId && (
        <Issues
          issues={issues.data ?? []}
          loading={issues.isLoading}
          docs={docList}
          consultants={consultants.data ?? []}
          refetch={() => qc.invalidateQueries({ queryKey: ["compliance-issues", reviewId] })}
        />
      )}
    </div>
  );
}

// ── 1. drawing set ─────────────────────────────────────────────────────────
function DrawingSet({
  projectId,
  docs,
  loading,
  refetch,
}: {
  projectId: string;
  docs: ComplianceDoc[];
  loading: boolean;
  refetch: () => void;
}) {
  const { user } = useAuth();
  const [discipline, setDiscipline] = useState<Discipline>("architectural");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [reading, setReading] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  async function read(ids: string[]) {
    for (const id of ids) {
      setReading((s) => new Set(s).add(id));
      try {
        await readDrawing(id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't read that drawing.");
      } finally {
        setReading((s) => {
          const n = new Set(s);
          n.delete(id);
          return n;
        });
        refetch();
      }
    }
  }

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !files.length) return;
    setError(null);
    const before = new Set(docs.map((d) => d.id));
    try {
      for (const file of files) {
        setBusy(`Uploading ${file.name}…`);
        await uploadDrawing({ userId: user.id, projectId, file, discipline });
      }
      setFiles([]);
      const fresh = await listComplianceDocs(projectId);
      refetch();
      setBusy(null);
      await read(
        fresh
          .filter((d) => !before.has(d.id) && d.mime_type === "application/pdf")
          .map((d) => d.id),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      refetch();
    } finally {
      setBusy(null);
    }
  }

  async function open(path: string | null) {
    if (!path) return;
    const { data } = await supabase.storage.from("project-docs").createSignedUrl(path, 120);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
  }

  const grouped = DISCIPLINES.map((d) => ({
    d,
    items: docs.filter((x) => (x.discipline ?? "other") === d.id),
  })).filter((g) => g.items.length);

  return (
    <Section
      title="Drawing set"
      subtitle="Architectural, civil, structural, MEP, fire protection, survey and supporting documents. PDFs (multi-page sets welcome) and DXF; DWG is stored but needs a DXF or PDF export to be checked."
    >
      <form onSubmit={upload} className="grid gap-3 sm:grid-cols-[200px_1fr_auto] sm:items-end">
        <Field label="Discipline">
          <select
            className={inputCls}
            value={discipline}
            onChange={(e) => setDiscipline(e.target.value as Discipline)}
          >
            {DISCIPLINES.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Files" hint="PDF, DXF or DWG — up to 100 MB each">
          <input
            type="file"
            multiple
            accept={ACCEPTED_DRAWINGS}
            className={inputCls}
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
        </Field>
        <button type="submit" className="btn-accent" disabled={!files.length || !!busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Upload
        </button>
      </form>
      {busy && <p className="mt-2 text-sm text-muted-foreground">{busy}</p>}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      <div className="mt-5 grid gap-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !grouped.length ? (
          <p className="text-sm text-muted-foreground">
            No drawings yet — upload the set you're about to submit.
          </p>
        ) : (
          grouped.map(({ d, items }) => (
            <div key={d.id}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {d.label}
              </h3>
              <ul className="grid gap-2">
                {items.map((doc) => (
                  <DocRow
                    key={doc.id}
                    doc={doc}
                    reading={reading.has(doc.id)}
                    onRead={() => read([doc.id])}
                    onOpen={() => open(doc.storage_path)}
                    onDiscipline={async (v) => {
                      await setDocDiscipline(doc.id, v);
                      refetch();
                    }}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </Section>
  );
}

function DocRow({
  doc,
  reading,
  onRead,
  onOpen,
  onDiscipline,
}: {
  doc: ComplianceDoc;
  reading: boolean;
  onRead: () => void;
  onOpen: () => void;
  onDiscipline: (d: Discipline) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isPdf = doc.mime_type === "application/pdf" || /\.pdf$/i.test(doc.storage_path ?? "");
  const idx = doc.drawing_index;
  const cad = doc.cad_summary;
  const scaleIssues =
    idx?.sheets.filter((s) => s.scaleIssue || (!s.scale && s.discipline !== "other")) ?? [];
  let status: React.ReactNode;
  if (reading) {
    status = (
      <Pill tone="blue">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Reading sheets…
      </Pill>
    );
  } else if (isPdf && idx) {
    status = (
      <Pill tone={idx.quality === "clear" ? "green" : "amber"}>
        {idx.sheets.length} sheets read
      </Pill>
    );
  } else if (isPdf && doc.drawing_read_error) {
    status = <Pill tone="red">Couldn't read</Pill>;
  } else if (isPdf) {
    status = <Pill tone="gray">Not read yet</Pill>;
  } else if (cad?.format === "dxf") {
    status = <Pill tone="green">DXF · {cad.entityCount} entities</Pill>;
  } else {
    status = <Pill tone="amber">DWG — export DXF/PDF</Pill>;
  }

  return (
    <li className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline"
        >
          {doc.name}
        </button>
        <span className="text-xs text-muted-foreground">
          {doc.page_count ? `${doc.page_count} pages · ` : ""}
          {dateShort(doc.created_at)}
        </span>
        <select
          aria-label="Discipline"
          className="rounded-md border border-input bg-background px-2 py-1 text-xs"
          value={doc.discipline ?? "other"}
          onChange={(e) => onDiscipline(e.target.value as Discipline)}
        >
          {DISCIPLINES.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
        {status}
        {isPdf && !reading && (doc.drawing_read_error || !idx) && (
          <button type="button" className="btn-outline px-2 py-1 text-xs" onClick={onRead}>
            {doc.drawing_read_error ? "Retry" : "Read"}
          </button>
        )}
        {(idx || cad) && (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            Details{" "}
            <ChevronDown
              className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
              aria-hidden
            />
          </button>
        )}
      </div>
      {doc.drawing_read_error && !reading && (
        <p className="px-3 pb-2 text-xs text-destructive">{doc.drawing_read_error}</p>
      )}
      {expanded && idx && (
        <div className="border-t border-border px-3 py-3">
          {scaleIssues.length > 0 && (
            <p className="mb-2 flex items-start gap-1.5 text-xs text-[oklch(0.45_0.12_55)]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {scaleIssues.length} sheet{scaleIssues.length === 1 ? "" : "s"} with a missing or
              questionable scale — nothing on those sheets is measured; values come only from
              printed dimensions.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left uppercase text-muted-foreground">
                  <th className="px-2 py-1 font-medium">Pg</th>
                  <th className="px-2 py-1 font-medium">Sheet</th>
                  <th className="px-2 py-1 font-medium">Title</th>
                  <th className="px-2 py-1 font-medium">Discipline</th>
                  <th className="px-2 py-1 font-medium">Scale</th>
                  <th className="px-2 py-1 font-medium">Content</th>
                </tr>
              </thead>
              <tbody>
                {idx.sheets.map((s) => (
                  <tr key={`${s.page}-${s.number}`} className="border-b border-border/60 align-top">
                    <td className="px-2 py-1 tabular-nums">{s.page}</td>
                    <td className="px-2 py-1 font-medium">{s.number ?? "—"}</td>
                    <td className="px-2 py-1">{s.title ?? "—"}</td>
                    <td className="px-2 py-1">{disciplineLabel(s.discipline)}</td>
                    <td className="px-2 py-1">
                      {s.scale ?? <span className="text-muted-foreground">none stated</span>}
                      {s.scaleBar && <span className="text-muted-foreground"> · scale bar</span>}
                      {s.scaleIssue && <p className="text-[oklch(0.45_0.12_55)]">{s.scaleIssue}</p>}
                    </td>
                    <td className="px-2 py-1 text-muted-foreground">
                      {[
                        s.schedules.length && `Schedules: ${s.schedules.join(", ")}`,
                        s.rooms.length &&
                          `Rooms: ${s.rooms.slice(0, 8).join(", ")}${s.rooms.length > 8 ? "…" : ""}`,
                        s.equipment.length && `Equipment: ${s.equipment.slice(0, 8).join(", ")}`,
                        s.dimensions.length && `Dimensions: ${s.dimensions.slice(0, 6).join(", ")}`,
                        s.references.length && `Refs: ${s.references.slice(0, 8).join(", ")}`,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {idx.flags.length > 0 && (
            <ul className="mt-2 grid gap-1 text-xs text-muted-foreground">
              {idx.flags.map((f, i) => (
                <li key={i}>
                  <span className="font-medium text-foreground">{f.field}:</span> {f.issue}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {expanded && cad && (
        <div className="border-t border-border px-3 py-3 text-xs">
          {cad.format === "dxf" ? (
            <div className="grid gap-1">
              <p>
                Units: <strong>{cad.units.name}</strong> · {cad.layers.length} layers ·{" "}
                {cad.dimensions.length} dimensions · {cad.texts.length} text labels ·{" "}
                {cad.closedAreas.length} closed outlines
              </p>
              {cad.dimensions.filter((d) => d.overridden).length > 0 && (
                <p className="text-[oklch(0.45_0.12_55)]">
                  Overridden dimensions:{" "}
                  {cad.dimensions
                    .filter((d) => d.overridden)
                    .slice(0, 10)
                    .map((d) => `"${d.text}" drawn ${d.measured} ${cad.units.name.toLowerCase()}`)
                    .join("; ")}
                </p>
              )}
              {cad.warnings.map((w) => (
                <p key={w} className="text-muted-foreground">
                  {w}
                </p>
              ))}
            </div>
          ) : (
            cad.warnings.map((w) => (
              <p key={w} className="text-muted-foreground">
                {w}
              </p>
            ))
          )}
        </div>
      )}
    </li>
  );
}

// ── 2. consultants ─────────────────────────────────────────────────────────
function Consultants({
  projectId,
  consultants,
  refetch,
}: {
  projectId: string;
  consultants: Consultant[];
  refetch: () => void;
}) {
  const empty = {
    discipline: "architectural" as Discipline,
    firm: "",
    contact_name: "",
    email: "",
    phone: "",
  };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.firm.trim() && !form.contact_name.trim()) {
      setError("Add a firm or a contact name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addConsultant({
        project_id: projectId,
        discipline: form.discipline,
        firm: form.firm.trim() || null,
        contact_name: form.contact_name.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
      });
      setForm(empty);
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add the consultant.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Consultants"
      subtitle="Who is responsible for each discipline. Issues are assigned to the consultant for their discipline."
    >
      {consultants.length > 0 && (
        <ul className="mb-4 grid gap-2 sm:grid-cols-2">
          {consultants.map((c) => (
            <li
              key={c.id}
              className="flex items-start justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <Pill tone="blue">{disciplineLabel(c.discipline)}</Pill>
                <p className="mt-1 font-medium">{consultantName(c)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[c.email, c.phone].filter(Boolean).join(" · ")}
                </p>
              </div>
              <button
                type="button"
                aria-label={`Remove ${consultantName(c)}`}
                className="text-muted-foreground hover:text-destructive"
                onClick={async () => {
                  await deleteConsultant(c.id);
                  refetch();
                }}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={submit}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[160px_1fr_1fr_1fr_140px_auto] lg:items-end"
      >
        <Field label="Discipline">
          <select
            className={inputCls}
            value={form.discipline}
            onChange={(e) => setForm({ ...form, discipline: e.target.value as Discipline })}
          >
            {DISCIPLINES.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Firm">
          <input
            className={inputCls}
            value={form.firm}
            onChange={(e) => setForm({ ...form, firm: e.target.value })}
          />
        </Field>
        <Field label="Contact">
          <input
            className={inputCls}
            value={form.contact_name}
            onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            className={inputCls}
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Field>
        <Field label="Phone">
          <input
            className={inputCls}
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </Field>
        <button type="submit" className="btn-outline" disabled={busy}>
          Add
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </Section>
  );
}

// ── 3. design values ───────────────────────────────────────────────────────
function DesignValues({
  projectId,
  merged,
  consultants,
  hasReadings,
  refetch,
}: {
  projectId: string;
  merged: MergedValue[];
  consultants: Consultant[];
  hasReadings: boolean;
  refetch: () => void;
}) {
  const [confirmer, setConfirmer] = useState<string>("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const counts = {
    confirmed: merged.filter((m) => m.state === "confirmed" || m.state === "not_applicable").length,
    review: merged.filter((m) => m.state === "needs_confirmation" || m.state === "extracted")
      .length,
    missing: merged.filter((m) => m.state === "missing").length,
  };
  const groups = [...new Set(merged.map((m) => m.def.group))];

  async function save(
    m: MergedValue,
    status: "confirmed" | "corrected" | "not_applicable",
    value: string | null,
  ) {
    setError(null);
    try {
      await saveConfirmedValue({
        projectId,
        key: m.def.key,
        value,
        unit: m.def.unit || null,
        status,
        consultantId: confirmer || null,
      });
      setEditing(null);
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    }
  }

  return (
    <Section
      title="Design values"
      subtitle="What Corvus AI read from the drawings. Confirm or correct each value before the check — confirmed values always win."
      right={
        consultants.length > 0 ? (
          <label className="grid gap-1 text-xs">
            <span className="text-muted-foreground">Confirming for</span>
            <select
              className="rounded-md border border-input bg-background px-2 py-1 text-xs"
              value={confirmer}
              onChange={(e) => setConfirmer(e.target.value)}
            >
              <option value="">Project team</option>
              {consultants.map((c) => (
                <option key={c.id} value={c.id}>
                  {consultantName(c)}
                </option>
              ))}
            </select>
          </label>
        ) : undefined
      }
    >
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <Pill tone="green">{counts.confirmed} confirmed</Pill>
        <Pill tone="amber">{counts.review} to confirm</Pill>
        <Pill tone="red">{counts.missing} not on the drawings</Pill>
      </div>
      {!hasReadings && (
        <p className="mb-3 text-sm text-muted-foreground">
          Upload PDF drawings and Corvus AI fills these in. You can also enter values yourself.
        </p>
      )}
      {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
      <div className="grid gap-5">
        {groups.map((g) => (
          <div key={g}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {g}
            </h3>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {merged
                .filter((m) => m.def.group === g)
                .map((m) => {
                  const [label, tone] = STATE_LABEL[m.state];
                  const shown = m.confirmed ? m.confirmed.value : m.best?.value;
                  return (
                    <li
                      key={m.def.key}
                      className="grid gap-2 px-3 py-2 text-sm sm:grid-cols-[1fr_auto] sm:items-center"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{m.def.label}</span>
                          <Pill tone={tone}>{label}</Pill>
                          {!m.confirmed && m.best && (
                            <Pill tone={CONF_TONE[m.best.confidence]}>
                              {m.best.confidence} confidence
                            </Pill>
                          )}
                        </div>
                        {editing === m.def.key ? (
                          <form
                            className="mt-1 flex flex-wrap gap-2"
                            onSubmit={(e) => {
                              e.preventDefault();
                              if (draft.trim())
                                void save(m, m.best ? "corrected" : "confirmed", draft.trim());
                            }}
                          >
                            <input
                              className={`${inputCls} max-w-[200px] py-1`}
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              aria-label={`${m.def.label} value`}
                            />
                            <span className="self-center text-xs text-muted-foreground">
                              {m.def.unit}
                            </span>
                            <button type="submit" className="btn-accent px-2 py-1 text-xs">
                              Save
                            </button>
                            <button
                              type="button"
                              className="text-xs text-muted-foreground"
                              onClick={() => setEditing(null)}
                            >
                              Cancel
                            </button>
                          </form>
                        ) : (
                          <p className="mt-0.5 text-sm">
                            {m.state === "not_applicable" ? (
                              <span className="text-muted-foreground">
                                Doesn't apply to this project
                              </span>
                            ) : shown ? (
                              <>
                                <strong className="tabular-nums">{shown}</strong> {m.def.unit}
                                {m.confirmed?.status === "corrected" && m.best && (
                                  <span className="text-xs text-muted-foreground">
                                    {" "}
                                    (drawings say {m.best.value})
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-muted-foreground">
                                Not shown on the drawings
                              </span>
                            )}
                          </p>
                        )}
                        {m.best && !m.confirmed && (
                          <p className="text-xs text-muted-foreground">
                            {m.best.documentName}
                            {m.best.sheet ? ` · ${m.best.sheet}` : ""}
                            {m.best.basis === "derived" ? " · calculated" : ""}
                            {m.best.source ? ` — “${m.best.source}”` : ""}
                          </p>
                        )}
                        {m.conflicts.length > 0 && !m.confirmed && (
                          <p className="text-xs text-[oklch(0.45_0.12_55)]">
                            Sheets disagree:{" "}
                            {m.conflicts
                              .map((c) => `${c.value}${c.sheet ? ` on ${c.sheet}` : ""}`)
                              .join(", ")}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {m.confirmed ? (
                          <button
                            type="button"
                            className="btn-outline px-2 py-1 text-xs"
                            onClick={async () => {
                              await clearConfirmedValue(projectId, m.def.key);
                              refetch();
                            }}
                          >
                            Undo
                          </button>
                        ) : (
                          <>
                            {m.best && (
                              <button
                                type="button"
                                className="btn-outline px-2 py-1 text-xs"
                                onClick={() => save(m, "confirmed", m.best!.value)}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Confirm
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn-outline px-2 py-1 text-xs"
                              onClick={() => {
                                setEditing(m.def.key);
                                setDraft(m.best?.value ?? "");
                              }}
                            >
                              {m.best ? "Correct" : "Enter"}
                            </button>
                            <button
                              type="button"
                              className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                              onClick={() => save(m, "not_applicable", null)}
                            >
                              N/A
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── 4. run ─────────────────────────────────────────────────────────────────
function RunCheck({
  projectId,
  docs,
  merged,
  review,
  refetch,
}: {
  projectId: string;
  docs: ComplianceDoc[];
  merged: MergedValue[];
  review: Awaited<ReturnType<typeof latestReview>>;
  refetch: () => void;
}) {
  const checkable = docs.filter(
    (d) =>
      d.mime_type === "application/pdf" ||
      /\.pdf$/i.test(d.storage_path ?? "") ||
      d.cad_summary?.format === "dxf",
  );
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const chosen = selected ?? new Set(checkable.map((d) => d.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unconfirmed = merged.filter(
    (m) => m.state === "needs_confirmation" || m.state === "extracted",
  ).length;
  const running = review?.status === "running";

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await startComplianceCheck(projectId, [...chosen]);
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the check.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Run the check"
      subtitle={`Zoning & UDC, building & fire codes, civil standards, MEP, ADA/TAS, Texas state rules and plat conditions — ${AREAS.length} areas in one pass.`}
    >
      {checkable.length === 0 ? (
        <p className="text-sm text-muted-foreground">Upload PDF or DXF drawings first.</p>
      ) : (
        <>
          <fieldset className="grid gap-1.5">
            <legend className="mb-1 text-sm font-medium">Drawings to check</legend>
            {checkable.map((d) => (
              <label key={d.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={chosen.has(d.id)}
                  onChange={(e) => {
                    const n = new Set(chosen);
                    if (e.target.checked) n.add(d.id);
                    else n.delete(d.id);
                    setSelected(n);
                  }}
                />
                {d.name}
                <span className="text-xs text-muted-foreground">
                  · {disciplineLabel(d.discipline)}
                </span>
              </label>
            ))}
          </fieldset>
          {unconfirmed > 0 && (
            <p className="mt-3 flex items-start gap-1.5 text-xs text-[oklch(0.45_0.12_55)]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {unconfirmed} value{unconfirmed === 1 ? "" : "s"} not confirmed yet — issues that
              depend on them will be marked “needs confirmation”.
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn-accent"
              onClick={run}
              disabled={busy || running || chosen.size === 0}
            >
              {busy || running ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <ShieldCheck className="h-4 w-4" aria-hidden />
              )}
              {running ? "Checking…" : review ? "Run the check again" : "Run the check"}
            </button>
            {running && (
              <span className="text-sm text-muted-foreground">
                {review?.stage ?? "Working…"} This can take a few minutes.
              </span>
            )}
          </div>
        </>
      )}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      {review?.status === "failed" && (
        <p className="mt-3 text-sm text-destructive">
          The last check didn't finish: {review.error}
        </p>
      )}
      {review?.status === "done" && review.summary && (
        <div className="mt-4 grid gap-2 rounded-lg border border-border bg-secondary/30 p-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Checked {dateShort(review.finished_at ?? review.created_at)}
          </p>
          {review.summary.overview && <p>{review.summary.overview}</p>}
          {review.summary.codeBasis && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Codes assumed:</span>{" "}
              {review.summary.codeBasis}
            </p>
          )}
          {review.summary.missing && review.summary.missing.length > 0 && (
            <div className="text-xs">
              <p className="font-medium">Missing for a complete check:</p>
              <ul className="ml-4 list-disc text-muted-foreground">
                {review.summary.missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

// ── 5. issues ──────────────────────────────────────────────────────────────
function Issues({
  issues,
  loading,
  docs,
  consultants,
  refetch,
}: {
  issues: ComplianceIssue[];
  loading: boolean;
  docs: ComplianceDoc[];
  consultants: Consultant[];
  refetch: () => void;
}) {
  const [area, setArea] = useState<string>("all");
  const [showResolved, setShowResolved] = useState(false);
  const counts = issueCounts(issues);
  const visible = issues.filter(
    (i) =>
      (area === "all" || i.area === area) &&
      (showResolved || i.status === "open" || i.status === "in_progress"),
  );
  const groups = groupIssuesByDiscipline(visible);

  return (
    <Section
      title="Issues"
      subtitle={`${counts.open} open · ${counts.critical} critical/high · ${counts.resolved} resolved`}
      right={
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            aria-label="Area"
            className="rounded-md border border-input bg-background px-2 py-1"
            value={area}
            onChange={(e) => setArea(e.target.value)}
          >
            <option value="all">All areas</option>
            {AREAS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
            />{" "}
            Show resolved
          </label>
        </div>
      }
    >
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !issues.length ? (
        <p className="text-sm text-muted-foreground">No issues found in this check.</p>
      ) : !groups.length ? (
        <p className="text-sm text-muted-foreground">Nothing open here.</p>
      ) : (
        <div className="grid gap-5">
          {groups.map(({ discipline, issues: list }) => (
            <div key={discipline.id}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {discipline.label} · {list.length}
              </h3>
              <ul className="grid gap-2">
                {list.map((i) => (
                  <IssueCard
                    key={i.id}
                    issue={i}
                    docs={docs}
                    consultants={consultants}
                    refetch={refetch}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function IssueCard({
  issue: i,
  docs,
  consultants,
  refetch,
}: {
  issue: ComplianceIssue;
  docs: ComplianceDoc[];
  consultants: Consultant[];
  refetch: () => void;
}) {
  const doc = docs.find((d) => d.id === i.document_id);
  const set = async (patch: Parameters<typeof updateIssue>[1]) => {
    await updateIssue(i.id, patch);
    refetch();
  };
  return (
    <li className="min-w-0 break-words rounded-lg border border-border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={SEVERITY_TONE[i.severity]}>{i.severity}</Pill>
        <Pill tone="gray">{areaLabel(i.area)}</Pill>
        {i.needs_confirmation && <Pill tone="amber">Needs confirmation</Pill>}
        {i.confidence === "low" && <Pill tone="gray">Low confidence</Pill>}
      </div>
      <p className="mt-1.5 font-semibold">{i.title}</p>
      <dl className="mt-2 grid gap-1.5 text-sm sm:grid-cols-[120px_1fr]">
        {i.requirement && (
          <>
            <dt className="text-xs font-medium uppercase text-muted-foreground">Requirement</dt>
            <dd>
              {i.requirement}
              {i.code_reference && (
                <span className="block text-xs text-muted-foreground">
                  {i.code_reference}
                  {i.code_source === "ai" ? " — cited by Corvus AI, verify" : ""}
                </span>
              )}
            </dd>
          </>
        )}
        <dt className="text-xs font-medium uppercase text-muted-foreground">Where</dt>
        <dd>
          {[doc?.name, i.sheet && `Sheet ${i.sheet}`, i.location].filter(Boolean).join(" · ") ||
            "—"}
        </dd>
        {i.problem && (
          <>
            <dt className="text-xs font-medium uppercase text-muted-foreground">Problem</dt>
            <dd>{i.problem}</dd>
          </>
        )}
        {i.suggested_fix && (
          <>
            <dt className="text-xs font-medium uppercase text-muted-foreground">Suggested fix</dt>
            <dd>{i.suggested_fix}</dd>
          </>
        )}
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <label className="flex min-w-0 max-w-full items-center gap-1">
          <span className="text-muted-foreground">Assigned to</span>
          <select
            className="min-w-0 max-w-full rounded-md border border-input bg-background px-2 py-1"
            value={i.consultant_id ?? ""}
            onChange={(e) => set({ consultant_id: e.target.value || null })}
          >
            <option value="">Unassigned ({disciplineLabel(i.discipline)})</option>
            {consultants.map((c) => (
              <option key={c.id} value={c.id}>
                {consultantName(c)} — {disciplineLabel(c.discipline)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 max-w-full items-center gap-1">
          <span className="text-muted-foreground">Status</span>
          <select
            className="min-w-0 max-w-full rounded-md border border-input bg-background px-2 py-1"
            value={i.status}
            onChange={(e) => set({ status: e.target.value as IssueStatus })}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </li>
  );
}
