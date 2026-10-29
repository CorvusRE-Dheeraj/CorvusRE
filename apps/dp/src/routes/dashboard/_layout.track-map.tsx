import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Fragment, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, LocateFixed, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { EmptyProject, Loading } from "@/components/dp-ui";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  AvailabilityDot,
  ROUTE_STYLE,
  StationDetail,
  TrainIcon,
  useTrainTrack,
} from "@/components/train-track";
import { MiniTrain, TrainJourney } from "@/components/train-journey";
import {
  HistoryView,
  PermitLanes,
  PermitView,
  RoundView,
  StagePill,
  type PermitTrack,
  type TrackView,
} from "@/components/permit-tracks";
import {
  AVAILABILITY_LABEL,
  ROUTES,
  getStation,
  wagonCargo,
  type Availability,
  type Station,
  type Wagon,
} from "@/lib/train-track";
import {
  LANE_COLORS,
  LANE_HEX,
  fmtDate,
  permitRounds,
  permitStage,
  stageName,
} from "@/lib/permit-history";
import { ContinuousTrack, Rail, TrackJunction, TrackLabel } from "@/components/rail";
import { MAIN_RAIL, trackGutter, trackSides } from "@/lib/track-path";
import { TRACK_PORTFOLIO_KEY, getTrackPortfolio, type TrackPortfolio } from "@/lib/track-portfolio";
import { setActiveProject } from "@/lib/projects";

export const Route = createFileRoute("/dashboard/_layout/track-map")({
  head: () => ({ meta: [{ title: "Permitting Train-Track Map — CorvusDP" }] }),
  component: TrackMap,
});

type Filter = "all" | "process" | "ai";

function buildTracks(p: TrackPortfolio | undefined): PermitTrack[] {
  if (!p) return [];
  return p.projects.flatMap((project) =>
    p.permits
      .filter((permit) => permit.project_id === project.id)
      .map((permit) => {
        const rounds = permitRounds(permit, p.submissions, p.comments);
        return { project, permit, rounds, stage: permitStage(permit, rounds) };
      }),
  );
}

// a loop station clicked for one permit opens that permit's record at that step
const LOOP_STAGE: Record<number, string> = {
  18: "submitted",
  19: "review",
  20: "comments",
  21: "assign",
  22: "engineer",
  23: "compliance",
  27: "approved",
  28: "approved",
};

function TrackMap() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { loading, hasProject, project, bundle, comments, location } = useTrainTrack();
  const portfolio = useQuery({
    queryKey: [TRACK_PORTFOLIO_KEY, user?.id],
    queryFn: () => getTrackPortfolio(user!.id),
    enabled: !!user,
  });
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [stack, setStack] = useState<TrackView[]>([]);
  const tracks = useMemo(() => buildTracks(portfolio.data), [portfolio.data]);

  if (loading) return <Loading />;
  if (!hasProject || !project) return <EmptyProject />;

  const projectTracks = tracks.filter((t) => t.project.id === project.id);
  // each permit's parallel track is drawn in its lane colour
  const laneHex = projectTracks.map((_, i) => LANE_HEX[i % LANE_HEX.length]);
  // room beside the map for the track's bends, and what it's drawn over
  const trackPad = trackGutter(projectTracks.length);
  // which way the line runs through each main row (and so how it's numbered)
  const sides = trackSides(4);
  const trackVersion = [
    filter,
    query,
    location?.station,
    ...projectTracks.map((t) => `${t.permit.id}:${t.stage}`),
  ].join("|");
  const projects = portfolio.data?.projects ?? [project];
  const wagons = location
    ? wagonCargo({
        trainAt: location.station,
        analysis: project.analysis,
        permits: bundle?.permits ?? [],
        checklist: bundle?.checklist ?? [],
        comments,
      })
    : [];
  // the train sits in a permit's loop when the project is held up in review
  const trainLoopPermit =
    location && location.station >= 19 && location.station <= 24
      ? projectTracks.find((t) => t.stage === location.station)?.permit.id
      : undefined;

  const open = (v: TrackView) => setStack((s) => [...s, v]);
  const openStation = (n: number, ai = false, permitId?: string) => {
    if (ai) return open({ type: "station", n, ai: true });
    if (n === 24 || n === 25)
      return open({
        type: "history",
        projectId: project.id,
        permitKey: permitId
          ? (projectTracks.find((t) => t.permit.id === permitId)?.permit.permit_key ?? "all")
          : "all",
      });
    if (permitId)
      return open({
        type: "permit",
        permitId,
        stage: LOOP_STAGE[n] ?? "review",
        tab: [20, 21, 22, 23].includes(n) ? "comments" : "overview",
      });
    open({ type: "station", n });
  };
  const openHistory = (projectId = project.id) =>
    open({ type: "history", projectId, permitKey: "all" });

  async function selectProject(id: string) {
    if (id === project?.id) return;
    await setActiveProject(id);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["active-project"] }),
      qc.invalidateQueries({ queryKey: ["projects"] }),
      qc.invalidateQueries({ queryKey: [TRACK_PORTFOLIO_KEY] }),
    ]);
  }

  const q = query.trim().toLowerCase();
  const stationMatch = (s: Station) =>
    !q || `${s.title} ${s.purpose} ${s.module}`.toLowerCase().includes(q) || String(s.n) === q;
  const searchHits = q
    ? ROUTES.flatMap((r) => r.stations).filter((n) => stationMatch(getStation(n)!)).length
    : 0;

  const rowProps = { filter, match: stationMatch, wagons, onOpen: openStation };

  return (
    <div className="grid min-w-0 grid-cols-1 gap-5">
      {/* ── header (existing train graphics) ───────────────────────────── */}
      <header className="card-elev p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="hidden h-16 w-24 shrink-0 place-items-center rounded-2xl border border-border bg-gradient-to-br from-amber-50 to-white min-[440px]:grid">
              <TrainIcon className="h-9 w-14" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-widest text-accent">
                CorvusDP / Design + Permitting
              </div>
              <h1 className="font-serif text-2xl font-semibold leading-tight">
                Permitting Train-Track Map
              </h1>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                One project, independent permit tracks. Click a station to see submission dates,
                review comments and the time spent with the city or the design team.
              </p>
            </div>
          </div>
          {location && (
            <div className="w-full max-w-sm rounded-2xl border-2 border-green-500 bg-green-50 p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-green-700">
                Your train is at
              </div>
              <div className="mt-1 font-semibold text-green-950">
                Station {location.station} · {getStation(location.station)?.title}
              </div>
              <p className="mt-1 text-sm text-green-900">{location.reason}</p>
              <button
                type="button"
                className="btn-accent mt-3"
                onClick={() => openStation(location.station)}
              >
                Open station
              </button>
            </div>
          )}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Rail className="w-8" /> Continuous main line
          </span>
          <span className="flex items-center gap-1.5">
            <Rail color={LANE_HEX[0]} className="w-8" />
            <Rail color={LANE_HEX[1]} className="w-8" /> Parallel track, one per permit
          </span>
          <span className="flex items-center gap-1.5">
            <Rail color="#dc2626" className="w-8" /> Return track — repeat this permit's review
          </span>
          <span>
            <b className="mr-1 text-base text-green-700">●</b> Current stage
          </span>
          <span>
            <b className="mr-1 rounded bg-amber-400 px-1 text-[10px] text-amber-950">AI</b> Embedded
            module details
          </span>
          {(Object.keys(AVAILABILITY_LABEL) as Availability[]).map((a) => (
            <span key={a} className="flex items-center gap-1.5">
              <AvailabilityDot availability={a} />
              {AVAILABILITY_LABEL[a]}
            </span>
          ))}
        </div>
      </header>

      {location && (
        <TrainJourney location={location} wagons={wagons} onOpenStation={(n) => openStation(n)} />
      )}

      {/* ── every project, then the selected one ──────────────────────── */}
      <section className="card-elev p-5" aria-labelledby="portfolio-h">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 id="portfolio-h" className="font-serif text-lg font-semibold">
              Your projects
            </h2>
            <p className="text-sm text-muted-foreground">
              Every project stays in view. Pick one to see its own permits and submission history.
            </p>
          </div>
          <span className="rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-xs">
            {projects.length} project{projects.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {projects.map((p) => {
            const mine = tracks.filter((t) => t.project.id === p.id);
            const selected = p.id === project.id;
            return (
              <article
                key={p.id}
                className={cn(
                  "flex min-w-0 flex-col rounded-xl border bg-card p-3.5",
                  selected ? "border-2 border-accent bg-accent/5" : "border-border",
                )}
              >
                <h3 className="truncate font-semibold" title={p.name ?? ""}>
                  {p.name ?? p.address}
                </h3>
                <p className="mb-2 text-[11px] text-muted-foreground">
                  {p.city ?? "—"} · {mine.length} permit track{mine.length === 1 ? "" : "s"}
                </p>
                <div className={cn("mb-3 grid gap-1 text-xs", !selected && "max-sm:hidden")}>
                  {mine.length ? (
                    mine.map((t) => (
                      <div key={t.permit.id} className="flex flex-wrap justify-between gap-x-2">
                        <b className="font-medium">{t.permit.name}</b>
                        <span className="text-muted-foreground">{stageName(t.stage)}</span>
                      </div>
                    ))
                  ) : (
                    <span className="text-muted-foreground">No permits identified yet</span>
                  )}
                </div>
                <button
                  type="button"
                  aria-pressed={selected}
                  className={cn("mt-auto w-full text-xs", selected ? "btn-accent" : "btn-outline")}
                  onClick={() => selectProject(p.id)}
                >
                  {selected ? "Viewing this project" : "View this project"}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-800 px-4 py-3.5 text-white">
        <label className="grid min-w-0 gap-1 max-sm:w-full">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-300">
            Selected project
          </span>
          <select
            className="min-w-0 rounded-md border border-slate-600 bg-white px-2 py-1.5 text-sm text-slate-900 sm:min-w-[260px]"
            value={project.id}
            onChange={(e) => selectProject(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name ?? p.address}
              </option>
            ))}
          </select>
        </label>
        <div className="min-w-0 text-xs text-slate-200">
          {projectTracks.map((t) => (
            <div key={t.permit.id}>
              {t.permit.name} <strong className="text-white">· {stageName(t.stage)}</strong>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-100"
            onClick={() =>
              document
                .getElementById("submission-section")
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          >
            Open permit tracks
          </button>
          <button
            type="button"
            className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-100"
            onClick={() => openHistory()}
          >
            Resubmission Manager
          </button>
        </div>
      </div>

      {/* ── map tools ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="inline-flex flex-wrap rounded-full border border-border bg-card p-1"
          role="group"
          aria-label="Map content"
        >
          {(
            [
              ["all", "All stations + AI"],
              ["process", "Process stations"],
              ["ai", "AI modules"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors",
                filter === value
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn-outline"
          onClick={() =>
            document
              .getElementById("track-train")
              ?.scrollIntoView({ behavior: "smooth", block: "center" })
          }
        >
          <LocateFixed className="h-4 w-4" aria-hidden /> Find my train
        </button>
        <label className="relative ml-auto w-full sm:w-72">
          <span className="sr-only">Find a station or AI module</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a station or AI module…"
            className="w-full rounded-full border border-input bg-background py-2 pl-9 pr-3 text-sm"
          />
        </label>
        <span className="w-full text-right text-xs text-muted-foreground" aria-live="polite">
          {q
            ? searchHits
              ? `${searchHits} matching station${searchHits === 1 ? "" : "s"}`
              : "No matching stations"
            : ""}
        </span>
      </div>

      {/* ── the map: one continuous track through every section ─────── */}
      <div
        className="relative grid min-w-0 grid-cols-1 gap-5 xl:px-[var(--track-pad)]"
        style={{ "--track-pad": `${trackPad}px` } as CSSProperties}
      >
        <ContinuousTrack
          pad={trackPad}
          version={trackVersion}
          plan={{
            main: ["route-1", "route-2", "route-3", "station-18"],
            permits: projectTracks.map((_, i) => [`lane-${i}`, `loop-${i}`] as [string, string]),
            after: "route-6",
            colors: laneHex,
          }}
        />

        {/* ── routes 1–3 ─────────────────────────────────────────────── */}
        {ROUTES.slice(0, 3).map((route, i) => (
          <Fragment key={route.name}>
            <RouteSection
              color={route.color}
              title={route.name}
              subtitle={`${["Validated project inputs", "Local requirements + constraints", "Pre-application + package preparation"][i]} · Click a numbered station or its AI module.`}
              tag="Process group"
            >
              <StationRow
                nums={route.stations}
                current={(n) => location?.station === n}
                trainAt={location?.station}
                track={{ kind: "main", id: `route-${i + 1}` }}
                reverse={sides.rows[i] === "right"}
                {...rowProps}
              />
            </RouteSection>
            <TrackJunction
              from={1}
              to={1}
              colors={[]}
              title={i < 2 ? "One continuous line." : "The main line runs on to submission."}
              text={
                i < 2
                  ? "Each step's outputs feed the next; support work can continue alongside."
                  : "Each complete permit package then starts its own submission and review."
              }
            />
          </Fragment>
        ))}

        {/* ── submission, then one parallel track per permit: its lane and its
            review loop together, so its track runs on unbroken ─────────── */}
        <RouteSection
          id="submission-section"
          color="teal"
          title="Submission Management + Parallel Permit Tracks"
          subtitle={`${project.name ?? project.address} · ${projectTracks.length} permit${projectTracks.length === 1 ? "" : "s"} · each permit's submission and its own review loop · every step is clickable`}
          tag="∥ Independent permit records"
        >
          <div className="mx-auto w-full max-w-[340px]">
            <StationRow
              nums={[18]}
              current={(n) => location?.station === n}
              trainAt={location?.station}
              track={{ kind: "main", id: "station-18" }}
              {...rowProps}
              single
            />
          </div>
          <p className="mx-auto mt-2 max-w-2xl text-center text-sm text-muted-foreground">
            Open <strong className="text-foreground">Submission Management</strong> to see every
            permit's latest filing. Open the{" "}
            <strong className="text-foreground">Resubmission Manager</strong> to compare every round
            and keep time at the city apart from time with engineers.{" "}
            <button
              type="button"
              className="font-semibold text-accent underline-offset-2 hover:underline"
              onClick={() => openHistory()}
            >
              View all submissions / resubmissions
            </button>
          </p>
          <div className="my-4">
            <TrackJunction
              from={1}
              to={Math.max(projectTracks.length, 1)}
              colors={laneHex}
              title="The main line branches into parallel permit tracks."
              text="Each permit runs on its own track from here — through its submission and its own review loop — and one permit's review never holds up another's."
            />
          </div>
          {portfolio.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading permits…</p>
          ) : (
            <PermitLanes
              tracks={projectTracks}
              onView={open}
              loop={(t, i) => {
                const r = t.rounds.at(-1);
                return (
                  <div id={`loop-${t.permit.id}`} className="scroll-mt-4">
                    {/* the band the track bends back through, from the lane into the loop */}
                    <div data-gap={`corridor-${i}`} className="hidden h-8 xl:block" />
                    <div className="mb-3 mt-4 flex flex-wrap items-start justify-between gap-2 border-t border-dashed border-border pt-3 xl:mt-0">
                      <div className="min-w-0">
                        <h4 className="text-sm font-semibold">
                          {t.permit.name} · Review + Comment / Resubmission Loop
                        </h4>
                        <p className="text-xs text-muted-foreground">
                          {r
                            ? `Latest: submission ${r.round}, filed ${fmtDate(r.submitted_at)}`
                            : "Not submitted yet"}{" "}
                          · this permit's records only
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn-outline px-2.5 py-1 text-xs"
                        onClick={() =>
                          open({
                            type: "history",
                            projectId: project.id,
                            permitKey: t.permit.permit_key,
                          })
                        }
                      >
                        Resubmission Manager
                      </button>
                    </div>
                    <StationRow
                      nums={[19, 20, 21, 22, 23, 24]}
                      current={(n) => t.stage === n}
                      trainAt={trainLoopPermit === t.permit.id ? location?.station : undefined}
                      permitId={t.permit.id}
                      track={{
                        kind: "loop",
                        label: t.permit.name,
                        color: laneHex[i],
                        id: `loop-${i}`,
                      }}
                      {...rowProps}
                    />
                    {/* the return track: resubmitting runs back to the start of this loop */}
                    <div className="mt-3 rounded-lg border-2 border-dashed border-red-300 bg-red-50 px-3 py-2">
                      <div className="flex items-center gap-2" aria-hidden>
                        <span className="text-lg font-bold leading-none text-red-700">←</span>
                        <Rail color="#dc2626" className="flex-1" />
                        <span className="text-lg font-bold leading-none text-red-700">↻</span>
                      </div>
                      <p className="mt-1.5 text-center text-xs font-semibold text-red-800">
                        Return track: resubmit this permit and it runs back to Station 19 for its
                        next city review. Repeats only when the city asks for revisions.
                      </p>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      City approval exits the loop directly — no extra resubmission, and the other
                      permits don't have to finish first.
                    </p>
                  </div>
                );
              }}
            />
          )}
        </RouteSection>

        <TrackJunction
          from={Math.max(projectTracks.length, 1)}
          to={1}
          colors={laneHex}
          title="Approved permits rejoin the main line."
          text="Each permit leaves its loop on its own approval; approval, clearance and expiry records stay specific to each permit."
        />

        {/* ── approval / clearance / expiry ─────────────────────────────── */}
        <RouteSection
          color="gray"
          title={ROUTES[5].name}
          subtitle="Submission aging and expediting run during review; clearance follows the required approvals."
          tag="Monitoring + closeout"
        >
          <StationRow
            nums={ROUTES[5].stations}
            current={(n) => location?.station === n}
            trainAt={location?.station}
            track={{ kind: "main", id: "route-6" }}
            reverse={sides.closeout === "right"}
            {...rowProps}
          />
          <p className="mt-4 rounded-full border border-green-200 bg-green-50 px-4 py-2 text-center text-sm font-semibold text-green-800">
            Outcome: faster submissions · clearer accountability · central permit review visibility
            · reduced permit aging risk
          </p>
        </RouteSection>
      </div>

      {/* ── popups ────────────────────────────────────────────────────── */}
      <Dialog open={stack.length > 0} onOpenChange={(o) => !o && setStack([])}>
        <DialogContent className="max-h-[92vh] w-[calc(100vw-1rem)] max-w-5xl overflow-y-auto p-4 sm:p-6">
          <DialogTitle className="sr-only">Train-track details</DialogTitle>
          {stack.length > 1 && (
            <button
              type="button"
              className="btn-outline w-fit px-2.5 py-1 text-xs"
              onClick={() => setStack((s) => s.slice(0, -1))}
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back
            </button>
          )}
          {stack.length > 0 && (
            <ViewBody
              view={stack[stack.length - 1]}
              tracks={tracks}
              projectTracks={projectTracks}
              projects={projects}
              location={location}
              onView={open}
              onReplace={(v) => setStack((s) => [...s.slice(0, -1), v])}
              onStation={openStation}
              onGoToPage={(page) => {
                setStack([]);
                void navigate({ to: page });
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ViewBody({
  view,
  tracks,
  projectTracks,
  projects,
  location,
  onView,
  onReplace,
  onStation,
  onGoToPage,
}: {
  view: TrackView;
  tracks: PermitTrack[];
  projectTracks: PermitTrack[];
  projects: TrackPortfolio["projects"];
  location: ReturnType<typeof useTrainTrack>["location"];
  onView: (v: TrackView) => void;
  onReplace: (v: TrackView) => void;
  onStation: (n: number, ai?: boolean, permitId?: string) => void;
  onGoToPage: (page: string) => void;
}) {
  if (view.type === "history")
    return (
      <HistoryView
        view={view}
        tracks={tracks}
        projects={projects}
        onView={onView}
        onChange={onReplace}
      />
    );
  const track =
    "permitId" in view && view.permitId
      ? tracks.find((t) => t.permit.id === view.permitId)
      : undefined;
  if (view.type === "permit")
    return track ? (
      <PermitView view={view} track={track} onView={onView} onChange={onReplace} />
    ) : null;
  if (view.type === "round")
    return track ? <RoundView track={track} roundNo={view.round} onView={onView} /> : null;

  const station = getStation(view.n)!;
  const perPermit = [19, 20, 21, 22, 23, 25, 26, 27, 28, 29].includes(station.n) && !view.ai;
  return (
    <div className="grid gap-4">
      <StationDetail
        station={station}
        view={view.ai ? "module" : "station"}
        location={location}
        onOpenStation={(n, v) => onStation(n, v === "module")}
        onGoToPage={onGoToPage}
      />
      {station.n === 18 && !view.ai && <PermitLanes tracks={projectTracks} onView={onView} />}
      {perPermit && projectTracks.length > 0 && (
        <div className="max-w-full overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                {["Permit", "Current stage", "Latest submission", "Expected city return", ""].map(
                  (h) => (
                    <th key={h} className="px-3 py-2 font-semibold">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {projectTracks.map((t) => {
                const r = t.rounds.at(-1);
                return (
                  <tr key={t.permit.id} className="border-t border-border">
                    <td className="px-3 py-2 font-semibold">{t.permit.name}</td>
                    <td className="px-3 py-2">
                      <StagePill stage={t.stage} />
                    </td>
                    <td className="px-3 py-2">{r ? fmtDate(r.submitted_at) : "Not submitted"}</td>
                    <td className="px-3 py-2">
                      {r ? fmtDate(r.expected_at, "Not estimated") : "Not estimated"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="btn-outline px-2 py-0.5 text-xs"
                        onClick={() => onStation(station.n, false, t.permit.id)}
                      >
                        Open permit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RouteSection({
  id,
  color,
  title,
  subtitle,
  tag,
  children,
}: {
  id?: string;
  color: keyof typeof ROUTE_STYLE;
  title: string;
  subtitle: string;
  tag: string;
  children: ReactNode;
}) {
  const style = ROUTE_STYLE[color];
  return (
    <section
      id={id}
      className={cn(
        "min-w-0 scroll-mt-4 rounded-2xl border border-l-4 border-border bg-card p-4 sm:p-5",
        style.border,
      )}
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className={cn("text-base font-bold", style.text)}>{title}</h2>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground">
          {tag}
        </span>
      </div>
      {children}
    </section>
  );
}

// One row of track: station cards joined by → connectors, each with its AI
// module underneath, all standing on a piece of rail (the main line, or one
// permit's parallel track) with a stop marker above each station. The train
// rides on the rail at its station. Scrolls sideways on narrow screens.
function StationRow({
  nums,
  current,
  trainAt,
  permitId,
  filter,
  match,
  wagons,
  onOpen,
  single,
  track,
  reverse = false,
}: {
  nums: number[];
  current: (n: number) => boolean;
  trainAt?: number;
  permitId?: string;
  filter: Filter;
  match: (s: Station) => boolean;
  wagons: Wagon[];
  onOpen: (n: number, ai?: boolean, permitId?: string) => void;
  single?: boolean;
  track: { kind: "main" | "parallel" | "loop"; label?: string; color?: string; id?: string };
  // the track runs through this row right to left (wide screens): stations laid
  // out from the right, arrows pointing left, the train facing left
  reverse?: boolean;
}) {
  const color = track.color ?? MAIN_RAIL;
  // room above the rail for the train, only on the row it's on
  const railTop = trainAt != null && nums.includes(trainAt) ? 50 : 6;
  const cardTop = railTop + 26;
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-2 pt-1">
      <TrackLabel kind={track.kind} label={track.label} color={color} />
      <ol
        className={cn(
          "relative flex items-stretch",
          single ? "w-full" : "min-w-max xl:min-w-0",
          reverse && "xl:flex-row-reverse",
        )}
      >
        <li aria-hidden className="pointer-events-none absolute inset-x-0" style={{ top: railTop }}>
          <Rail color={color} railId={track.id} />
        </li>
        {nums.map((n, i) => {
          const s = getStation(n)!;
          const dim = !match(s);
          const isCurrent = current(n);
          const style = ROUTE_STYLE[s.color];
          return (
            <Fragment key={n}>
              {i > 0 && (
                <li
                  className="flex w-7 shrink-0 items-start justify-center text-slate-400 xl:w-3"
                  style={{ paddingTop: cardTop + 66 }}
                  aria-hidden
                >
                  <ArrowRight className={cn("h-4 w-4", reverse && "xl:hidden")} />
                  {reverse && <ArrowLeft className="hidden h-4 w-4 xl:block" />}
                </li>
              )}
              <li
                className={cn(
                  "relative flex flex-col gap-1.5",
                  single ? "w-full" : "w-[196px] shrink-0 xl:w-auto xl:min-w-0 xl:flex-1 xl:shrink",
                  dim && "opacity-25",
                )}
                style={{ paddingTop: cardTop }}
              >
                {/* the station's stop on the rail */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-1/2 h-[18px] w-[18px] -translate-x-1/2 rounded-full border-[3px] border-white shadow",
                    isCurrent ? "bg-green-600" : style.solid,
                  )}
                  style={{ top: railTop - 2 }}
                />
                <span
                  aria-hidden
                  className="absolute left-1/2 w-[2px] -translate-x-1/2 bg-slate-300"
                  style={{ top: railTop + 16, height: cardTop - railTop - 16 }}
                />
                {trainAt === n && (
                  <span
                    id="track-train"
                    className={cn("absolute right-1 z-10", reverse && "xl:left-1 xl:right-auto")}
                    style={{ bottom: `calc(100% - ${railTop + 3}px)` }}
                  >
                    {reverse ? (
                      <>
                        <span className="xl:hidden">
                          <MiniTrain wagons={wagons} />
                        </span>
                        <span className="hidden xl:block">
                          <MiniTrain wagons={wagons} facing="left" />
                        </span>
                      </>
                    ) : (
                      <MiniTrain wagons={wagons} />
                    )}
                  </span>
                )}
                {filter !== "ai" && (
                  <button
                    type="button"
                    onClick={() => onOpen(n, false, permitId)}
                    aria-label={`Station ${n}: ${s.title}${isCurrent ? " — current stage" : ""}`}
                    className={cn(
                      "relative flex min-h-[150px] w-full flex-col rounded-xl border-2 border-t-4 bg-card p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-md xl:px-2.5 xl:[overflow-wrap:anywhere]",
                      style.border,
                      isCurrent && "border-green-600 bg-green-50 ring-4 ring-green-500/20",
                    )}
                  >
                    <span className="mb-2 flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold text-white shadow",
                          isCurrent ? "bg-green-700" : style.solid,
                        )}
                      >
                        {n}
                      </span>
                      <small
                        className={cn(
                          "text-[10px] font-semibold",
                          isCurrent ? "text-green-700" : "text-muted-foreground",
                        )}
                      >
                        {isCurrent ? "CURRENT" : "Open details"}
                      </small>
                    </span>
                    <span className="text-[13px] font-semibold leading-snug">
                      {n === 22 ? "Engineer response + comment timeline" : s.title}
                    </span>
                    <span className="mt-1 line-clamp-3 text-[11px] text-muted-foreground">
                      {s.purpose}
                    </span>
                    {isCurrent && (
                      <span className="mt-auto flex items-center gap-1 pt-2 text-[11px] font-semibold text-green-700">
                        <Check className="h-3 w-3" aria-hidden /> You're here
                      </span>
                    )}
                  </button>
                )}
                {filter !== "process" && (
                  <button
                    type="button"
                    onClick={() => onOpen(n, true)}
                    className="flex min-h-[44px] w-full items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-left text-[11px] font-semibold leading-tight text-amber-900 hover:bg-amber-100 xl:px-2 xl:[overflow-wrap:anywhere]"
                  >
                    <span className="shrink-0 rounded bg-amber-400 px-1 py-0.5 text-[9px] font-bold text-amber-950">
                      AI
                    </span>
                    <span className="min-w-0 flex-1">{s.module.replace(/^AI /, "")}</span>
                    <AvailabilityDot availability={s.availability} />
                  </button>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </div>
  );
}
