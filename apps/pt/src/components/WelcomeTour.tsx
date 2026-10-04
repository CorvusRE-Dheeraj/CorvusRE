import { useEffect, useState } from "react";
import { Building2, CalendarClock, FileText, Scale, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

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

const SLIDES = [
  {
    icon: Sparkles,
    tone: "from-emerald-600 to-teal-700",
    title: "Welcome to CorvusPT",
    body: "We help you check whether your property tax value is too high, and challenge it if it is. This 30-second tour shows you around.",
  },
  {
    icon: Building2,
    tone: "from-sky-700 to-blue-800",
    title: "1. Add your property",
    body: "Start with your address or your appraisal notice. Our AI pulls your county record and works out if you have a case.",
  },
  {
    icon: FileText,
    tone: "from-amber-700 to-orange-800",
    title: "2. Keep your papers in Documents",
    body: "Upload your notice, photos and evidence. AI files each one under the right property so nothing gets lost.",
  },
  {
    icon: Scale,
    tone: "from-violet-700 to-indigo-800",
    title: "3. Follow your case",
    body: "Each case shows one clear next step: prepare, file, talk to the county, attend a hearing, see the result.",
  },
  {
    icon: CalendarClock,
    tone: "from-rose-700 to-pink-800",
    title: "4. We watch the dates for you",
    body: "Deadlines and hearings show up in Deadlines and Calendar, and we remind you before each one. Stuck? Tap the ? at the top any time.",
  },
];

// A short first-visit walkthrough. Shows once per browser, and can be reopened from the ? menu.
export function WelcomeTour() {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);

  useEffect(() => {
    const show = () => {
      setI(0);
      setOpen(true);
    };
    window.addEventListener(OPEN_TOUR_EVENT, show);
    return () => window.removeEventListener(OPEN_TOUR_EVENT, show);
  }, []);

  function close() {
    setOpen(false);
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      // harmless
    }
  }

  const s = SLIDES[i];
  const Icon = s.icon;
  const last = i === SLIDES.length - 1;
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <DialogContent className="max-w-md overflow-hidden p-0">
        <div className={`grid place-items-center bg-gradient-to-br ${s.tone} py-8 text-white`}>
          <Icon className="h-12 w-12" />
        </div>
        <div className="p-6">
          <DialogTitle className="font-serif text-xl">{s.title}</DialogTitle>
          <DialogDescription className="mt-2 text-sm">{s.body}</DialogDescription>
          <div className="mt-5 flex items-center justify-between">
            <div className="flex gap-1.5" aria-hidden="true">
              {SLIDES.map((_, n) => (
                <span
                  key={n}
                  className={`h-1.5 w-5 rounded-full ${n === i ? "bg-foreground" : "bg-border"}`}
                />
              ))}
            </div>
            <div className="flex gap-2">
              {!last && (
                <button type="button" onClick={close} className="btn-outline text-sm">
                  Skip
                </button>
              )}
              <button
                type="button"
                onClick={() => (last ? close() : setI(i + 1))}
                className="btn-primary text-sm"
              >
                {last ? "Get started" : "Next"}
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
