import { useEffect, useState } from "react";
import { ExternalLink, Landmark } from "lucide-react";
import { lookupCityZoning, type CityZoningResult } from "@/lib/city-zoning";

// Module 6: the zoning district the city's own zoning map shows at this
// property's point (see city-zoning.ts for the sources).
export function CityZoningCard({
  coords,
  settled,
}: {
  coords: { lat: number; lng: number } | null;
  // false while the property's location is still being looked up
  settled: boolean;
}) {
  const [result, setResult] = useState<CityZoningResult | null>(null);
  useEffect(() => {
    if (!coords) return;
    let live = true;
    setResult(null);
    lookupCityZoning(coords.lat, coords.lng)
      .then((r) => live && setResult(r))
      .catch(() => live && setResult({ matches: [], covered: true, failed: ["city"] }));
    return () => {
      live = false;
    };
  }, [coords?.lat, coords?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  let body: React.ReactNode;
  if (!coords && !settled) {
    body = "Finding the property on the map…";
  } else if (!coords) {
    body = "No map location for this property yet, so the city zoning map can't be checked.";
  } else if (!result) {
    body = "Checking the city's zoning map…";
  } else if (result.matches.length > 0) {
    body = (
      <ul className="grid gap-2">
        {result.matches.map((z) => (
          <li key={`${z.city}-${z.code}`}>
            {z.noZoning ? (
              <>
                <div>
                  <span className="font-semibold">{z.code}</span>
                  <span className="text-muted-foreground"> · {z.jurisdiction}</span>
                </div>
                <p className="mt-0.5">{z.description}</p>
              </>
            ) : (
              <div>
                <span className="font-semibold">{z.code}</span>
                {z.description && <span> — {z.description}</span>}
                <span className="text-muted-foreground"> · {z.jurisdiction}</span>
              </div>
            )}
            {(z.plannedDevelopment || z.ordinance || z.link) && (
              <div className="text-xs text-muted-foreground">
                {z.plannedDevelopment && <span>Planned development {z.plannedDevelopment}. </span>}
                {z.ordinance && <span>Ordinance {z.ordinance}. </span>}
                {z.link && (
                  <a
                    href={z.link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent underline"
                  >
                    Zoning document
                  </a>
                )}
              </div>
            )}
            <a
              href={z.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-accent underline"
            >
              Source: {z.jurisdiction} {z.noZoning ? "city limits" : "zoning map"}{" "}
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
    );
  } else if (result.failed.length > 0) {
    body = `The ${result.failed.join(", ")} zoning map couldn't be read right now. Try again later.`;
  } else if (result.covered) {
    // a nearby city's map was checked and has nothing here: either outside
    // every city (unincorporated land isn't zoned) or in a city not connected
    body =
      "No connected city zoning map has a district at this point. The property may be outside city limits (unincorporated county land isn't zoned) or in a city whose map isn't connected yet — upload a zoning verification letter if zoning matters to the value.";
  } else {
    body =
      "This property's city zoning map isn't connected yet. Upload a zoning verification letter or the city's zoning map page if zoning matters to the value.";
  }

  return (
    <section className="card-elev min-w-0 p-4 text-sm" aria-label="City zoning">
      <h3 className="mb-1 flex items-center gap-2 font-semibold">
        <Landmark className="h-4 w-4" aria-hidden /> Official city zoning
      </h3>
      <div className={result?.matches.length ? "" : "text-muted-foreground"}>{body}</div>
    </section>
  );
}
