import { useEffect, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  getSavedComparison,
  runStreetViewComparison,
  saveComparison,
  streetViewUrl,
  type RatedImage,
  type SavedComparison,
} from "@/lib/streetview-condition";

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const FINDING_TONE = {
  worse: "text-success", // a worse-condition subject supports the protest
  similar: "text-foreground",
  better: "text-warning-foreground",
  inconclusive: "text-muted-foreground",
} as const;

function Tile({ img, location }: { img: RatedImage; location: string | undefined }) {
  const src = location ? streetViewUrl(location) : null;
  const r = img.rating;
  return (
    <figure className="overflow-hidden rounded-md border border-border">
      {src ? (
        <img
          src={src}
          alt={`Street View of ${img.address}`}
          loading="lazy"
          className="aspect-[16/10] w-full bg-secondary object-cover"
        />
      ) : (
        <div className="aspect-[16/10] w-full bg-secondary" />
      )}
      <figcaption className="grid gap-0.5 p-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">
            {img.key === "subject" ? "This property" : img.address}
          </span>
          <span className="shrink-0 font-semibold tabular-nums">
            {r.usable && r.overall ? `${r.overall}/5` : "—"}
          </span>
        </div>
        <div className="text-muted-foreground">
          {img.imageDate ? `Imagery ${img.imageDate}` : "Imagery date unknown"}
          {img.value != null ? ` · ${usd(img.value)}` : ""}
        </div>
        {r.usable ? (
          r.defects.length > 0 && (
            <div className="text-muted-foreground">{r.defects.join(" · ")}</div>
          )
        ) : (
          <div className="text-muted-foreground">Building not clearly visible</div>
        )}
      </figcaption>
    </figure>
  );
}

// Street View condition comparison (Module 5): the subject's visible exterior
// against its nearest county comparables, rated from Street View and compared
// deterministically (lib/streetview-condition.ts).
export function StreetViewComparison({
  address,
  cad,
  accountNumber,
  totalValue,
}: {
  address: string | undefined;
  cad: string | undefined;
  accountNumber: string | undefined;
  totalValue: number | undefined;
}) {
  const { user } = useAuth();
  const [saved, setSaved] = useState<SavedComparison | null>(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !cad || !accountNumber) return;
    getSavedComparison(cad, accountNumber)
      .then(setSaved)
      .catch(() => {});
  }, [user, cad, accountNumber]);

  if (!address) return null;

  async function run() {
    setRunning(true);
    setNotice(null);
    try {
      const r = await runStreetViewComparison({
        address: address!,
        cad,
        accountNumber,
        totalValue,
      });
      if (r.status !== "ok") {
        setNotice(r.message);
        return;
      }
      const next = { ...r, createdAt: new Date().toISOString() };
      setSaved(next);
      if (user && cad && accountNumber) await saveComparison(user.id, cad, accountNumber, r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not run the Street View comparison.");
    } finally {
      setRunning(false);
    }
  }

  const c = saved?.comparison;
  return (
    <section aria-labelledby="sv-title" className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Camera className="h-4 w-4 text-accent" aria-hidden="true" />
          <h3 id="sv-title" className="text-sm font-semibold">
            Street View condition comparison
          </h3>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="btn-outline inline-flex items-center gap-1.5 text-xs disabled:opacity-60"
        >
          {running && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          {running ? "Rating the images…" : c ? "Run again" : "Compare with nearby comparables"}
        </button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Corvus pulls Street View images of this property and its most similar county comparables and
        rates the visible exterior — facade, paving, site upkeep — on the same scale.
      </p>
      {notice && <p className="mt-2 text-sm text-muted-foreground">{notice}</p>}
      {c && (
        <div className="mt-3 grid gap-3">
          <p className={`text-sm font-medium ${FINDING_TONE[c.finding]}`}>{c.summary}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[c.subject, ...c.comps]
              .filter((x): x is RatedImage => !!x)
              .map((img) => (
                <Tile key={img.key} img={img} location={saved!.locations[img.key]} />
              ))}
          </div>
          <ul className="grid gap-0.5 text-[11px] text-muted-foreground">
            {c.caveats.map((x) => (
              <li key={x}>· {x}</li>
            ))}
            <li>
              · Ratings are Corvus&apos;s read of the images, run{" "}
              {new Date(saved!.createdAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
              .
            </li>
          </ul>
        </div>
      )}
    </section>
  );
}
