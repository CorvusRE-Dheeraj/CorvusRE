import { useEffect, useRef, useState } from "react";
import { MapPin, LocateFixed } from "lucide-react";
import { Modal } from "@/components/Modal";
import { loadGoogleMaps, onGoogleMapsAuthFailure } from "@/lib/google-maps-loader";

// Close enough to see individual parcels/buildings once centered on a real
// current-location fix — the statewide default (TEXAS_ZOOM) would still
// leave the user squinting at a whole region.
const CURRENT_LOCATION_ZOOM = 17;

// Statewide view (roughly the geographic center of Texas) — this app only
// serves Texas properties (see AddressAutocomplete's own TEXAS_RECTANGLE),
// so opening centered anywhere else would just make the user pan/zoom to
// find their own property first.
const TEXAS_CENTER = { lat: 31.0, lng: -99.5 };
const TEXAS_ZOOM = 6;
// Same numbers as AddressAutocomplete's own TEXAS_RECTANGLE, just in the
// shape google.maps.Map's `restriction` option wants (north/south/east/west
// rather than low/high corners). Passed to the map itself (elastic —
// panning past the edge bounces back rather than hard-stopping) AND checked
// per-click before ever calling the Geocoder — confirmed live a user can
// otherwise freely scroll/zoom the whole world map and drop a pin in
// Mexico, where the app has no CAD data at all and "Use This Location"
// staying disabled had no explanation on screen.
const TEXAS_BOUNDS = { north: 36.5, south: 25.8, east: -93.5, west: -106.7 };
function isWithinTexas(position: google.maps.LatLng): boolean {
  const lat = position.lat();
  const lng = position.lng();
  return (
    lat >= TEXAS_BOUNDS.south &&
    lat <= TEXAS_BOUNDS.north &&
    lng >= TEXAS_BOUNDS.west &&
    lng <= TEXAS_BOUNDS.east
  );
}

type Status = "loading" | "ready" | "error";

// A reverse-geocode at an exact lat/lng returns several candidate results,
// roughly ordered by relevance to that exact point — NOT by which one is
// most useful as a mailing/CAD-lookup address. Confirmed live: a real point
// right off a Texas highway returned a "premise"+"street_address" result AND
// a "plus_code"-only result ("C8XC+X2 Ranger, TX, USA") in the same
// response, with the plus code sometimes ranked first depending on the exact
// spot clicked. A Plus Code is Google's own fallback grid-cell label for
// "no real address here" — it has no house number and would never match
// anything in cad-lookup, but would otherwise get silently accepted as if it
// were a normal address. Prefers the most specific real-address type
// available; returns null (not a plus code) when nothing better exists, so
// the UI can tell the user this exact spot has no address on file instead of
// confidently offering one that's guaranteed to fail the next step.
const ADDRESS_TYPE_PREFERENCE = ["street_address", "premise", "subpremise", "route"];
function pickBestReverseGeocodeResult(results: google.maps.GeocoderResult[]): string | null {
  for (const type of ADDRESS_TYPE_PREFERENCE) {
    const match = results.find((r) => r.types.includes(type));
    if (match) return match.formatted_address;
  }
  return null;
}

export function MapPinPicker({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (address: string) => void;
}) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  // placePin() itself is defined inside the load effect below (it closes
  // over that effect's own `cancelled` flag and the just-created `map`
  // instance) — stashed here so the "Use My Current Location" button, which
  // lives outside that effect, can still trigger the exact same drop-a-pin
  // path a map click does, rather than duplicating it.
  const placePinRef = useRef<((position: google.maps.LatLng) => void) | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pinPlaced, setPinPlaced] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [outsideTexas, setOutsideTexas] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Registered before loadGoogleMaps() even starts (not just after the map
    // is created) — some auth failures (e.g. a malformed key) can fire
    // before the base script ever calls back at all, and others (e.g. a
    // referrer the key doesn't allow) only surface once the map underneath
    // an already-"ready" UI tries to fetch tiles. Either way this is the one
    // place that needs to know, regardless of which stage it happens at.
    const stopListening = onGoogleMapsAuthFailure(() => {
      if (cancelled) return;
      setStatus("error");
      setErrorMessage(
        "Google Maps rejected this request (invalid key, an API that isn't enabled, or this " +
          "domain isn't on the key's allowed list) — check the Google Cloud Console setup.",
      );
    });

    function reverseGeocode(position: google.maps.LatLng) {
      // Checked before ever calling the Geocoder, not after — this app has
      // no CAD data outside Texas at all, so there's no point spending an
      // API call to find out what's there. Confirmed live: without this, a
      // pin dropped in Mexico (freely reachable by panning/zooming out far
      // enough) just left "Use This Location" disabled with zero
      // explanation on screen.
      if (!isWithinTexas(position)) {
        setResolving(false);
        setResolvedAddress(null);
        setOutsideTexas(true);
        return;
      }
      setOutsideTexas(false);
      setResolving(true);
      setResolvedAddress(null);
      geocoderRef.current!.geocode({ location: position }, (results, geoStatus) => {
        if (cancelled) return;
        setResolving(false);
        setResolvedAddress(
          geoStatus === "OK" && results ? pickBestReverseGeocodeResult(results) : null,
        );
      });
    }

    function placePin(map: google.maps.Map, position: google.maps.LatLng) {
      if (!markerRef.current) {
        markerRef.current = new google.maps.Marker({ position, map, draggable: true });
        markerRef.current.addListener("dragend", () => {
          const pos = markerRef.current?.getPosition();
          if (pos) reverseGeocode(pos);
        });
      } else {
        markerRef.current.setPosition(position);
      }
      setPinPlaced(true);
      reverseGeocode(position);
    }

    loadGoogleMaps()
      .then(() => {
        if (cancelled || !mapDivRef.current) return;
        const map = new google.maps.Map(mapDivRef.current, {
          center: TEXAS_CENTER,
          zoom: TEXAS_ZOOM,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
          // Elastic, not a hard wall (strictBounds: false) — panning past
          // the edge bounces back rather than refusing to move at all,
          // Google Maps' own standard "you can look around here" pattern.
          restriction: { latLngBounds: TEXAS_BOUNDS, strictBounds: false },
        });
        mapRef.current = map;
        geocoderRef.current = new google.maps.Geocoder();
        placePinRef.current = (position) => placePin(map, position);
        map.addListener("click", (e: google.maps.MapMouseEvent) => {
          if (e.latLng) placePin(map, e.latLng);
        });
        setStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : "Could not load the map.");
      });

    return () => {
      cancelled = true;
      stopListening();
      placePinRef.current = null;
    };
  }, []);

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setLocationError("This browser doesn't support location access.");
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const latLng = new google.maps.LatLng(pos.coords.latitude, pos.coords.longitude);
        // Order matters here — confirmed live chasing a real bug: with the
        // map's `restriction` (Texas bounds) active, calling panTo() BEFORE
        // setZoom() silently corrupts the resulting center (drifted several
        // degrees of longitude off, landing on empty rural land far from the
        // real point — a "blank map" that wasn't actually blank, just
        // pointed somewhere else entirely). setZoom() first, then
        // setCenter() (equivalent to panTo() for an instant jump, no pan
        // animation needed here) avoids it entirely — same real coordinates,
        // reordered.
        mapRef.current?.setZoom(CURRENT_LOCATION_ZOOM);
        mapRef.current?.setCenter(latLng);
        placePinRef.current?.(latLng);
      },
      (err) => {
        setLocating(false);
        // PERMISSION_DENIED (1) is by far the common real-world case (the
        // browser's own permission prompt was declined) — worth its own
        // clearer copy rather than the generic message every other
        // GeolocationPositionError code falls back to.
        setLocationError(
          err.code === err.PERMISSION_DENIED
            ? "Location access was denied — allow it in your browser's site settings, or just click on the map instead."
            : "Couldn't get your current location. Try clicking on the map instead.",
        );
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  return (
    <Modal onClose={onClose} wide>
      {/* flex-wrap — confirmed live on a narrow mobile viewport that without
          it, the fixed-width button and the title (wrapping to 3 lines in
          whatever narrow column was left beside it) fought for the same row
          and visually collided/overlapped. Wrapping drops the button to its
          own line below the title instead once there's not enough width. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <MapPin className="h-5 w-5 shrink-0 text-accent" />
          <h3 className="font-serif text-xl font-semibold">Pin your property on the map</h3>
        </div>
        <button
          type="button"
          onClick={useCurrentLocation}
          disabled={status !== "ready" || locating}
          className="btn-outline shrink-0 gap-1.5 text-sm py-1.5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <LocateFixed className="h-3.5 w-3.5" />
          {locating ? "Locating…" : "Use My Current Location"}
        </button>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Click anywhere on the map to drop a pin, or drag it to fine-tune the exact spot — we'll look
        up the address for you.
      </p>
      {locationError && <p className="mt-1 text-sm text-destructive">{locationError}</p>}

      <div className="relative mt-4">
        <div ref={mapDivRef} className="h-[420px] w-full rounded-lg border border-border" />
        {status === "loading" && (
          <div className="absolute inset-0 grid place-items-center rounded-lg bg-secondary/70">
            <span className="text-sm text-muted-foreground">Loading map…</span>
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 grid place-items-center rounded-lg bg-secondary/90 p-6 text-center">
            <p className="text-sm text-destructive">{errorMessage}</p>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 text-sm">
          {status === "ready" && !pinPlaced && (
            <p className="text-muted-foreground">No pin placed yet — click on the map to start.</p>
          )}
          {resolving && <p className="text-muted-foreground">Finding the address…</p>}
          {!resolving && resolvedAddress && (
            <p className="truncate font-medium" title={resolvedAddress}>
              {resolvedAddress}
            </p>
          )}
          {!resolving && outsideTexas && (
            <p className="text-destructive">
              That's outside Texas — CorvusPT only covers Texas properties. Try pinning somewhere
              within the state.
            </p>
          )}
          {!resolving && pinPlaced && !resolvedAddress && !outsideTexas && (
            <p className="text-destructive">
              Couldn't find an address at this exact spot — try dropping the pin somewhere else.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => resolvedAddress && onConfirm(resolvedAddress)}
          disabled={!resolvedAddress || resolving}
          className="btn-primary btn-primary-hover shrink-0 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Use This Location
        </button>
      </div>
    </Modal>
  );
}
