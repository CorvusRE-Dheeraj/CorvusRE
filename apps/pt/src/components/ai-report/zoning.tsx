import { type ModuleResultMap } from "@/lib/ai-report-modules";
import { type DocumentRecord } from "@/lib/documents";
import { ICON_COLORS } from "@/lib/icon-colors";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileText,
  RefreshCw,
  Scale,
  Upload,
} from "lucide-react";
import {
  ZONING_ASPECT_COLOR,
  ZONING_ASPECT_ICON,
  ZONING_ASPECT_STATUS,
  ZONING_STATUS,
} from "./helpers";

export function ZoningClassificationTable({
  aspects,
  matches,
  zoningDocs,
  onUpload,
  onFetchDetails,
  uploading,
  categorizing,
  fetching,
}: {
  aspects: ModuleResultMap["zoning"]["aspects"];
  matches: keyof typeof ZONING_STATUS;
  zoningDocs: DocumentRecord[];
  // One upload -> the AI reads each file and tags it to the aspect it
  // documents (see the zoning case's handleAutoUpload). Absent for a
  // signed-out / no-access viewer.
  onUpload?: (files: File[]) => void;
  // Re-pull this property's CAD record and update its classification-
  // relevant fields, then re-run the module.
  onFetchDetails?: () => void;
  uploading?: boolean;
  categorizing?: boolean;
  fetching?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] table-fixed text-left text-sm">
          <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {aspects.map((a) => (
                <th key={a.label} className="px-4 py-2.5 font-semibold">
                  {a.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border/60 align-top">
              {aspects.map((a) => {
                const st = ZONING_ASPECT_STATUS[a.status];
                const isPermitted = a.label === "Permitted Use";
                const showMismatch = isPermitted && matches === "inconsistent";
                const showMatch = isPermitted && matches === "consistent";
                return (
                  <td key={a.label} className="px-4 py-3">
                    <div className="flex items-start gap-1.5">
                      {showMismatch ? (
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                      ) : showMatch ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                      ) : (
                        <st.Icon className={`mt-0.5 h-4 w-4 shrink-0 ${st.iconCls}`} />
                      )}
                      <span
                        className={`font-medium ${showMismatch ? "text-destructive" : "text-foreground"}`}
                      >
                        {a.value || "—"}
                      </span>
                    </div>
                  </td>
                );
              })}
            </tr>
            <tr className="border-t border-border/40 align-top text-xs text-muted-foreground">
              {aspects.map((a) => (
                <td key={a.label} className="px-4 py-3">
                  {a.source || "—"}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {zoningDocs.length > 0 && (
        <div className="border-t border-border/60 px-4 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Documents in this section
          </div>
          <ul className="mt-1 grid gap-1">
            {zoningDocs.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">{doc.fileName}</span>
                <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {doc.documentType?.replace(/^Zoning:\s*/, "") || "Zoning"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(onUpload || onFetchDetails) && (
        <div className="flex flex-wrap items-center justify-center gap-2 border-t border-border/60 px-4 py-3">
          {onUpload && (
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-accent/50 bg-background px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/10">
              <input
                type="file"
                accept="image/*,.pdf"
                multiple
                disabled={uploading || categorizing}
                className="hidden"
                onChange={(e) => {
                  const sel = Array.from(e.target.files ?? []);
                  if (sel.length > 0) onUpload(sel);
                  e.target.value = "";
                }}
              />
              <Upload className="h-3.5 w-3.5" />
              {categorizing ? "Reading documents…" : uploading ? "Uploading…" : "Upload documents"}
            </label>
          )}
          {onFetchDetails && (
            <button
              type="button"
              onClick={onFetchDetails}
              disabled={fetching}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${fetching ? "animate-spin" : ""}`} />
              {fetching ? "Fetching…" : "Fetch details"}
            </button>
          )}
        </div>
      )}
      {(onUpload || onFetchDetails) && (
        <p className="px-4 pb-3 text-center text-[10px] text-muted-foreground">
          Upload a zoning letter, plat, deed, or use permit — the AI tags each to the right aspect.
          Fetch details re-pulls the county's classification for this property.
        </p>
      )}
    </div>
  );
}

// Compact card visual — the 4 classification aspects as small icon tiles,
// branching into a Matches / Mismatch outcome, then a "verify" call to
// action. Mirrors the spec's card screenshot in the app's own light styling.
export function ZoningAspectTiles({
  aspects,
  matches,
  onUpload,
  uploading,
}: {
  aspects: ModuleResultMap["zoning"]["aspects"];
  matches: keyof typeof ZONING_STATUS;
  // One upload for the whole card — tagged "Zoning: General"; the modal's
  // upload is where the AI sorts a file to a specific aspect.
  onUpload?: (files: File[]) => void;
  uploading?: boolean;
}) {
  const consistent = matches === "consistent";
  const uncertain = matches === "uncertain";
  const needsAny = aspects.some((a) => a.status === "Additional Data Needed");
  return (
    <div>
      <div className="grid grid-cols-4 gap-1.5">
        {aspects.map((a) => {
          const st = ZONING_ASPECT_STATUS[a.status];
          const Icon = ZONING_ASPECT_ICON[a.label] ?? FileText;
          const color = ZONING_ASPECT_COLOR[a.label] ?? ICON_COLORS[5];
          return (
            <div key={a.label} className="rounded-lg bg-secondary/50 p-2 text-center">
              <span
                className={`mx-auto grid h-6 w-6 place-items-center rounded-full ${color.bg} ${color.text}`}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="mt-1 text-[8px] uppercase leading-tight tracking-wide text-muted-foreground">
                {a.label}
              </div>
              <span
                className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[8px] font-semibold ${st.cls}`}
              >
                {st.label}
              </span>
            </div>
          );
        })}
      </div>

      {onUpload && needsAny && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the label wraps a focusable file <input>; the handlers only stop the click from bubbling to the card that opens the modal.
        <label
          className="mt-2 flex cursor-pointer items-center justify-center gap-1 rounded-md border border-accent/40 px-2.5 py-1 text-[11px] font-semibold text-accent hover:bg-accent/10"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <input
            type="file"
            accept="image/*,.pdf"
            multiple
            disabled={uploading}
            className="hidden"
            onChange={(e) => {
              const sel = Array.from(e.target.files ?? []);
              if (sel.length > 0) onUpload(sel);
              e.target.value = "";
            }}
          />
          <Upload className="h-3 w-3" />
          {uploading ? "Uploading…" : "Upload"}
        </label>
      )}

      <div className="mx-auto my-1.5 h-3 w-px bg-border" />
      <div className="grid grid-cols-2 gap-2 text-center">
        <div
          className={`rounded-lg border p-2 ${
            consistent
              ? "border-success/40 bg-success/10"
              : "border-border bg-secondary/30 opacity-50"
          }`}
        >
          <div className="flex items-center justify-center gap-1 text-xs font-bold text-success">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Matches
          </div>
          <div className="text-[10px] text-muted-foreground">No issue</div>
        </div>
        <div
          className={`rounded-lg border p-2 ${
            !consistent && !uncertain
              ? "border-destructive/40 bg-destructive/10"
              : "border-border bg-secondary/30 opacity-50"
          }`}
        >
          <div className="flex items-center justify-center gap-1 text-xs font-bold text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            Mismatch
          </div>
          <div className="text-[10px] text-muted-foreground">May impact value or exemptions</div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-accent/10 px-3 py-2 text-xs font-semibold text-accent">
        <Scale className="h-4 w-4 shrink-0" />
        Verify &amp; support any discrepancies
        <ArrowRight className="h-3.5 w-3.5 shrink-0" />
      </div>
    </div>
  );
}

export function ZoningImpactCol({
  title,
  tone = "success",
  children,
}: {
  title: string;
  tone?: "success" | "accent";
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div
        className={`mb-1.5 text-xs font-semibold uppercase tracking-wide ${
          tone === "accent" ? "text-accent" : "text-success"
        }`}
      >
        {title}
      </div>
      <div className="text-sm text-muted-foreground">{children}</div>
    </div>
  );
}
