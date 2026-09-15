// Original SVG (not the pasted reference mascot — that had the look of
// licensed stock clipart, unclear usage rights, and was never saved as a
// project file to begin with) built in the same spirit — cap, overalls,
// a friendly grin, one waving paw — using the app's own illustration
// palette (navy #0a2b52 for outlines/features, gold #eab308, teal #14b8a6)
// instead of copying the reference's exact colors/proportions. Reuses the
// same .hero-wave-arm animation (styles.css) as the illustration this
// replaces, so the paw waves continuously the same way that arm did.
export function WavingBearIllustration({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 180" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="50" cy="176" rx="25" ry="4.5" fill="#0a2b52" opacity="0.12" />

      {/* Legs (overalls) */}
      <rect x="35" y="122" width="13" height="42" rx="6.5" fill="#14b8a6" />
      <rect x="52" y="122" width="13" height="42" rx="6.5" fill="#14b8a6" />
      <ellipse cx="41.5" cy="165" rx="9" ry="5.5" fill="#a9744a" />
      <ellipse cx="58.5" cy="165" rx="9" ry="5.5" fill="#a9744a" />

      {/* Static arm (down at side) */}
      <rect x="21" y="76" width="13" height="34" rx="6.5" fill="#a9744a" transform="rotate(8 27.5 76)" />
      <circle cx="24" cy="112" r="7.5" fill="#a9744a" />

      {/* Body fur peeking above the overalls bib */}
      <rect x="30" y="62" width="40" height="40" rx="16" fill="#a9744a" />

      {/* Overalls bib + straps */}
      <rect x="34" y="82" width="32" height="40" rx="10" fill="#14b8a6" />
      <rect x="35" y="70" width="7" height="18" rx="3.5" fill="#14b8a6" transform="rotate(-8 38.5 79)" />
      <rect x="58" y="70" width="7" height="18" rx="3.5" fill="#14b8a6" transform="rotate(8 61.5 79)" />
      <circle cx="50" cy="94" r="3.4" fill="#eab308" />

      {/* Head */}
      <circle cx="34" cy="30" r="10" fill="#a9744a" />
      <circle cx="66" cy="30" r="10" fill="#a9744a" />
      <circle cx="34" cy="30" r="5" fill="#f3d9b1" />
      <circle cx="66" cy="30" r="5" fill="#f3d9b1" />
      <circle cx="50" cy="44" r="24" fill="#a9744a" />

      {/* Cap */}
      <path d="M25 34 Q25 12 50 12 Q75 12 75 34 Q62 26 50 26 Q38 26 25 34 Z" fill="#eab308" />
      <path d="M25 34 Q19 35 15 33" stroke="#eab308" strokeWidth="6" strokeLinecap="round" fill="none" />

      {/* Muzzle */}
      <ellipse cx="50" cy="52" rx="13" ry="10" fill="#f3d9b1" />
      <ellipse cx="50" cy="46" rx="4" ry="3" fill="#0a2b52" />
      <path d="M44 55 Q50 60 56 55" stroke="#0a2b52" strokeWidth="2" strokeLinecap="round" fill="none" />

      {/* Eyes */}
      <circle cx="41" cy="43" r="2.6" fill="#0a2b52" />
      <circle cx="59" cy="43" r="2.6" fill="#0a2b52" />
      <circle cx="42" cy="42" r="0.8" fill="#fff" />
      <circle cx="60" cy="42" r="0.8" fill="#fff" />

      {/* Waving arm — drawn last (on top of the head/cap) and swung well
          clear of the head's silhouette (never closer than x=84, vs. the
          head's own rightmost point at x=76) so raising it never lets the
          head paint over the paw. Both the static rotate() below and the
          .hero-wave-arm animation's transform-origin pivot on the same
          shoulder point (72, 76) so they compose around one consistent
          joint. */}
      <g className="hero-wave-arm" style={{ transformOrigin: "72px 76px" }}>
        <rect x="65.5" y="32" width="13" height="44" rx="6.5" fill="#a9744a" transform="rotate(20 72 76)" />
        {/* Palm + 4 splayed fingers (an open paw, not a bare circle) fanned
            out from the top of the palm so the "hi!" read is unmistakable. */}
        <circle cx="88" cy="33" r="4.7" fill="#a9744a" />
        <rect x="82.15" y="25.15" width="2.3" height="4.7" rx="1.15" fill="#a9744a" transform="rotate(-22 83.3 29.85)" />
        <rect x="85.25" y="22.8" width="2.3" height="4.7" rx="1.15" fill="#a9744a" transform="rotate(-7 86.4 27.5)" />
        <rect x="88.45" y="22.8" width="2.3" height="4.7" rx="1.15" fill="#a9744a" transform="rotate(7 89.6 27.5)" />
        <rect x="91.55" y="25.15" width="2.3" height="4.7" rx="1.15" fill="#a9744a" transform="rotate(22 92.7 29.85)" />
      </g>
    </svg>
  );
}
