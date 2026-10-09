import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useRouterState } from "@tanstack/react-router";

const KEY = "corvuspt.tourSeen";
export const OPEN_TOUR_EVENT = "corvuspt:open-tour";

// Starts the tour once, but only when no other dialog (terms, profile details) is in the way —
// it waits and re-checks so the required sign-up steps always come first. Returns a cancel fn.
export function maybeStartTour(): () => void {
  let tries = 0;
  const id = window.setInterval(() => {
    if (++tries > 80) return window.clearInterval(id);
    if (document.querySelector("[role=dialog],[role=alertdialog],[data-blocking-dialog]")) return;
    window.clearInterval(id);
    try {
      if (localStorage.getItem(KEY) !== "1") window.dispatchEvent(new Event(OPEN_TOUR_EVENT));
    } catch {
      // storage blocked — skip the automatic tour
    }
  }, 1500);
  return () => window.clearInterval(id);
}

// Each step points at a real element tagged `data-tour="<target>"` (AppShell's tab bar,
// SiteChrome's header, the dashboard's Quick Actions). A step whose element isn't on
// screen — the help button is hidden on phones, Add Property only exists on /dashboard
// — is skipped rather than pointing at nothing. No target = a centered intro.
type Step = { target?: string; text: string };
const STEPS: Step[] = [
  {
    text: "Welcome to CorvusPT! Would you like a quick tour of what's in your dashboard?",
  },
  {
    target: "add-property",
    text: "Start here — add a property by address or appraisal notice, and our AI checks whether you have a case.",
  },
  {
    target: "next-actions",
    text: "Your most urgent tasks — due this week — are always at the top.",
  },
  { target: "portfolio", text: "Your properties, documents, cases and savings at a glance." },
  {
    target: "protest-intelligence",
    text: "Protest Intelligence: is there a case, what value to argue, and how strong it is — per property.",
  },
  { target: "nav-properties", text: "All your properties are listed here." },
  {
    target: "nav-documents",
    text: "Keep your notices, photos and evidence here — AI files each one under the right property.",
  },
  { target: "nav-calendar", text: "Deadlines and hearings show up on your calendar." },
  { target: "nav-issues", text: "Track code violations and other property issues here." },
  { target: "nav-acquisition", text: "Thinking of buying? Forecast a property's future tax bill." },
  { target: "nav-agreements", text: "Your signed agreements and authorization forms." },
  {
    target: "tax-updates",
    text: "Texas property tax law changes and upcoming deadlines, checked every week.",
  },
  { target: "notifications", text: "We'll remind you here before every deadline and hearing." },
  { target: "ask-ai", text: "Ask AI anything about your properties, cases or Texas property tax." },
  { target: "help", text: "Questions? Help, a plain-English glossary and this tour live here." },
  { target: "profile", text: "View / update your contact information, billing and settings here." },
];

function findTarget(step: Step): HTMLElement | null {
  if (!step.target) return null;
  const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? el : null;
}

function isAvailable(step: Step): boolean {
  return !step.target || findTarget(step) !== null;
}

type Box = { top: number; left: number; width: number; height: number };
const PAD = 8; // spotlight padding around the target
const GAP = 96; // room between the spotlight and the caption for the arrow
const DIM = "rgba(8, 15, 25, 0.82)";
// Keeps the caption readable over whatever page text sits behind it.
const CAPTION_SHADOW = "0 1px 3px rgba(0, 0, 0, 0.9), 0 0 14px rgba(0, 0, 0, 0.7)";

function toBox(r: DOMRect): Box {
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

// A hand-drawn-looking arrow: a quadratic curve bowed to one side, with an open arrowhead
// angled along the curve's tangent at the tip.
function arrowPath(sx: number, sy: number, ex: number, ey: number): string {
  const mx = (sx + ex) / 2;
  const my = (sy + ey) / 2;
  const dx = ex - sx;
  const dy = ey - sy;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(48, len * 0.35);
  const cx = mx + (-dy / len) * bow;
  const cy = my + (dx / len) * bow;
  const angle = Math.atan2(ey - cy, ex - cx);
  const head = 14;
  const spread = 0.5;
  const h1x = ex - head * Math.cos(angle - spread);
  const h1y = ey - head * Math.sin(angle - spread);
  const h2x = ex - head * Math.cos(angle + spread);
  const h2y = ey - head * Math.sin(angle + spread);
  return `M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey} M ${h1x} ${h1y} L ${ex} ${ey} L ${h2x} ${h2y}`;
}

// A short first-visit walkthrough that dims the page and spotlights each part of the
// dashboard in turn. Shows once per browser, and can be reopened from the ? menu.
export function WelcomeTour() {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const [target, setTarget] = useState<Box | null>(null);
  const [caption, setCaption] = useState<Box | null>(null);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const captionRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const onDashboard = /\/dashboard\/?$/.test(pathname);
  // Opened from the ? menu on another page, the tour would only find the
  // header (4 steps) — it walks the dashboard, so go there first.
  useEffect(() => {
    const show = () => {
      if (!onDashboard) void navigate({ to: "/dashboard" });
      setI(0);
      setOpen(true);
    };
    window.addEventListener(OPEN_TOUR_EVENT, show);
    return () => window.removeEventListener(OPEN_TOUR_EVENT, show);
  }, [onDashboard, navigate]);

  const close = useCallback(() => {
    setOpen(false);
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      // harmless
    }
  }, []);

  const step = STEPS[i];
  // Only look at the DOM while open — this component is also server-rendered, where
  // there's no `document` at all.
  const nextIndex = open ? STEPS.findIndex((s, n) => n > i && isAvailable(s)) : -1;
  const last = nextIndex === -1;

  function next() {
    // Re-check at click time — the dashboard may have finished loading since
    // this step rendered (the tour can open before its sections exist).
    const n = STEPS.findIndex((s, k) => k > i && isAvailable(s));
    if (n === -1) close();
    else setI(n);
  }

  // Bring the step's element into view (the tab strip scrolls sideways on phones).
  useEffect(() => {
    if (!open) return;
    const el = findTarget(step);
    if (el) {
      // Center it vertically only when it's (partly) off screen — sticky header and tab
      // bar items are already visible, and re-centering those would jump the page around.
      const r = el.getBoundingClientRect();
      const offScreen = r.top < 0 || r.bottom > window.innerHeight - 24;
      el.scrollIntoView({
        block: offScreen ? "center" : "nearest",
        inline: "center",
        behavior: "smooth",
      });
    }
    nextRef.current?.focus();
  }, [open, step]);

  // Track the target and caption every frame while open — the header and tab bar are
  // sticky, and the page may still be scrolling or loading, so a one-off measure drifts.
  useLayoutEffect(() => {
    if (!open) return;
    let raf = 0;
    const tick = () => {
      const el = findTarget(step);
      setTarget((prev) => {
        const next = el ? toBox(el.getBoundingClientRect()) : null;
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
      const c = captionRef.current?.getBoundingClientRect();
      setCaption((prev) => {
        const next = c ? toBox(c) : null;
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
      setViewport((prev) =>
        prev.w === window.innerWidth && prev.h === window.innerHeight
          ? prev
          : { w: window.innerWidth, h: window.innerHeight },
      );
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [open, step]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open || typeof document === "undefined") return null;

  const vw = viewport.w || window.innerWidth;
  const vh = viewport.h || window.innerHeight;
  const captionWidth = Math.min(340, vw - 32);

  // Caption goes on whichever side of the target has more room, nudged toward the
  // middle of the screen so the arrow curves in, like a hand-drawn pointer.
  let captionStyle: React.CSSProperties;
  let arrow: string | null = null;
  if (target) {
    const below = target.top + target.height / 2 < vh / 2;
    const cx = target.left + target.width / 2;
    const towardMiddle = cx < vw / 2 ? 70 : -70;
    const left = Math.max(
      16,
      Math.min(vw - 16 - captionWidth, cx + towardMiddle - captionWidth / 2),
    );
    captionStyle = below
      ? { top: target.top + target.height + PAD + GAP, left, width: captionWidth }
      : { bottom: vh - (target.top - PAD - GAP), left, width: captionWidth };
    if (caption) {
      const sx = caption.left + caption.width / 2;
      const sy = below ? caption.top - 10 : caption.top + caption.height + 10;
      const ey = below ? target.top + target.height + PAD + 8 : target.top - PAD - 8;
      arrow = arrowPath(sx, sy, cx, ey);
    }
  } else {
    captionStyle = {
      top: "50%",
      left: "50%",
      width: captionWidth,
      transform: "translate(-50%, -50%)",
    };
  }

  const available = STEPS.filter(isAvailable);
  const position = available.indexOf(step) + 1;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="corvuspt-tour-text"
      className="fixed inset-0 z-[200]"
    >
      {/* Swallows clicks on the dimmed page; the dimming itself is the spotlight's
          giant shadow (or a plain fill on the intro step). */}
      <div
        className="absolute inset-0"
        style={target ? undefined : { background: DIM }}
        aria-hidden="true"
      />
      {target && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-xl motion-safe:transition-all motion-safe:duration-300"
          style={{
            top: target.top - PAD,
            left: target.left - PAD,
            width: target.width + PAD * 2,
            height: target.height + PAD * 2,
            boxShadow: `0 0 0 9999px ${DIM}, 0 0 22px 6px rgba(255, 255, 255, 0.55)`,
          }}
        />
      )}
      {arrow && (
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full">
          <path
            d={arrow}
            fill="none"
            stroke="white"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      <div
        ref={captionRef}
        className="absolute text-center text-white"
        style={{ ...captionStyle, textShadow: CAPTION_SHADOW }}
      >
        <p
          id="corvuspt-tour-text"
          className={`font-medium leading-snug drop-shadow ${target ? "text-lg" : "text-xl sm:text-2xl"}`}
        >
          {step.text}
        </p>
        <div className="mt-3 flex items-center justify-between gap-4 text-base">
          {!last ? (
            <button
              type="button"
              onClick={close}
              className="rounded px-1 font-medium text-sky-300 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            >
              Skip
            </button>
          ) : (
            <span />
          )}
          {available.length > 1 && i > 0 && (
            <span className="text-xs text-white/70">
              {position} of {available.length}
            </span>
          )}
          <button
            ref={nextRef}
            type="button"
            onClick={next}
            className="rounded px-1 font-medium text-sky-300 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
          >
            {last ? "Done" : i === 0 ? "Show me" : "Next"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
