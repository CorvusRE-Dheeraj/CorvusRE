import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { ROUTE_STYLE } from "@/components/train-track";
import {
  ROUTES,
  STATIONS,
  getStation,
  lineProgress,
  type LineColor,
  type TrainLocation,
  type Wagon,
} from "@/lib/train-track";

// The animated hero of the Track Map: the whole 29-station line as one long
// landscape, with the project's train driving out of the tunnel to where the
// project really is, pulling a wagon of collected data for every route it has
// reached. The view is a "camera" that pans with the train on the way in and
// is then free to scroll along the line.
//
// All motion is CSS (styles.css, "Train journey") behind
// prefers-reduced-motion — with reduced motion the train is simply parked.

const SHORT: Record<LineColor, string> = {
  blue: "Intake",
  purple: "Requirements",
  orange: "Pre-App",
  teal: "Submission",
  green: "Review",
  gray: "Approval",
};

// The yard before Station 1 is long enough that even there the whole train,
// every wagon included, is on screen.
const YARD = 1000;
const GAP = 124;
const TAIL = 240;
const SCENE_WIDTH = YARD + (STATIONS.length - 1) * GAP + TAIL;
/** Station n's x position in the scene, in px. */
const at = (n: number) => YARD + (n - 1) * GAP;
/** Where the camera keeps the front of the train, as a share of the view —
 *  further right on narrow screens so the wagons behind it stay in shot. */
const cameraAt = (viewWidth: number) => (viewWidth < 640 ? 0.9 : 0.7);
/** Where the train waits (nose just inside the tunnel) before its run. */
const DEPOT_X = 56;

export function TrainJourney({
  location,
  wagons,
  onOpenStation,
}: {
  location: TrainLocation;
  wagons: Wagon[];
  onOpenStation: (n: number) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const trainRef = useRef<HTMLDivElement>(null);
  // "depot" = waiting in the tunnel; "running" = driving in; "arrived" =
  // parked at the station, crates loading.
  const [phase, setPhase] = useState<"depot" | "running" | "arrived">("depot");
  const here = getStation(location.station)!;
  const next = getStation(location.station + 1);
  const progress = lineProgress(location.station);
  const crateCount = wagons.reduce((n, w) => n + w.crates.length, 0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPhase("arrived");
      return;
    }
    // Two frames so the depot position is painted before the target is set —
    // otherwise the train jumps instead of driving.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setPhase("running"));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [location.station]);

  // The camera. While the train runs, keep its nose at cameraAt() of the view;
  // otherwise settle there once, then leave scrolling to the user.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const train = trainRef.current;
    if (!scroller || !train) return;
    const follow = () => {
      const nose = train.getBoundingClientRect().right - scroller.getBoundingClientRect().left;
      scroller.scrollLeft += nose - scroller.clientWidth * cameraAt(scroller.clientWidth);
    };
    follow();
    if (phase !== "running") return;
    let raf = 0;
    const tick = () => {
      follow();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, location.station]);

  return (
    <section className="card-elev overflow-hidden p-0" aria-label="Your project's journey">
      <DepartureBoard
        nowN={here.n}
        nowTitle={here.title}
        nextN={next?.n}
        nextTitle={next?.title}
        progress={progress}
        wagons={wagons.length}
        crates={crateCount}
      />

      <div className="relative">
        <div ref={scrollerRef} className="journey-scroller overflow-x-auto">
          <div className="journey-sky relative h-[300px]" style={{ width: SCENE_WIDTH }}>
            {/* Scenery */}
            {[180, 820, 1500, 2150, 2800, 3500, 4200].map((x, i) => (
              <Cloud
                key={x}
                className={cn(i % 2 ? "top-14 scale-75" : "top-5", i % 3 === 2 && "scale-90")}
                style={{ left: x, animationDuration: `${50 + i * 8}s` }}
              />
            ))}
            <Hills />

            {/* Route colour under each stretch of line. */}
            {ROUTES.map((r, i) => {
              const start = at(r.stations[0]) - GAP / 2;
              const nextRoute = ROUTES[i + 1];
              const end = nextRoute ? at(nextRoute.stations[0]) - GAP / 2 : SCENE_WIDTH - TAIL / 2;
              return (
                <div
                  key={r.name}
                  className={cn("absolute bottom-9 h-1.5 rounded-full opacity-80", ROUTE_STYLE[r.color].solid)}
                  style={{ left: start, width: end - start }}
                  title={`${r.name}: stations ${r.stations[0]}–${r.stations[r.stations.length - 1]}`}
                />
              );
            })}
            <div className="journey-rails absolute inset-x-0 bottom-11 h-4" aria-hidden />

            {/* Route boards */}
            {ROUTES.map((r) => (
              <div
                key={`board-${r.name}`}
                className={cn(
                  "absolute top-3 -translate-x-1/2 whitespace-nowrap rounded-md px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow",
                  ROUTE_STYLE[r.color].solid,
                )}
                style={{ left: at(r.stations[0]) }}
              >
                {SHORT[r.color]}
              </div>
            ))}

            {/* Station signals — each one opens that station's window. */}
            {STATIONS.map((s) => {
              const state =
                s.n < location.station ? "passed" : s.n === location.station ? "current" : "ahead";
              return (
                <button
                  key={s.n}
                  type="button"
                  onClick={() => onOpenStation(s.n)}
                  className="group absolute bottom-[3.9rem] z-0 flex -translate-x-1/2 flex-col items-center"
                  style={{ left: at(s.n) }}
                  aria-label={`Station ${s.n}: ${s.title} (${state}). Opens details in a new window.`}
                  title={`${s.n} · ${s.title}`}
                >
                  <span
                    className={cn(
                      "grid h-6 w-6 place-items-center rounded-full border-2 border-slate-700 text-[10px] font-bold shadow transition-transform group-hover:scale-125",
                      state === "passed" && "bg-green-500 text-white",
                      state === "current" && "journey-signal bg-amber-400 text-slate-900",
                      state === "ahead" && "bg-slate-200 text-slate-600",
                    )}
                  >
                    {s.n}
                  </span>
                  <span className="h-16 w-1 rounded-full bg-slate-600" aria-hidden />
                </button>
              );
            })}

            {/* The train: wagons (earliest route first) + the locomotive in front. */}
            <div
              ref={trainRef}
              className={cn(
                "journey-train absolute bottom-12 z-10 flex -translate-x-full items-end",
                phase !== "arrived" && "is-moving",
              )}
              style={{ left: phase === "depot" ? DEPOT_X : at(location.station) + 26 }}
              onTransitionEnd={(e) => {
                if (e.target === trainRef.current && e.propertyName === "left") setPhase("arrived");
              }}
            >
              {wagons.map((w, i) => (
                <WagonCar key={w.route} wagon={w} index={i} arrived={phase === "arrived"} />
              ))}
              <Locomotive />
            </div>

            {/* Tunnel the train comes out of, drawn over the train. */}
            <div
              className="absolute bottom-9 left-0 z-20 h-32 w-16 rounded-tr-[4rem] bg-gradient-to-r from-stone-700 to-stone-500"
              aria-hidden
            >
              <div className="absolute bottom-0 right-1.5 h-24 w-9 rounded-t-full bg-stone-950" />
            </div>
            <div className="absolute inset-x-0 bottom-0 h-9 bg-gradient-to-b from-stone-400 to-stone-500" aria-hidden />
          </div>
        </div>
        <span className="pointer-events-none absolute bottom-2 left-3 rounded-full bg-white/85 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 shadow-sm">
          Scroll along the line →
        </span>
      </div>

      <p className="border-t border-border bg-muted/40 px-5 py-3 text-sm">
        <span className="font-semibold">Why the train is here: </span>
        <span className="text-muted-foreground">{location.reason}</span>
      </p>
    </section>
  );
}

function DepartureBoard(props: {
  nowN: number;
  nowTitle: string;
  nextN?: number;
  nextTitle?: string;
  progress: number;
  wagons: number;
  crates: number;
}) {
  const cells = 20;
  const lit = Math.round((props.progress / 100) * cells);
  return (
    <div className="grid gap-x-8 gap-y-2 bg-slate-900 px-5 py-4 font-mono text-[13px] uppercase tracking-wider text-amber-300 sm:grid-cols-2">
      <div className="flex min-w-0 items-center gap-3">
        <span className="journey-led h-2 w-2 shrink-0 rounded-full bg-green-400" aria-hidden />
        <span className="shrink-0 text-slate-400">Now at</span>
        <span className="truncate">
          {String(props.nowN).padStart(2, "0")} {props.nowTitle}
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-3">
        <span className="shrink-0 text-slate-400">Next stop</span>
        <span className="truncate">
          {props.nextN ? `${String(props.nextN).padStart(2, "0")} ${props.nextTitle}` : "End of the line"}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="shrink-0 text-slate-400">Progress</span>
        <span className="flex gap-0.5" aria-hidden>
          {Array.from({ length: cells }, (_, i) => (
            <span
              key={i}
              className={cn("journey-cell h-3 w-1.5 rounded-sm", i < lit ? "bg-amber-400" : "bg-slate-700")}
              style={{ animationDelay: `${i * 70}ms` }}
            />
          ))}
        </span>
        <span>{props.progress}%</span>
      </div>
      <div className="flex min-w-0 items-center gap-3">
        <span className="shrink-0 text-slate-400">Cargo</span>
        <span className="truncate">
          {props.wagons} wagon{props.wagons === 1 ? "" : "s"} · {props.crates} data crate
          {props.crates === 1 ? "" : "s"} collected
        </span>
      </div>
    </div>
  );
}

function WagonCar({ wagon, index, arrived }: { wagon: Wagon; index: number; arrived: boolean }) {
  const style = ROUTE_STYLE[wagon.color];
  return (
    <div className="relative mr-2 flex w-[150px] shrink-0 flex-col items-center">
      {wagon.loading && (
        <span className="journey-loading mb-1 whitespace-nowrap rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-700 shadow">
          loading data<span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      )}
      {/* Crates stacked in the open wagon — they drop in once the train stops. */}
      <div className="flex w-full flex-col-reverse items-stretch gap-0.5 px-1.5">
        {wagon.crates.map((c, j) => (
          <span
            key={c}
            className={cn(
              "journey-crate truncate rounded-[3px] border px-1.5 py-[3px] text-center text-[10px] font-semibold leading-tight shadow-sm",
              style.chip,
              arrived && "is-loaded",
            )}
            style={{ animationDelay: `${index * 260 + j * 160}ms` }}
            title={c}
          >
            {c}
          </span>
        ))}
      </div>
      <div
        className={cn(
          "relative mt-0.5 flex h-8 w-full items-center justify-center rounded-md border-b-4 border-slate-800 text-[10px] font-bold uppercase tracking-wider text-white shadow-md",
          style.solid,
        )}
      >
        {SHORT[wagon.color]}
        {/* coupling to the next car */}
        <span className="absolute -right-2.5 top-1/2 h-1.5 w-3 -translate-y-1/2 rounded-sm bg-slate-800" aria-hidden />
      </div>
      <div className="-mt-2 flex w-full justify-between px-3">
        <Wheel />
        <Wheel />
      </div>
    </div>
  );
}

function Wheel({ size = "h-5 w-5" }: { size?: string }) {
  return <span className={cn("journey-wheel block rounded-full border-2 border-slate-800", size)} aria-hidden />;
}

function Locomotive() {
  return (
    <div className="relative w-[150px] shrink-0">
      {[0, 0.7, 1.4].map((delay, i) => (
        <span
          key={delay}
          className={cn(
            "journey-puff absolute left-[88px] top-[-16px] rounded-full bg-slate-200",
            ["h-4 w-4", "h-5 w-5", "h-3 w-3"][i],
          )}
          style={{ animationDelay: `${delay}s` }}
          aria-hidden
        />
      ))}
      <svg viewBox="0 0 150 64" className="block w-full" role="img" aria-label="Your project's locomotive">
        {/* chimney + dome */}
        <rect x="86" y="4" width="16" height="22" rx="3" fill="#1e293b" />
        <rect x="82" y="1" width="24" height="7" rx="3" fill="#334155" />
        <rect x="62" y="15" width="16" height="12" rx="6" fill="#b45309" />
        {/* boiler */}
        <rect x="46" y="22" width="94" height="32" rx="12" fill="#d97706" />
        <rect x="46" y="33" width="94" height="5" fill="#fbbf24" />
        <circle cx="139" cy="33" r="6" fill="#fef3c7" stroke="#92400e" strokeWidth="2" />
        {/* cab */}
        <rect x="4" y="8" width="50" height="46" rx="6" fill="#1e3a5f" />
        <rect x="0" y="4" width="58" height="8" rx="3" fill="#0f172a" />
        <rect x="13" y="17" width="30" height="16" rx="3" fill="#e0f2fe" />
        <text
          x="29"
          y="47"
          textAnchor="middle"
          fontSize="9"
          fontWeight="700"
          fill="#fbbf24"
          fontFamily="ui-sans-serif, system-ui"
        >
          CorvusDP
        </text>
        {/* frame + cow-catcher */}
        <rect x="2" y="52" width="138" height="6" rx="3" fill="#0f172a" />
        <path d="M136 52 L150 64 L134 64 Z" fill="#334155" />
      </svg>
      <div className="-mt-[12px] flex items-end justify-between pl-3 pr-8">
        <Wheel size="h-7 w-7" />
        <Wheel size="h-9 w-9" />
        <Wheel size="h-9 w-9" />
      </div>
    </div>
  );
}

function Cloud({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div className={cn("journey-cloud absolute h-10 w-24", className)} style={style} aria-hidden>
      <span className="absolute bottom-0 left-0 h-6 w-24 rounded-full bg-white/90" />
      <span className="absolute bottom-2 left-4 h-8 w-10 rounded-full bg-white/90" />
      <span className="absolute bottom-2 left-11 h-10 w-12 rounded-full bg-white/90" />
    </div>
  );
}

// One 1000px stretch of hills, tiled along the whole panorama.
function Hills() {
  return (
    <svg className="absolute inset-x-0 bottom-9 h-[130px] w-full" aria-hidden>
      <defs>
        <pattern id="journey-hills" width="1000" height="130" patternUnits="userSpaceOnUse">
          <path
            d="M0 70 C 120 10, 220 10, 330 60 S 560 0, 700 50 S 900 20, 1000 70 L1000 130 L0 130 Z"
            fill="#bbf7d0"
          />
          <path
            d="M0 100 C 150 55, 260 65, 400 90 S 640 55, 780 85 S 930 75, 1000 100 L1000 130 L0 130 Z"
            fill="#86efac"
          />
        </pattern>
      </defs>
      <rect width="100%" height="130" fill="url(#journey-hills)" />
    </svg>
  );
}
