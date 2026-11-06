import { EvidenceFileRow, type EvidenceCategoryOption } from "@/components/EvidenceFileRow";
import { MarkUnavailable, UnavailableGuidancePanel } from "@/components/EvidenceUnavailable";
import { type ModuleResultMap } from "@/lib/ai-report-modules";
import { type DocumentRecord } from "@/lib/documents";
import { type UnavailableReason, type UnavailableRecord } from "@/lib/evidence-unavailable";
import { type IconColor } from "@/lib/icon-colors";
import { MODULES } from "@/lib/modules";
import { type DocumentStatus } from "@/lib/protest-reason";
import { CheckCircle2, ChevronDown, type LucideIcon } from "lucide-react";
import { DOCUMENT_STATUS_TONE, ZONING_STATUS } from "./helpers";

// Part of the AI report page (src/routes/ai-report.tsx), split out of that
// file unchanged. Group: bits.
export function Chip({ children, icon }: { children: React.ReactNode; icon?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary/60 px-3 py-1.5 text-xs font-medium">
      {icon && <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
      {children}
    </span>
  );
}

// Short icon-led fact row — for real, static/deterministic facts (a
// methodology or sources note), not AI prose. Turns what would otherwise be
// a paragraph into one scannable line.
export function FactBullet({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 flex items-start gap-2 text-xs text-muted-foreground">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

// Connected vertical checklist — replaces stuffing full-sentence AI
// checklist items into rounded-full Chip "pills" (a tag-shaped component
// asked to hold a paragraph, which just wraps into a bulky block). Each
// item still gets its real full text — the checklist can't be shortened
// without losing what it's telling the user to do — but reads as an actual
// step list instead of a wall of stacked pills.
export function ChecklistSteps({ items, color }: { items: string[]; color: IconColor }) {
  if (items.length === 0) return null;
  return (
    <div className="grid">
      {items.map((c, i) => (
        <div key={i} className="min-w-0 flex gap-3">
          <div className="flex shrink-0 flex-col items-center">
            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${color.bg}`}>
              <CheckCircle2 className={`h-4 w-4 ${color.text}`} />
            </span>
            {i < items.length - 1 && <div className="my-0.5 w-px flex-1 bg-border" />}
          </div>
          <p className="min-w-0 flex-1 pb-3 text-sm text-muted-foreground">{c}</p>
        </div>
      ))}
    </div>
  );
}

// One row of Module 8's evidence checklist — expandable to show real,
// AI-suggested document types that would satisfy this specific category
// (see MODULE_SPECS.evidence's documentSuggestions), each with its own
// scoped Upload button (tags the file with THIS category directly via
// evidenceItemSlug, no separate categorization pass needed — that's only
// for the generic bulk upload button, which doesn't know the category up
// front). Already-uploaded documents tagged to this category are listed
// too, so the user can see at a glance what's covered vs. still needed.
// Exported so CaseDetailModal's EvidenceChecklistPanel (View Case's inline
// Module 8 embed) can render the exact same per-item row — one real
// component, two places it shows up, instead of a second copy drifting.
export function EvidenceCategoryRow({
  it,
  uploadedDocs,
  categories,
  expanded,
  onToggleExpand,
  uploadingEvidence,
  onUploadEvidence,
  unavailable,
  onMarkUnavailable,
  onClearUnavailable,
}: {
  it: ModuleResultMap["evidence"]["items"][number];
  uploadedDocs: DocumentRecord[];
  categories: EvidenceCategoryOption[];
  expanded: boolean;
  onToggleExpand: () => void;
  uploadingEvidence: boolean;
  onUploadEvidence: (files: File[]) => void;
  // "Document not available" (see components/EvidenceUnavailable.tsx) — only
  // offered while the item is Missing; omitted where the owner can't edit.
  unavailable?: UnavailableRecord | null;
  onMarkUnavailable?: (reason: UnavailableReason, note: string) => Promise<void>;
  onClearUnavailable?: () => Promise<void>;
}) {
  // priority drives the tone now (only Critical is "blocking"); fall back to
  // the legacy importance/availability when a stale cache lacks it.
  const priority = it.priority ?? (it.importance === "High" ? "Important" : "Supporting");
  const status = it.status ?? (it.availability === "Low" ? "Missing" : "Found");
  const notAvailable = status === "Missing" && !!unavailable;
  const tone = notAvailable
    ? { bg: "bg-secondary/50", text: "text-muted-foreground" }
    : priority === "Critical" && status === "Missing"
      ? { bg: "bg-destructive/10", text: "text-destructive" }
      : status !== "Missing"
        ? { bg: "bg-success/10", text: "text-success" }
        : priority === "Important"
          ? { bg: "bg-warning/15", text: "text-warning-foreground" }
          : { bg: "bg-secondary/60", text: "text-muted-foreground" };
  const statusLabel = notAvailable
    ? "Not available"
    : status === "Verified"
      ? "Verified"
      : status === "Found"
        ? "Found — review"
        : "Missing";
  const statusTone = notAvailable
    ? "bg-foreground/10 text-foreground"
    : status === "Verified"
      ? "bg-success/15 text-success"
      : status === "Found"
        ? "bg-accent/15 text-accent"
        : "bg-secondary/60 text-muted-foreground";

  return (
    <div className={`min-w-0 rounded-lg ${tone.bg}`}>
      <button
        type="button"
        onClick={onToggleExpand}
        className="flex w-full min-w-0 items-center gap-2 p-3 text-left"
      >
        <span className={`shrink-0 text-[10px] font-bold uppercase ${tone.text}`}>{priority}</span>
        <span className="min-w-0 flex-1 text-sm">{it.item}</span>
        <span
          className={`shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${statusTone}`}
        >
          {statusLabel}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {expanded && (
        <div className="grid gap-2 border-t border-black/5 px-3 pb-3 pt-2.5">
          {it.category && (
            <span className="w-fit rounded-full bg-background/70 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
              {it.category}
            </span>
          )}
          {it.whyNeeded && (
            <p className="text-xs">
              <span className="font-semibold">Why it matters: </span>
              <span className="text-muted-foreground">{it.whyNeeded}</span>
            </p>
          )}
          {it.relatedModule &&
            (() => {
              const rm = MODULES.find((mm) => mm.id === it.relatedModule);
              return rm ? (
                <p className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">Supports: </span>
                  {rm.shortName}
                </p>
              ) : null;
            })()}
          {it.contributionNote && status !== "Missing" && (
            <p className="rounded-md bg-accent/5 p-1.5 text-xs text-accent">
              {it.contributionNote}
            </p>
          )}
          {it.verificationNote && (
            <p className="text-xs text-muted-foreground">
              {status !== "Missing" && it.foundIn ? (
                <>
                  <CheckCircle2 className="mr-1 inline h-3 w-3 text-success" />
                  <span className="font-medium text-foreground">{it.foundIn}: </span>
                </>
              ) : null}
              {it.verificationNote}
            </p>
          )}
          {uploadedDocs.length > 0 && (
            <ul className="grid gap-1.5 text-xs text-muted-foreground">
              {uploadedDocs.map((doc) => (
                <EvidenceFileRow key={doc.id} doc={doc} categories={categories} />
              ))}
            </ul>
          )}
          {notAvailable && unavailable && onMarkUnavailable && onClearUnavailable && (
            <UnavailableGuidancePanel
              record={unavailable}
              onRegenerate={() =>
                onMarkUnavailable(unavailable.reason, unavailable.reasonNote ?? "")
              }
              onClear={onClearUnavailable}
            />
          )}
          {notAvailable && it.documentSuggestions.length === 0 ? null : it.documentSuggestions
              .length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No specific document suggestions for this item — use the Upload Evidence section
              below.
            </p>
          ) : (
            it.documentSuggestions.map((s, i) => (
              <div
                key={i}
                className="rounded-md border border-border bg-background/70 p-2.5 text-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 font-semibold">{s.documentName}</span>
                  <label
                    className={`shrink-0 whitespace-nowrap text-accent hover:underline ${uploadingEvidence ? "pointer-events-none opacity-60" : "cursor-pointer"}`}
                  >
                    {uploadingEvidence
                      ? "Uploading…"
                      : uploadedDocs.length > 0
                        ? "Upload more →"
                        : "Upload →"}
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      multiple
                      className="hidden"
                      disabled={uploadingEvidence}
                      onChange={(e) => {
                        const selected = e.target.files ? Array.from(e.target.files) : [];
                        e.target.value = "";
                        if (selected.length > 0) onUploadEvidence(selected);
                      }}
                    />
                  </label>
                </div>
                {s.whatToInclude && <p className="mt-1 text-muted-foreground">{s.whatToInclude}</p>}
                {s.whereToObtain && (
                  <p className="mt-1 text-[10px] font-medium text-muted-foreground">
                    Where to get it: {s.whereToObtain}
                  </p>
                )}
              </div>
            ))
          )}
          {status === "Missing" && !unavailable && onMarkUnavailable && (
            <MarkUnavailable onSubmit={onMarkUnavailable} />
          )}
        </div>
      )}
    </div>
  );
}

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  return (
    <span
      className={`shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${DOCUMENT_STATUS_TONE[status]}`}
    >
      {status}
    </span>
  );
}

export function ZoningBadge({ matches }: { matches: keyof typeof ZONING_STATUS }) {
  const { Icon, color, bg, label } = ZONING_STATUS[matches];
  return (
    <div className={`min-w-0 flex items-center gap-3 rounded-lg p-4 ${bg}`}>
      <Icon className={`h-8 w-8 shrink-0 ${color}`} />
      <div className={`min-w-0 flex-1 font-serif text-lg font-semibold ${color}`}>{label}</div>
    </div>
  );
}

export function FactBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-secondary/60 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-sm">{value}</div>
    </div>
  );
}

export function ErrorWithRetry({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mt-4 grid gap-2">
      <p className="text-sm text-destructive">{message}</p>
      <button onClick={onRetry} className="btn-outline w-fit text-sm py-1.5">
        Retry
      </button>
    </div>
  );
}

export function Field({ label, value, bold }: { label: string; value?: string; bold?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`mt-1 ${bold ? "text-lg font-semibold" : ""}`}>{value ?? "—"}</dd>
    </div>
  );
}
