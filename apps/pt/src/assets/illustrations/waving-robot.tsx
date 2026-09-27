// Same illustration palette as the app's other mascot art (navy #0a2b52 for outlines/
// features, gold #eab308, teal #14b8a6) and the same proportions/pivot points as the
// waving-bear illustration it replaces, so it drops into the same hero slot with no layout
// changes — reuses .hero-wave-arm (styles.css) for the continuous wave and
// .hero-mascot-emerge for the one-time pop-in.
export function WavingRobotIllustration({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 180" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="50" cy="176" rx="25" ry="4.5" fill="#0a2b52" opacity="0.12" />

      {/* Legs */}
      <rect x="35" y="122" width="13" height="42" rx="5" fill="#14b8a6" />
      <rect x="52" y="122" width="13" height="42" rx="5" fill="#14b8a6" />
      <rect x="33" y="160" width="17" height="7" rx="3.5" fill="#0a2b52" />
      <rect x="50" y="160" width="17" height="7" rx="3.5" fill="#0a2b52" />

      {/* Static arm (down at side) */}
      <rect
        x="21"
        y="76"
        width="12"
        height="34"
        rx="5"
        fill="#c7d2e0"
        transform="rotate(8 27 76)"
      />
      <rect
        x="18"
        y="106"
        width="14"
        height="12"
        rx="4"
        fill="#8fa0b8"
        transform="rotate(8 25 112)"
      />

      {/* Body / chassis */}
      <rect x="28" y="60" width="44" height="44" rx="14" fill="#c7d2e0" />
      <rect x="34" y="82" width="32" height="38" rx="10" fill="#14b8a6" />
      <rect
        x="35"
        y="70"
        width="7"
        height="18"
        rx="3.5"
        fill="#14b8a6"
        transform="rotate(-8 38.5 79)"
      />
      <rect
        x="58"
        y="70"
        width="7"
        height="18"
        rx="3.5"
        fill="#14b8a6"
        transform="rotate(8 61.5 79)"
      />
      {/* Chest power core */}
      <circle cx="50" cy="94" r="6" fill="#0a2b52" opacity="0.15" />
      <circle cx="50" cy="94" r="4" fill="#eab308" />

      {/* Antenna */}
      <rect x="48.5" y="6" width="3" height="14" rx="1.5" fill="#0a2b52" />
      <circle cx="50" cy="6" r="4.5" fill="#eab308" />

      {/* Head / screen */}
      <rect
        x="26"
        y="20"
        width="48"
        height="40"
        rx="16"
        fill="#eef2f6"
        stroke="#0a2b52"
        strokeWidth="2"
      />
      {/* Side bolts */}
      <circle cx="24" cy="40" r="4" fill="#8fa0b8" />
      <circle cx="76" cy="40" r="4" fill="#8fa0b8" />
      {/* Visor / face screen */}
      <rect x="33" y="28" width="34" height="24" rx="10" fill="#0a2b52" />
      {/* Eyes */}
      <circle cx="43" cy="40" r="3.4" fill="#14b8a6" />
      <circle cx="57" cy="40" r="3.4" fill="#14b8a6" />
      <circle cx="44" cy="39" r="1" fill="#eef2f6" />
      <circle cx="58" cy="39" r="1" fill="#eef2f6" />
      {/* Smile */}
      <path
        d="M43 46 Q50 51 57 46"
        stroke="#14b8a6"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />

      {/* Waving arm — same shoulder pivot (72, 76) as the bear it replaces, so
          .hero-wave-arm's transform-origin still lines up; a three-finger claw
          instead of a paw reads as mechanical rather than furry. */}
      <g className="hero-wave-arm" style={{ transformOrigin: "72px 76px" }}>
        <rect
          x="65.5"
          y="32"
          width="12"
          height="44"
          rx="5"
          fill="#c7d2e0"
          transform="rotate(20 71.5 76)"
        />
        <circle cx="88" cy="33" r="5.2" fill="#8fa0b8" />
        <rect
          x="83"
          y="24"
          width="2.6"
          height="8"
          rx="1.3"
          fill="#8fa0b8"
          transform="rotate(-16 84.3 28)"
        />
        <rect
          x="86.7"
          y="21.5"
          width="2.6"
          height="9"
          rx="1.3"
          fill="#8fa0b8"
          transform="rotate(0 88 26)"
        />
        <rect
          x="90.4"
          y="24"
          width="2.6"
          height="8"
          rx="1.3"
          fill="#8fa0b8"
          transform="rotate(16 91.7 28)"
        />
      </g>
    </svg>
  );
}
