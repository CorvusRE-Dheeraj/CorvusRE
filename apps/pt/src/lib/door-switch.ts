// Moving between CorvusRE doors (CorvusPT ↔ CorvusDP) asks for the password
// again. The browser remembers which door it last actually signed in to
// ("corvusre.activeDoor", written by the shared /auth/ page on a real sign-in,
// and by a door's own sign-in screen). A door opened with a session that was
// signed in for the OTHER door sends the visitor to /auth/ with ?switch=1,
// where they sign in again; the session alone no longer carries them across.
// Same file in apps/pt and apps/dp — keep them identical.
export type Door = "corvuspt" | "corvusdp";

const ACTIVE_DOOR_KEY = "corvusre.activeDoor";
const DOOR_NAME: Record<Door, string> = { corvuspt: "CorvusPT", corvusdp: "CorvusDP" };

export function getActiveDoor(): Door | null {
  try {
    const d = localStorage.getItem(ACTIVE_DOOR_KEY);
    return d === "corvuspt" || d === "corvusdp" ? d : null;
  } catch {
    return null;
  }
}

export function setActiveDoor(door: Door) {
  try {
    localStorage.setItem(ACTIVE_DOOR_KEY, door);
  } catch {
    // storage blocked — nothing to remember, so no switch prompts either
  }
}

/**
 * True when this browser last signed in to the OTHER door, so this one must
 * ask again. A browser that never recorded a door (signed in before this
 * existed) adopts this door, so nobody already signed in is thrown out.
 */
export function mustSignInAgain(door: Door): boolean {
  const active = getActiveDoor();
  if (!active) {
    setActiveDoor(door);
    return false;
  }
  return active !== door;
}

/**
 * Full-page trip to the shared sign-in, back to this exact page afterwards.
 * replace(), not assign(): this page is only a "Loading…" placeholder while
 * it hands off, so it mustn't stay in history — otherwise Back from the
 * sign-in screen lands on it (restored frozen from the back-forward cache) and
 * sits on "Loading…" for good. Back now returns to the page before the door.
 */
export function sendToSwitchSignIn(door: Door) {
  const back = `${window.location.pathname}${window.location.search}`;
  const reason = `Please sign in again to continue to ${DOOR_NAME[door]}.`;
  window.location.replace(
    `/auth/?redirect=${encodeURIComponent(back)}&switch=1&reason=${encodeURIComponent(reason)}`,
  );
}
