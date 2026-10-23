// The Track Map's travelling light, as drawn on the line's centre-line shapes
// (RouteTrack's paths, RouteConnector's link). useTrackLight on the Track Map
// page animates every shape's dashes on one clock.

/** Length of the travelling light along the line, px. */
export const TRACK_LIGHT = 64;

/** The light's two dashes on one centre-line shape — a wide soft dash plus a
 *  shorter bright core — parked before the shape's start until animated.
 *  `at`: px along the stretch (route track or link) where the shape starts. */
export function trackLightDashes(at: number) {
  return [
    { stroke: "#bbf7d0", strokeOpacity: 0.5, dash: TRACK_LIGHT },
    { stroke: "#f0fdf4", strokeOpacity: 0.7, dash: TRACK_LIGHT / 2 },
  ].map(({ dash, ...paint }) => ({
    ...paint,
    className: "track-light-dash",
    strokeDasharray: `${dash} 100000`,
    strokeDashoffset: TRACK_LIGHT,
    "data-dash": dash,
    "data-light-at": at,
  }));
}
