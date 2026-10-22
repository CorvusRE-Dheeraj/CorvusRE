import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Fragment, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { Check, ChevronDown, LocateFixed, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyProject, Loading, Pill, humanize, permitStatusTone } from "@/components/dp-ui";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  AvailabilityDot,
  ROUTE_STYLE,
  StationDetail,
  TrainIcon,
  TrainWithCars,
  openStationWindow,
  useTrainTrack,
} from "@/components/train-track";
import { TrainJourney } from "@/components/train-journey";
import {
  AVAILABILITY_LABEL,
  PARALLEL_STOPS,
  ROUTES,
  STATIONS,
  getStation,
  parallelTrackStop,
  wagonCargo,
  type Availability,
  type RouteColor,
  type Station,
  type TrainLocation,
  type Wagon,
} from "@/lib/train-track";
import type { PermitRow } from "@/lib/projects";

export const Route = createFileRoute("/dashboard/_layout/track-map")({
  head: () => ({ meta: [{ title: "Permitting Train-Track Map — CorvusDP" }] }),
  component: TrackMap,
});

type Filter = "all" | "stations" | "modules";

const LAST_STATION = STATIONS[STATIONS.length - 1].n;

function TrackMap() {
  const navigate = useNavigate();
  const { loading, hasProject, project, bundle, comments, location } = useTrainTrack();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  // Only used when the browser blocks the popup window.
  const [fallback, setFallback] = useState<{ n: number; view: "station" | "module" } | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  useTrackLight(mapRef, `${loading}|${filter}|${query}|${location?.station ?? ""}`);

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
    <div ref={mapRef} className="grid gap-5">
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
        const stations = route.stations.map((n) => getStation(n)!);
        const shownStations = stations.filter((s) => matches(s, `${s.title} ${s.purpose} ${s.module}`));
        const shownModules = stations.filter((s) => matches(s, s.module));
        const showStations = filter !== "modules" && shownStations.length > 0;
        const showModules = filter !== "stations" && shownModules.length > 0;
        return { route, shownStations, shownModules, showStations, showModules };
      })
        .filter((r) => r.showStations || r.showModules)
        .map(({ route, shownStations, shownModules, showStations, showModules }, i, shown) => {
        const style = ROUTE_STYLE[route.color];
        const next = shown[i + 1];

        return (
          <Fragment key={route.name}>
            <section
              className={cn(
                "relative rounded-2xl border border-border bg-card px-4 pb-5 pt-8 sm:px-5",
                // Keeps the 2.5rem section spacing the old in-flow connector gave.
                i > 0 && "mt-5",
              )}
            >
              <h2
                className={cn(
                  "absolute -top-3.5 left-4 z-10 rounded-full px-4 py-1.5 text-sm font-bold text-white shadow-sm",
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
                  {shownStations.map((s, j) => (
                    <StationSlot
                      key={s.n}
                      station={s}
                      projectId={project.id}
                      wagons={wagons}
                      boardDelay={
                        route.color === "gray" && location?.station === LAST_STATION && s.n < LAST_STATION
                          ? j * 70
                          : undefined
                      }
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

              {next && (
                <RouteConnector color={next.route.color} />
              )}
            </section>
          </Fragment>
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

// Bridges the gap between one route section and the next so the whole page
// reads as one continuous line, not a separate disconnected track per route
// card. Rendered inside the section above. The whole route is the same 14px
// track as .track-rail (.track-link is that rail turned vertical), wrapped
// around the OUTSIDE of the box:
//   the top rail — extended with .track-rail when its first row stops short —
//   rounds a radius-24 curve out past the right border, runs down outside it
//   (centreline 9px past the border, inside the page's side padding), rounds
//   into a lower track along the middle of the gap between the boxes, back to
//   the left, where one semicircle outside the left border (radius = half the
//   drop from the gap track to the next rail) brings it into the next
//   section's rail.
// Positions are measured from the real rails, borders and gap (this app's rem
// is 18px, and rows wrap), and the route is drawn as ONE path, so it meets the
// rails exactly and has no internal joins: no gaps, and no overlaps to show as
// darker seams at the 0.85 opacity. Card-coloured patches hide the straight
// rails under the curves' ends.
// Nothing here takes layout space. z-[5] paints it over the next section's
// background but under the route badge and station dots (z-10) and the train
// (z-20). Arrow is coloured to the route it leads into.
type ConnectorGeom = {
  w: number; // section padding-box width; all values are px from its top-left
  ry: number | null; // top rail centreline
  railEnd: number; // right end of the top rail's first row
  gy: number; // middle of the gap below the section
  ny: number | null; // next section's rail centreline
  nTop: number; // next section's top edge
};

const CURVE = 24; // radius of the right-hand corners
const OUT = 9; // outside track centreline, px past the box border
const LIGHT = 64; // length of the travelling light, px (rails' blob = connectors' dash)
const LIGHT_SPEED = 170; // px per second, the same everywhere on the line
const LIGHT_MIN_PERIOD = 7; // s between lights passing any one point, at least

function RouteConnector({ color }: { color: RouteColor }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [g, setG] = useState<ConnectorGeom | null>(null);
  useEffect(() => {
    const section = ref.current?.parentElement;
    const next = section?.nextElementSibling;
    if (!section || !next) return;
    const firstRail = (el: Element) => {
      const rails = [...el.querySelectorAll(":scope > ol > li > .track-rail")].map((r) => r.getBoundingClientRect());
      return rails.filter((r) => Math.abs(r.top - rails[0].top) < 1);
    };
    const measure = () => {
      const box = section.getBoundingClientRect();
      const ox = box.left + section.clientLeft;
      const oy = box.top + section.clientTop;
      const nb = next.getBoundingClientRect();
      const top = firstRail(section);
      const [nr] = firstRail(next);
      const geom: ConnectorGeom = {
        w: section.clientWidth,
        ry: top.length ? top[0].top + 7 - oy : null,
        railEnd: top.length ? Math.max(...top.map((r) => r.right)) - ox : 0,
        gy: (box.bottom + nb.top) / 2 - oy,
        ny: nr ? nr.top + 7 - oy : null,
        nTop: nb.top - oy,
      };
      setG((prev) => (JSON.stringify(prev) === JSON.stringify(geom) ? prev : geom));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(section);
    ro.observe(next);
    return () => ro.disconnect();
  });

  if (!g) return <span ref={ref} className="hidden" aria-hidden />;

  // Centrelines of the outside verticals, past the right / left borders.
  const xr = g.w + 1 + OUT;
  const xl = -1 - OUT;
  const curveStart = xr - CURVE;
  const start = g.ry != null ? Math.min(g.railEnd, curveStart) : null;
  const half = g.ny != null ? (g.ny - g.gy) / 2 : 14; // left turn radius
  const gapLeft = xl + half;

  // The route as one path, offset `d` px to the left of travel: d = 0 is the
  // centreline, ±5.5 the two rails. Lines shift sideways; arcs that turn right
  // (cw) grow by d, the left-hand semicircle (ccw) shrinks by d.
  const route = (d: number) => {
    const p: string[] = [];
    if (g.ry != null && start != null) {
      const c1y = g.ry + CURVE;
      const c2y = g.gy - CURVE;
      const R = CURVE + d;
      p.push(`M${start} ${g.ry - d}`, `H${curveStart}`);
      p.push(`A${R} ${R} 0 0 1 ${curveStart + R} ${c1y}`, `V${c2y}`);
      p.push(`A${R} ${R} 0 0 1 ${curveStart} ${c2y + R}`);
    } else {
      p.push(`M${g.w} ${g.gy + d}`);
    }
    p.push(`H${gapLeft}`);
    const r = half - d;
    const cy = g.gy + half;
    p.push(`A${r} ${r} 0 0 0 ${gapLeft - r} ${cy}`);
    if (g.ny != null) p.push(`A${r} ${r} 0 0 0 ${gapLeft} ${cy + r}`);
    else p.push(`V${g.nTop}`);
    return p.join("");
  };

  return (
    <span
      ref={ref}
      className="pointer-events-none absolute inset-0 z-[5]"
      aria-hidden
      // Where this connector leaves the top rail and where it joins the next
      // section's rail, for useTrackLight's timing.
      data-light-start={start ?? ""}
      data-light-entry={gapLeft}
    >
      {/* Hide the straight rails where the route's curves take over from them:
          the top rail's tail past the curve start, the next rail's head. */}
      {g.ry != null && g.railEnd > curveStart && (
        <span className="absolute h-[14px] bg-card" style={{ left: curveStart, width: g.w - curveStart, top: g.ry - 7 }} />
      )}
      {g.ny != null && <span className="absolute left-0 h-[14px] bg-card" style={{ width: gapLeft, top: g.ny - 7 }} />}
      {/* Same track as .track-rail: 14px wide; 3px #b9c4ce sleepers every
          14px (dashes along the centreline); 3px #566777 rails 5.5px either
          side of it; the whole group at 0.85 opacity. */}
      <svg className="absolute left-0 top-0 overflow-visible" width="1" height="1">
        <g opacity="0.85" fill="none">
          <path d={route(0)} stroke="#b9c4ce" strokeWidth="14" strokeDasharray="3 11" />
          <path d={route(5.5) + route(-5.5)} stroke="#566777" strokeWidth="3" />
        </g>
        {/* The travelling light (useTrackLight): a short dash on the same
            centreline, parked before the path's start until animated. A wide
            soft dash plus a shorter bright core matches the rails' gradient. */}
        <g className="track-light-path" opacity="0.85" fill="none" strokeWidth="14">
          <path
            className="track-light-dash"
            d={route(0)}
            stroke="#bbf7d0"
            strokeOpacity="0.5"
            strokeDasharray={`${LIGHT} 100000`}
            strokeDashoffset={LIGHT}
            data-dash={LIGHT}
          />
          <path
            className="track-light-dash"
            d={route(0)}
            stroke="#f0fdf4"
            strokeOpacity="0.7"
            strokeDasharray={`${LIGHT / 2} 100000`}
            strokeDashoffset={LIGHT}
            data-dash={LIGHT / 2}
          />
        </g>
      </svg>
      {g.ry != null && (
        <ChevronDown
          className={cn("absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-card", ROUTE_STYLE[color].text)}
          style={{ left: xr, top: (g.ry + g.gy) / 2 }}
        />
      )}
    </span>
  );
}

// A soft light that travels the whole line at one constant speed: along each
// section's rails (a blob inside each .track-rail's .track-light, clipped to
// its slot so neighbours meet without overlapping), then round that section's
// RouteConnector (a dash on the connector's own centreline path), into the
// next section's rail — on the existing geometry, never a path of its own.
// Rails in later rows of a wrapped section light in step with the first row.
//
// Every piece is one native Web Animation with a shared startTime of 0, so all
// pieces run on one clock with no JS per frame: each piece's delay is simply
// when the light reaches it. Rails animate transform only (compositor); a
// connector's dash moves only while the light is on it and holds still
// otherwise. A light enters the line every `period` seconds, which is just
// long enough for the longest piece, so each piece shows one light at a time.
// Timings are measured once per layout — after a debounced resize, or when
// the filter / search / train change what's shown — never per frame.
// Off entirely under prefers-reduced-motion (CSS also hides the pieces).
function useTrackLight(ref: RefObject<HTMLElement | null>, layoutKey: string) {
  useEffect(() => {
    const root = ref.current;
    if (!root || !root.animate || typeof ResizeObserver === "undefined") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let anims: Animation[] = [];
    let timer = 0;

    const stop = () => {
      for (const a of anims) a.cancel();
      anims = [];
    };

    const start = () => {
      stop();
      if (reduce.matches) return;
      type Piece = {
        el: Element;
        t0: number; // s: when the light's centre is at the piece's start
        travel: number; // s: how long the light takes to cross the piece
        from: Keyframe;
        to: Keyframe;
      };
      const pieces: Piece[] = [];
      let s = 0; // px along the line at this section's entry point
      let entry: number | null = null; // that entry point's x in section px

      for (const section of root.querySelectorAll<HTMLElement>(":scope > section")) {
        const box = section.getBoundingClientRect();
        const ox = box.left + section.clientLeft;
        const slots = [
          ...section.querySelectorAll<HTMLElement>(":scope > ol > li > .track-rail > .track-light"),
        ].map((slot) => {
          const r = slot.getBoundingClientRect();
          return { blob: slot.firstElementChild, a: r.left - ox, w: r.width };
        });
        const enter = entry ?? (slots.length ? Math.min(...slots.map((x) => x.a)) : 0);

        // The blob's centre starts LIGHT/2 before the slot (fully hidden) and
        // leaves LIGHT/2 past its end.
        for (const { blob, a, w } of slots) {
          if (!blob) continue;
          pieces.push({
            el: blob,
            t0: (s + a - LIGHT / 2 - enter) / LIGHT_SPEED,
            travel: (w + LIGHT) / LIGHT_SPEED,
            from: { transform: `translateX(${-LIGHT}px)` },
            to: { transform: `translateX(${w}px)` },
          });
        }

        const conn = section.querySelector<HTMLElement>(":scope > [data-light-entry]");
        const dashes = conn
          ? [...conn.querySelectorAll<SVGPathElement>("path.track-light-dash")]
          : [];
        if (!conn || !dashes.length) break; // last section, or not measured yet
        const startX = conn.dataset.lightStart;
        const exit = startX ? s + Number(startX) - enter : s; // px where it leaves the rail
        const len = dashes[0].getTotalLength();
        for (const dash of dashes) {
          // Dash centred at distance x along the path: offset = d/2 - x.
          const d = Number(dash.dataset.dash);
          pieces.push({
            el: dash,
            t0: (exit - LIGHT / 2) / LIGHT_SPEED,
            travel: (len + LIGHT) / LIGHT_SPEED,
            from: { strokeDashoffset: `${d / 2 + LIGHT / 2}px` },
            to: { strokeDashoffset: `${d / 2 - LIGHT / 2 - len}px` },
          });
        }
        s = exit + len;
        entry = Number(conn.dataset.lightEntry);
      }
      if (!pieces.length) return;

      const period = Math.max(LIGHT_MIN_PERIOD, ...pieces.map((p) => p.travel + 0.25));
      for (const p of pieces) {
        const anim = p.el.animate(
          [
            { ...p.from, offset: 0 },
            { ...p.to, offset: p.travel / period },
            { ...p.to, offset: 1 },
          ],
          {
            duration: period * 1000,
            // Negative, so every piece is already mid-cycle at the right phase.
            delay: ((((p.t0 % period) + period) % period) - period) * 1000,
            iterations: Infinity,
            easing: "linear",
          },
        );
        anim.startTime = 0;
        anims.push(anim);
      }
    };

    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(start, 150);
    };
    // Fires once on observe, then only when the map's size really changes;
    // the delay lets RouteConnector re-measure and re-render first.
    const ro = new ResizeObserver(schedule);
    ro.observe(root);
    reduce.addEventListener("change", schedule);
    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
      reduce.removeEventListener("change", schedule);
      stop();
    };
  }, [ref, layoutKey]);
}

// The first time this browser sees a project's line complete (the train at
// the last station, i.e. every permit approved), the outcome card shimmers
// once. Remembered per project, so revisits and re-renders never replay it;
// if storage is blocked it can only replay on a fresh mount of the page.
function useCompletionShimmer(done: boolean, projectId: string) {
  const [play, setPlay] = useState(false);
  useEffect(() => {
    if (!done) return;
    const key = `corvusdp.trackMap.completed.${projectId}`;
    try {
      if (window.localStorage.getItem(key)) return;
      window.localStorage.setItem(key, "1");
    } catch {
      // Storage unavailable: fall through and play for this mount only.
    }
    setPlay(true);
  }, [done, projectId]);
  return done && play;
}

// Approval / Clearance / Expiry only: once the line is complete, each finished
// station box plays once — it glides into the train at the last station, then
// fades back into place. Purely visual.
function useBoardTrain(ref: RefObject<HTMLElement | null>, delay: number | undefined) {
  useEffect(() => {
    const el = ref.current;
    const train = document.getElementById("track-train");
    if (delay === undefined || !el || !train || !el.animate) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const from = el.getBoundingClientRect();
    const to = train.getBoundingClientRect();
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const opacity = getComputedStyle(el).opacity;
    const anim = el.animate(
      [
        { transform: "none", opacity, offset: 0 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.2)`, opacity: 0, offset: 0.65 },
        { transform: "none", opacity: 0, offset: 0.66 },
        { transform: "none", opacity, offset: 1 },
      ],
      { duration: 900, delay, easing: "ease-in-out" },
    );
    return () => anim.cancel();
  }, [ref, delay]);
}

function StationSlot({
  station,
  projectId,
  state,
  onOpen,
  boardDelay,
  wagons,
}: {
  station: Station;
  projectId: string;
  wagons: Wagon[];
  state: "passed" | "current" | "ahead";
  onOpen: (n: number) => void;
  boardDelay?: number;
}) {
  const style = ROUTE_STYLE[station.color];
  const cardRef = useRef<HTMLButtonElement>(null);
  useBoardTrain(cardRef, boardDelay);
  // The train only reaches the last station once every permit is approved.
  const complete = station.n === LAST_STATION && state === "current";
  const shimmer = useCompletionShimmer(complete, projectId);
  return (
    <li className="relative pt-11">
      <span className="track-rail" aria-hidden>
        {/* useTrackLight's blob for this slot's stretch of rail. */}
        <span className="track-light">
          <span />
        </span>
      </span>
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
        // scale-[1.18] enlarges locomotive + wagons together; origin-bottom
        // keeps the wheels on the rail and the train centred over the station.
        <span
          id="track-train"
          className="track-train absolute left-1/2 top-[-0.35rem] z-20 origin-bottom -translate-x-1/2 scale-[1.18]"
        >
          <TrainWithCars wagons={wagons} />
        </span>
      )}
      <button
        ref={cardRef}
        type="button"
        onClick={() => onOpen(station.n)}
        aria-label={`Station ${station.n}: ${station.title}${state === "current" ? " — your project is here" : ""}. Opens details in a new window.`}
        className={cn(
          "flex h-full w-full flex-col rounded-2xl border-2 bg-card p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-md",
          style.border,
          state === "current" && "bg-green-50 ring-4 ring-green-500/25",
          state === "passed" && "opacity-75",
          complete && "track-outcome-done",
          shimmer && "track-outcome-shimmer",
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
          {/* Only working stations signal; a planned one stays still. */}
          <AvailabilityDot
            availability={station.availability}
            className={station.availability !== "planned" ? "track-status" : undefined}
          />
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
