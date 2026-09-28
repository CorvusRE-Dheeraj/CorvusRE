import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useActiveProjectBundle } from "@/hooks/use-project";
import { listReviewComments } from "@/lib/project-activity";
import {
  AVAILABILITY_LABEL,
  getStation,
  locateTrain,
  type Availability,
  type RouteColor,
  type Station,
  type TrainLocation,
} from "@/lib/train-track";

// Static class strings per route colour (Tailwind can only see literal class
// names, so these can't be built by string interpolation).
export const ROUTE_STYLE: Record<
  RouteColor,
  { solid: string; text: string; soft: string; border: string; chip: string }
> = {
  blue: {
    solid: "bg-blue-600",
    text: "text-blue-700",
    soft: "bg-blue-50",
    border: "border-blue-600",
    chip: "border-blue-200 bg-blue-50 text-blue-800",
  },
  purple: {
    solid: "bg-violet-600",
    text: "text-violet-700",
    soft: "bg-violet-50",
    border: "border-violet-600",
    chip: "border-violet-200 bg-violet-50 text-violet-800",
  },
  orange: {
    solid: "bg-orange-500",
    text: "text-orange-700",
    soft: "bg-orange-50",
    border: "border-orange-500",
    chip: "border-orange-200 bg-orange-50 text-orange-800",
  },
  teal: {
    solid: "bg-teal-600",
    text: "text-teal-700",
    soft: "bg-teal-50",
    border: "border-teal-600",
    chip: "border-teal-200 bg-teal-50 text-teal-800",
  },
  green: {
    solid: "bg-green-600",
    text: "text-green-700",
    soft: "bg-green-50",
    border: "border-green-600",
    chip: "border-green-200 bg-green-50 text-green-800",
  },
  red: {
    solid: "bg-red-500",
    text: "text-red-700",
    soft: "bg-red-50",
    border: "border-red-500",
    chip: "border-red-200 bg-red-50 text-red-800",
  },
  gray: {
    solid: "bg-slate-500",
    text: "text-slate-700",
    soft: "bg-slate-50",
    border: "border-slate-500",
    chip: "border-slate-200 bg-slate-50 text-slate-800",
  },
};

const AVAILABILITY_STYLE: Record<Availability, { dot: string; pill: string }> = {
  live: { dot: "bg-green-600", pill: "border-green-200 bg-green-50 text-green-800" },
  partial: { dot: "bg-amber-500", pill: "border-amber-200 bg-amber-50 text-amber-900" },
  planned: { dot: "bg-slate-400", pill: "border-slate-200 bg-slate-50 text-slate-700" },
  staff: { dot: "bg-blue-500", pill: "border-blue-200 bg-blue-50 text-blue-800" },
};

export function AvailabilityPill({ availability }: { availability: Availability }) {
  const s = AVAILABILITY_STYLE[availability];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        s.pill,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} aria-hidden />
      {AVAILABILITY_LABEL[availability]}
    </span>
  );
}

export function AvailabilityDot({ availability }: { availability: Availability }) {
  return (
    <span
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", AVAILABILITY_STYLE[availability].dot)}
      title={AVAILABILITY_LABEL[availability]}
      aria-label={AVAILABILITY_LABEL[availability]}
    />
  );
}

/** A small side-on locomotive in CorvusDP amber, facing the direction of travel. */
export function TrainIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 40" className={className} role="img" aria-label="Your project's train">
      <circle className="track-smoke" cx="47" cy="3" r="3" fill="#cbd5e1" />
      <rect x="44" y="5" width="7" height="9" rx="1.5" fill="#1e293b" />
      <rect x="22" y="12" width="36" height="16" rx="5" fill="#d97706" />
      <rect x="22" y="17" width="36" height="2.5" fill="#fbbf24" />
      <circle cx="58" cy="17" r="2.2" fill="#fef3c7" />
      <rect x="6" y="6" width="19" height="22" rx="3" fill="#1e3a5f" />
      <rect x="10" y="10" width="11" height="7" rx="1.5" fill="#e0f2fe" />
      <path d="M58 28 L64 34 L58 34 Z" fill="#1e293b" />
      <rect x="4" y="27" width="56" height="3" rx="1.5" fill="#1e293b" />
      {[14, 32, 48].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="33" r="5" fill="#1e293b" />
          <circle cx={cx} cy="33" r="1.8" fill="#e2e8f0" />
        </g>
      ))}
    </svg>
  );
}

/**
 * The active project plus everything the train's position depends on.
 * Review comments share the Reviews page's query key, so logging a comment
 * there moves the train here without a reload.
 */
export function useTrainTrack() {
  const { loading, hasProject, project, bundle, projectId } = useActiveProjectBundle();
  const comments = useQuery({
    queryKey: ["review-comments", projectId],
    queryFn: () => listReviewComments(projectId!),
    enabled: !!projectId,
  });

  const location: TrainLocation | null =
    hasProject && project
      ? locateTrain({
          hasAnalysis: !!project.analysis,
          permits: bundle?.permits ?? [],
          checklist: bundle?.checklist ?? [],
          comments: comments.data ?? [],
        })
      : null;

  return {
    loading: loading || (!!projectId && comments.isLoading),
    hasProject,
    project,
    bundle,
    comments: comments.data ?? [],
    location,
  };
}

// ---------------------------------------------------------------------------
// Opening a station in its own window

const WINDOW_NAME = "corvusdp-station";

export function stationUrl(n: number, view: "station" | "module" = "station"): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return `${base}/dashboard/track-station?n=${n}${view === "module" ? "&view=module" : ""}`;
}

/**
 * Opens (or reuses and refocuses) one named popup window for station details,
 * so clicking station after station doesn't pile up windows. Returns false if
 * the browser blocked the popup — the caller then shows the in-page dialog.
 */
export function openStationWindow(n: number, view: "station" | "module" = "station"): boolean {
  if (typeof window === "undefined") return false;
  const w = Math.min(920, window.screen.availWidth - 40);
  const h = Math.min(900, window.screen.availHeight - 60);
  const left = Math.max(0, window.screenX + window.outerWidth - w - 24);
  const top = Math.max(0, window.screenY + 40);
  const win = window.open(
    stationUrl(n, view),
    WINDOW_NAME,
    `popup=yes,width=${w},height=${h},left=${left},top=${top}`,
  );
  if (!win) return false;
  win.focus();
  return true;
}

// ---------------------------------------------------------------------------
// Station detail — rendered inside the popup window, and in the fallback
// dialog when popups are blocked.

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-4">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="grid gap-1.5 pl-4 text-sm text-muted-foreground [list-style:disc]">
      {items.map((x) => (
        <li key={x}>{x}</li>
      ))}
    </ul>
  );
}

export function StationDetail({
  station,
  view,
  location,
  onOpenStation,
  onGoToPage,
}: {
  station: Station;
  view: "station" | "module";
  location: TrainLocation | null;
  onOpenStation: (n: number, view: "station" | "module") => void;
  onGoToPage: (page: string) => void;
}) {
  const style = ROUTE_STYLE[station.color];
  const isHere = location?.station === station.n;
  const prev = getStation(station.n - 1);
  const next = getStation(station.n + 1);
  const pageLabel = PAGE_LABEL[station.page] ?? "Open page";

  return (
    <div className="grid gap-4">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold text-white",
            style.solid,
          )}
        >
          {station.n}
        </span>
        <div className="min-w-0">
          <h2 className="font-serif text-xl font-semibold leading-tight">
            {view === "module" ? station.module : station.title}
          </h2>
          <p className="mt-1 text-xs font-medium text-muted-foreground">
            {view === "module"
              ? `AI module for Station ${station.n}: ${station.title}`
              : `Station ${station.n} · ${station.group} · ${station.module}`}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <AvailabilityPill availability={station.availability} />
        {isHere && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-green-300 bg-green-50 px-2.5 py-0.5 text-xs font-semibold text-green-800">
            <TrainIcon className="h-3.5 w-5" /> Your project is here
          </span>
        )}
      </div>

      {isHere && location && (
        <p className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
          {location.reason}
        </p>
      )}

      <p className={cn("rounded-xl border px-4 py-3 text-sm leading-relaxed", style.chip)}>
        {station.purpose}
      </p>

      {station.availabilityNote && (
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">What's built today: </span>
          {station.availabilityNote}
        </p>
      )}

      {view === "module" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Box title="AI / system actions">
            <List items={station.actions} />
          </Box>
          <Box title="Outputs produced">
            <List items={station.outputs} />
          </Box>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Box title="Inputs / trigger">
            <List items={station.inputs} />
          </Box>
          <Box title="AI / system actions">
            <List items={station.actions} />
          </Box>
          <Box title="Display / outputs">
            <List items={station.outputs} />
          </Box>
          <Box title="Next step">
            <p className="text-sm text-muted-foreground">{station.next}</p>
            <h3 className="mb-1 mt-3 text-sm font-semibold">Related AI module</h3>
            <button
              type="button"
              onClick={() => onOpenStation(station.n, "module")}
              className="text-left text-sm font-medium text-accent underline-offset-2 hover:underline"
            >
              {station.module}
            </button>
          </Box>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <div className="flex gap-2">
          {view === "module" ? (
            <button type="button" className="btn-outline" onClick={() => onOpenStation(station.n, "station")}>
              <ArrowLeft className="h-4 w-4" aria-hidden /> Process station
            </button>
          ) : (
            <>
              {prev && (
                <button type="button" className="btn-outline" onClick={() => onOpenStation(prev.n, "station")}>
                  <ArrowLeft className="h-4 w-4" aria-hidden /> Station {prev.n}
                </button>
              )}
              {next && (
                <button type="button" className="btn-outline" onClick={() => onOpenStation(next.n, "station")}>
                  Station {next.n} <ArrowRight className="h-4 w-4" aria-hidden />
                </button>
              )}
            </>
          )}
        </div>
        <button type="button" className="btn-accent" onClick={() => onGoToPage(station.page)}>
          {pageLabel} <ExternalLink className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

const PAGE_LABEL: Record<string, string> = {
  "/dashboard": "Go to Overview",
  "/dashboard/permits": "Go to Permits",
  "/dashboard/roadmap": "Go to Roadmap",
  "/dashboard/documents": "Go to Documents",
  "/dashboard/city": "Go to City",
  "/dashboard/checklist": "Go to Checklist",
  "/dashboard/constraints": "Go to Site Data",
  "/dashboard/notifications": "Go to Alerts",
  "/dashboard/fees": "Go to Fees",
  "/dashboard/prepare": "Go to Prepare",
  "/dashboard/reviews": "Go to Reviews",
  "/dashboard/timeline": "Go to Timeline",
  "/dashboard/approvals": "Go to Approvals",
};
