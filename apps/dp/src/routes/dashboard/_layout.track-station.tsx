import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { X } from "lucide-react";
import { Loading } from "@/components/dp-ui";
import { StationDetail, TrainIcon, useTrainTrack } from "@/components/train-track";
import { getStation, STATIONS } from "@/lib/train-track";

// One station of the Permitting Train-Track Map, shown on its own. The map
// opens this in a separate popup window (see openStationWindow), so __root
// renders it bare — no site nav, sidebar, footer or chat widget.
//
// A search param rather than a /$n path segment: the site is prerendered to
// static HTML, and a single static route is served as-is, where a dynamic
// segment would need a page per station.
export const Route = createFileRoute("/dashboard/_layout/track-station")({
  head: () => ({ meta: [{ title: "Station — Permitting Train-Track Map — CorvusDP" }] }),
  validateSearch: (search: Record<string, unknown>): { n: number; view?: "module" } => {
    const n = Number(search.n);
    return {
      n: Number.isInteger(n) && n >= 1 && n <= STATIONS.length ? n : 1,
      view: search.view === "module" ? "module" : undefined,
    };
  },
  component: TrackStation,
});

function TrackStation() {
  const { n, view } = Route.useSearch();
  const navigate = useNavigate();
  const { loading, location } = useTrainTrack();
  const station = getStation(n)!;

  // Page links act on the main CorvusDP window that opened this one, so the
  // popup stays a side panel instead of turning into a second copy of the app.
  const goToPage = (page: string) => {
    const opener = window.opener as Window | null;
    const url = `${import.meta.env.BASE_URL.replace(/\/$/, "")}${page}`;
    if (opener && !opener.closed) {
      try {
        opener.location.assign(url);
        opener.focus();
        return;
      } catch {
        // Opener navigated to another origin — fall through and navigate here.
      }
    }
    void navigate({ to: page });
  };

  return (
    <div className="min-h-screen bg-muted/40 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <TrainIcon className="h-5 w-8" />
            Permitting Train-Track Map
          </div>
          <button
            type="button"
            onClick={() => window.close()}
            className="btn-outline"
            aria-label="Close this window"
          >
            <X className="h-4 w-4" aria-hidden /> Close
          </button>
        </div>
        <div className="card-elev p-5 sm:p-7">
          {loading ? (
            <Loading />
          ) : (
            <StationDetail
              station={station}
              view={view ?? "station"}
              location={location}
              onOpenStation={(next, nextView) =>
                navigate({
                  to: "/dashboard/track-station",
                  search: { n: next, view: nextView === "module" ? "module" : undefined },
                })
              }
              onGoToPage={goToPage}
            />
          )}
        </div>
      </div>
    </div>
  );
}
