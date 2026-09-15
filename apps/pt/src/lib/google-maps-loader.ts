// Lazily loads the Google Maps JavaScript API script exactly once, however
// many times/places call this — MapPinPicker mounts fresh on every open (the
// homepage hero AND the intake page both use it), and without memoizing the
// in-flight promise each open would inject a second/third <script> tag,
// which Google's own loader logs a "You have included the Google Maps
// JavaScript API multiple times" warning for and can leave `window.google`
// briefly inconsistent between them.
let loaderPromise: Promise<void> | null = null;

const CALLBACK_NAME = "__corvusptGoogleMapsReady";

export function loadGoogleMaps(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps can only load in a browser."));
  }
  if (window.google?.maps) return Promise.resolve();
  if (loaderPromise) return loaderPromise;

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  if (!apiKey) {
    return Promise.reject(
      new Error(
        "Map search isn't configured yet — set VITE_GOOGLE_MAPS_API_KEY (see .env.example).",
      ),
    );
  }

  loaderPromise = new Promise<void>((resolve, reject) => {
    (window as unknown as Record<string, () => void>)[CALLBACK_NAME] = () => resolve();
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=weekly&loading=async&callback=${CALLBACK_NAME}`;
    script.async = true;
    script.onerror = () => {
      loaderPromise = null;
      reject(new Error("Could not load Google Maps. Check your connection and try again."));
    };
    document.head.appendChild(script);
  });

  return loaderPromise;
}

// Google's dedicated global callback for auth-class failures — an invalid
// key, a referrer the key doesn't allow, or an API that isn't enabled (see
// https://developers.google.com/maps/documentation/javascript/events#auth-errors).
// Deliberately NOT wired into loadGoogleMaps()'s own promise above: confirmed
// live chasing a real RefererNotAllowedMapError that this class of failure
// fires only once a map actually tries to fetch tiles, which happens AFTER
// the base script has already loaded and already called `callback` (so
// loadGoogleMaps()'s promise has already resolved "successfully" by the time
// gm_authFailure fires — rejecting it there would be a no-op on an
// already-settled promise). A caller that's already past the initial load
// and showing what LOOKS like a ready map still needs to hear about this, so
// it's a standalone, ongoing subscription instead — call the returned
// cleanup function when done listening (e.g. on unmount).
type AuthFailureListener = () => void;
const authFailureListeners = new Set<AuthFailureListener>();

export function onGoogleMapsAuthFailure(listener: AuthFailureListener): () => void {
  const w = window as unknown as Record<string, unknown>;
  if (!w.gm_authFailure) {
    w.gm_authFailure = () => {
      authFailureListeners.forEach((fn) => fn());
    };
  }
  authFailureListeners.add(listener);
  return () => authFailureListeners.delete(listener);
}
