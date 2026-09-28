import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type CSSProperties } from "react";
import { Check, LocateFixed, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyProject, Loading, Pill, humanize, permitStatusTone } from "@/components/dp-ui";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  AvailabilityDot,
  ROUTE_STYLE,
  StationDetail,
  TrainIcon,
  openStationWindow,
  useTrainTrack,
} from "@/components/train-track";
import { TrainJourney } from "@/components/train-journey";
import {
  AVAILABILITY_LABEL,
  PARALLEL_STOPS,
  ROUTES,
  getStation,
  parallelTrackStop,
  wagonCargo,
  type Availability,
  type Station,
  type TrainLocation,
} from "@/lib/train-track";
import type { PermitRow } from "@/lib/projects";

export const Route = createFileRoute("/dashboard/_layout/track-map")({
  head: () => ({ meta: [{ title: "Permitting Train-Track Map — CorvusDP" }] }),
  component: TrackMap,
});

type Filter = "all" | "stations" | "modules";

function TrackMap() {
  const navigate = useNavigate();
  const { loading, hasProject, project, bundle, comments, location } = useTrainTrack();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  // Only used when the browser blocks the popup window.
  const [fallback, setFallback] = useState<{ n: number; view: "station" | "module" } | null>(null);

  if (loading) return <Loading />;
  if (!hasProject || !project) return <EmptyProject />;

  const open = (n: number, view: "station" | "module" = "station") => {
    if (!openStationWindow(n, view)) setFallback({ n, view });
  };

  const here = location ? getStation(location.station) : undefined;
  const wagons = location
    ? wagonCargo({
        trainAt: location.station,
        analysis: project.analysis,
        permits: bundle?.permits ?? [],
        checklist: bundle?.checklist ?? [],
        comments,
      })
    : [];
  const q = query.trim().toLowerCase();
  const matches = (s: Station, text: string) =>
    !q || text.toLowerCase().includes(q) || String(s.n) === q;

  const jumpToTrain = () => {
    document.getElementById("track-train")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="grid gap-5">
      <header className="card-elev p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="grid h-16 w-24 shrink-0 place-items-center rounded-2xl border border-border bg-gradient-to-br from-amber-50 to-white">
              <TrainIcon className="h-9 w-14" />
            </div>
            <div>
              <h1 className="font-serif text-2xl font-semibold leading-tight">
                Permitting Train-Track Map
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Every permitting step as a station. Click one to open its purpose, inputs, AI actions,
                outputs and next step in a separate window.
              </p>
            </div>
          </div>
          {here && location && <CurrentLocation station={here} location={location} onOpen={open} />}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-muted/40 px-4 py-3 text-xs font-semibold">
          {ROUTES.map((r) => (
            <span key={r.name} className="flex items-center gap-2">
              <span className={cn("h-3 w-3 rounded-full", ROUTE_STYLE[r.color].solid)} aria-hidden />
              {r.name}
            </span>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-xs text-muted-foreground">
          {(Object.keys(AVAILABILITY_LABEL) as Availability[]).map((a) => (
            <span key={a} className="flex items-center gap-1.5">
              <AvailabilityDot availability={a} />
              {AVAILABILITY_LABEL[a]}
            </span>
          ))}
        </div>
      </header>

      {location && <TrainJourney location={location} wagons={wagons} onOpenStation={open} />}

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-full border border-border bg-card p-1" role="group" aria-label="Show">
          {(
            [
              ["all", "Show all"],
              ["stations", "Process stations"],
              ["modules", "AI modules"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors",
                filter === value ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="btn-outline" onClick={jumpToTrain}>
          <LocateFixed className="h-4 w-4" aria-hidden /> Find my train
        </button>
        <label className="relative ml-auto w-full sm:w-72">
          <span className="sr-only">Search stations or AI modules</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search station or AI module…"
            className="w-full rounded-full border border-input bg-background py-2 pl-9 pr-3 text-sm"
          />
        </label>
      </div>

      {ROUTES.map((route) => {
        const style = ROUTE_STYLE[route.color];
        const stations = route.stations.map((n) => getStation(n)!);
        const shownStations = stations.filter((s) => matches(s, `${s.title} ${s.purpose} ${s.module}`));
        const shownModules = stations.filter((s) => matches(s, s.module));
        const showStations = filter !== "modules" && shownStations.length > 0;
        const showModules = filter !== "stations" && shownModules.length > 0;
        if (!showStations && !showModules) return null;

        return (
          <section key={route.name} className="relative mt-3 rounded-2xl border border-border bg-card px-4 pb-5 pt-8 sm:px-5">
            <h2
              className={cn(
                "absolute -top-3.5 left-4 rounded-full px-4 py-1.5 text-sm font-bold text-white shadow-sm",
                style.solid,
              )}
            >
              {route.name}
            </h2>

            {showStations && (
              // One row per route on wide screens (like a single line of
              // track); narrower screens wrap, and the rail through each slot
              // keeps every row reading as track. Min 4 columns so the
              // one-station Submission route doesn't stretch into a banner.
              <ol
                className="grid gap-x-4 gap-y-4 [grid-template-columns:repeat(auto-fill,minmax(160px,1fr))] xl:[grid-template-columns:repeat(var(--cols),minmax(0,1fr))]"
                style={{ "--cols": Math.max(route.stations.length, 4) } as CSSProperties}
              >
                {shownStations.map((s) => (
                  <StationSlot
                    key={s.n}
                    station={s}
                    state={
                      !location
                        ? "ahead"
                        : s.n === location.station
                          ? "current"
                          : s.n < location.station
                            ? "passed"
                            : "ahead"
                    }
                    onOpen={open}
                  />
                ))}
              </ol>
            )}

            {route.color === "teal" && filter !== "modules" && !q && (
              <ParallelTracks permits={bundle?.permits ?? []} />
            )}

            {showModules && (
              <div className={cn("flex flex-wrap gap-2", showStations && "mt-4")}>
                {shownModules.map((s) => (
                  <button
                    key={s.n}
                    type="button"
                    onClick={() => open(s.n, "module")}
                    className="inline-flex items-center gap-2 rounded-full border-2 border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-100"
                  >
                    <span className="rounded-md bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-amber-950">
                      AI
                    </span>
                    {s.module}
                    <AvailabilityDot availability={s.availability} />
                  </button>
                ))}
              </div>
            )}

            {route.color === "green" && !q && (
              <p className="mt-4 rounded-full border-2 border-dashed border-red-300 bg-red-50 px-4 py-2 text-center text-sm font-semibold text-red-800">
                Loop: comments assigned to design team → compliance check → resubmit to city
              </p>
            )}
            {route.color === "gray" && !q && (
              <p className="mt-4 rounded-full border border-green-200 bg-green-50 px-4 py-2 text-center text-sm font-semibold text-green-800">
                Outcome: faster submissions · clearer accountability · central permit review visibility ·
                reduced permit aging risk
              </p>
            )}
          </section>
        );
      })}

      <Dialog open={!!fallback} onOpenChange={(o) => !o && setFallback(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogTitle className="sr-only">Station details</DialogTitle>
          {fallback && (
            <>
              <p className="text-xs text-muted-foreground">
                Your browser blocked the separate window, so the station is shown here instead.
              </p>
              <StationDetail
                station={getStation(fallback.n)!}
                view={fallback.view}
                location={location}
                onOpenStation={(n, view) => setFallback({ n, view })}
                onGoToPage={(page) => {
                  setFallback(null);
                  void navigate({ to: page });
                }}
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CurrentLocation({
  station,
  location,
  onOpen,
}: {
  station: Station;
  location: TrainLocation;
  onOpen: (n: number) => void;
}) {
  return (
    <div className="w-full max-w-sm rounded-2xl border-2 border-green-500 bg-green-50 p-4">
      <div className="text-xs font-bold uppercase tracking-wide text-green-700">Your train is at</div>
      <div className="mt-1 font-semibold text-green-950">
        Station {station.n} · {station.title}
      </div>
      <p className="mt-1 text-sm text-green-900">{location.reason}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-accent" onClick={() => onOpen(station.n)}>
          Open station
        </button>
        <Link to={station.page} className="btn-outline">
          Work on it
        </Link>
      </div>
    </div>
  );
}

function StationSlot({
  station,
  state,
  onOpen,
}: {
  station: Station;
  state: "passed" | "current" | "ahead";
  onOpen: (n: number) => void;
}) {
  const style = ROUTE_STYLE[station.color];
  return (
    <li className="relative pt-11">
      <span className="track-rail" aria-hidden />
      <span
        className={cn(
          "absolute left-2 top-2.5 z-10 grid h-8 w-8 place-items-center rounded-full border-[3px] border-white text-xs font-bold text-white shadow",
          state === "passed" ? "bg-green-600" : style.solid,
        )}
        aria-hidden
      >
        {state === "passed" ? <Check className="h-4 w-4" /> : station.n}
      </span>
      {state === "current" && (
        <span id="track-train" className="track-train absolute left-1/2 top-[-0.35rem] z-20 -translate-x-1/2">
          <TrainIcon className="h-9 w-14 drop-shadow" />
        </span>
      )}
      <button
        type="button"
        onClick={() => onOpen(station.n)}
        aria-label={`Station ${station.n}: ${station.title}${state === "current" ? " — your project is here" : ""}. Opens details in a new window.`}
        className={cn(
          "flex h-full w-full flex-col rounded-2xl border-2 bg-card p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-md",
          style.border,
          state === "current" && "bg-green-50 ring-4 ring-green-500/25",
          state === "passed" && "opacity-75",
        )}
      >
        <span className="text-[13px] font-semibold leading-snug">{station.title}</span>
        <span className="mt-1 line-clamp-3 text-xs text-muted-foreground">{station.purpose}</span>
        <span className="mt-auto flex items-center gap-1.5 pt-3">
          <span
            className={cn(
              "min-w-0 flex-1 truncate rounded-full border bg-card px-2 py-1 text-center text-[10px] font-bold",
              style.border,
              style.text,
            )}
          >
            {station.module}
          </span>
          <AvailabilityDot availability={station.availability} />
        </span>
      </button>
    </li>
  );
}

// Each permit is its own parallel line once it's filed. Stops come straight
// from the permit's real status.
function ParallelTracks({ permits }: { permits: PermitRow[] }) {
  if (permits.length === 0) return null;
  return (
    <div className="mt-5 rounded-2xl border border-border bg-muted/30 p-4">
      <h3 className="text-sm font-semibold">Parallel permit tracks</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Each permit runs on its own line after it's filed.
      </p>
      <div className="mt-3 grid gap-3">
        {permits.map((p) => {
          const stop = parallelTrackStop(p.status);
          return (
            <div key={p.id} className="grid items-center gap-2 md:grid-cols-[220px_1fr]">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium" title={p.name}>
                  {p.name}
                </span>
                <Pill tone={permitStatusTone(p.status)}>{humanize(p.status)}</Pill>
              </div>
              {stop < 0 ? (
                <p className="text-xs text-muted-foreground">Not filed yet — still being prepared.</p>
              ) : (
                <ol className="relative grid grid-cols-4 gap-2">
                  <span className="absolute left-2 right-2 top-1/2 h-1 -translate-y-1/2 rounded-full bg-slate-200" aria-hidden />
                  {PARALLEL_STOPS.map((label, i) => (
                    <li
                      key={label}
                      className={cn(
                        "relative rounded-full border-2 px-2 py-1 text-center text-[11px] font-semibold",
                        i < stop && "border-green-600 bg-green-50 text-green-800",
                        i === stop && "border-teal-600 bg-teal-600 text-white",
                        i > stop && "border-slate-200 bg-card text-muted-foreground",
                      )}
                    >
                      {label}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
