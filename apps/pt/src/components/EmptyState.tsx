import type { ReactNode } from "react";

export type EmptyKind = "properties" | "documents" | "deadlines" | "hearings" | "bills" | "reports";

// Small, friendly inline illustrations — soft gradient shapes with a floating accent —
// so an empty page invites the next step instead of just saying "nothing here".
function Art({ kind }: { kind: EmptyKind }) {
  const g = {
    properties: ["#10b981", "#0ea5e9"],
    documents: ["#0ea5e9", "#6366f1"],
    deadlines: ["#f59e0b", "#f43f5e"],
    hearings: ["#8b5cf6", "#d946ef"],
    bills: ["#14b8a6", "#3b82f6"],
    reports: ["#10b981", "#84cc16"],
  }[kind];
  const id = `es-${kind}`;
  return (
    <svg viewBox="0 0 160 120" className="tu-float h-28 w-36" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={g[0]} />
          <stop offset="1" stopColor={g[1]} />
        </linearGradient>
      </defs>
      <ellipse cx="80" cy="108" rx="52" ry="7" fill="currentColor" opacity="0.08" />
      {kind === "properties" && (
        <>
          <rect x="34" y="52" width="46" height="52" rx="6" fill={`url(#${id})`} />
          <rect x="72" y="30" width="54" height="74" rx="6" fill={`url(#${id})`} opacity="0.75" />
          {[0, 1, 2].map((r) =>
            [0, 1].map((c) => (
              <rect
                key={`${r}${c}`}
                x={82 + c * 20}
                y={40 + r * 20}
                width="10"
                height="12"
                rx="2"
                fill="#fff"
                opacity="0.85"
              />
            )),
          )}
          <rect x="46" y="66" width="10" height="12" rx="2" fill="#fff" opacity="0.85" />
          <rect x="46" y="86" width="10" height="18" rx="2" fill="#fff" opacity="0.6" />
        </>
      )}
      {kind === "documents" && (
        <>
          <rect
            x="46"
            y="22"
            width="60"
            height="78"
            rx="8"
            fill={`url(#${id})`}
            opacity="0.5"
            transform="rotate(-8 76 61)"
          />
          <rect x="52" y="20" width="60" height="80" rx="8" fill={`url(#${id})`} />
          {[0, 1, 2, 3].map((i) => (
            <rect
              key={i}
              x="62"
              y={36 + i * 14}
              width={i === 3 ? 22 : 40}
              height="6"
              rx="3"
              fill="#fff"
              opacity="0.85"
            />
          ))}
        </>
      )}
      {(kind === "deadlines" || kind === "hearings") && (
        <>
          <rect x="34" y="26" width="92" height="76" rx="10" fill={`url(#${id})`} />
          <rect x="34" y="26" width="92" height="20" rx="10" fill="#000" opacity="0.12" />
          <rect x="52" y="16" width="8" height="18" rx="4" fill="#fff" />
          <rect x="100" y="16" width="8" height="18" rx="4" fill="#fff" />
          {[0, 1, 2].map((r) =>
            [0, 1, 2, 3].map((c) => (
              <rect
                key={`${r}${c}`}
                x={46 + c * 21}
                y={56 + r * 15}
                width="12"
                height="9"
                rx="2"
                fill="#fff"
                opacity={r === 1 && c === 2 ? 1 : 0.55}
              />
            )),
          )}
        </>
      )}
      {kind === "bills" && (
        <>
          <path d="M44 20h72v78l-9-6-9 6-9-6-9 6-9-6-9 6-9-6z" fill={`url(#${id})`} />
          {[0, 1, 2].map((i) => (
            <rect
              key={i}
              x="56"
              y={36 + i * 14}
              width={i === 2 ? 26 : 48}
              height="6"
              rx="3"
              fill="#fff"
              opacity="0.85"
            />
          ))}
          <circle cx="102" cy="76" r="9" fill="#fff" opacity="0.9" />
          <text x="102" y="80" textAnchor="middle" fontSize="11" fontWeight="700" fill={g[1]}>
            $
          </text>
        </>
      )}
      {kind === "reports" && (
        <>
          <rect x="36" y="64" width="18" height="36" rx="4" fill={`url(#${id})`} opacity="0.6" />
          <rect x="62" y="46" width="18" height="54" rx="4" fill={`url(#${id})`} opacity="0.8" />
          <rect x="88" y="28" width="18" height="72" rx="4" fill={`url(#${id})`} />
          <path
            d="M40 52l30-18 26-4"
            stroke={g[1]}
            strokeWidth="4"
            strokeLinecap="round"
            fill="none"
          />
        </>
      )}
      <circle cx="132" cy="30" r="6" fill={g[0]} opacity="0.5" />
      <circle cx="24" cy="44" r="4" fill={g[1]} opacity="0.5" />
    </svg>
  );
}

// A centred card: illustration, a headline, one line of guidance and (optionally) the
// button for the next step.
export function EmptyState({
  kind,
  title,
  children,
  action,
  compact = false,
}: {
  kind: EmptyKind;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={`card-elev tu-rise flex flex-col items-center text-center text-muted-foreground ${
        compact ? "p-5" : "p-8"
      }`}
    >
      <Art kind={kind} />
      <h3 className="mt-2 font-serif text-lg font-semibold text-foreground">{title}</h3>
      {children && <p className="mt-1 max-w-md text-sm">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
