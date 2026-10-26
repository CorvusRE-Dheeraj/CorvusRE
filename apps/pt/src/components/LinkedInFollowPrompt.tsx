// A small popup asking the customer to follow CorvusRE on LinkedIn — once the
// welcome tour has finished (new accounts), or on the next dashboard visit
// (everyone else). Waits for any other dialog (terms, profile details, the
// tour) to finish first, and asks at most once per browser session; "Maybe
// later" asks again in SNOOZE_DAYS days, "Follow" never asks again.
import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OPEN_TOUR_EVENT, TOUR_FINISHED_EVENT } from "@/components/WelcomeTour";
import {
  getFollowState,
  LINKEDIN_PAGE_URL,
  markFollowed,
  shouldAskToFollow,
  snoozeFollowPrompt,
} from "@/lib/linkedin-follow";

const ASKED_THIS_SESSION = "corvuspt.linkedinAsked";

export function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
    </svg>
  );
}

const otherDialogOpen = () =>
  !!document.querySelector("[role=dialog],[role=alertdialog],[data-blocking-dialog]");

export function LinkedInFollowPrompt() {
  const { user } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const onDashboard = /\/dashboard(\/|$)/.test(pathname);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const tourActive = useRef(false);

  useEffect(() => {
    if (!user || !onDashboard) return;
    try {
      if (sessionStorage.getItem(ASKED_THIS_SESSION) === "1") return;
    } catch {
      // storage blocked — the account-level state still limits it
    }
    let cancelled = false;
    let timer: number | undefined;
    const onTourOpen = () => (tourActive.current = true);
    const onTourDone = () => {
      tourActive.current = false;
      schedule(800);
    };
    window.addEventListener(OPEN_TOUR_EVENT, onTourOpen);
    window.addEventListener(TOUR_FINISHED_EVENT, onTourDone);

    // Show once the screen has been clear of other dialogs (and the tour,
    // which starts by itself for new accounts) for two checks in a row.
    let clear = 0;
    function schedule(delay: number) {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (cancelled) return;
        if (tourActive.current || otherDialogOpen()) {
          clear = 0;
          return schedule(1500);
        }
        if (++clear < 2) return schedule(1500);
        try {
          sessionStorage.setItem(ASKED_THIS_SESSION, "1");
        } catch {
          // harmless
        }
        setOpen(true);
      }, delay);
    }

    getFollowState(user.id)
      .then((state) => {
        if (!cancelled && shouldAskToFollow(state)) schedule(3000);
      })
      .catch((err) => console.error("LinkedIn prompt:", err));
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener(OPEN_TOUR_EVENT, onTourOpen);
      window.removeEventListener(TOUR_FINISHED_EVENT, onTourDone);
    };
  }, [user, onDashboard]);

  async function follow() {
    window.open(LINKEDIN_PAGE_URL, "_blank", "noopener,noreferrer");
    setOpen(false);
    if (user) await markFollowed(user.id).catch(console.error);
  }

  async function later() {
    setBusy(true);
    setOpen(false);
    if (user) await snoozeFollowPrompt(user.id).catch(console.error);
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && void later()}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-lg">
        <DialogHeader>
          <span className="mx-auto mb-1 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[#0A66C2] text-white">
            <LinkedInIcon className="h-6 w-6" />
          </span>
          <DialogTitle className="text-center">Follow CorvusRE on LinkedIn</DialogTitle>
          <DialogDescription className="text-center">
            Texas property tax updates, deadline reminders and protest tips — in your feed.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col sm:gap-2">
          <button
            type="button"
            onClick={follow}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#0A66C2] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#004182]"
          >
            <LinkedInIcon className="h-4 w-4" />
            Follow on LinkedIn
          </button>
          <button
            type="button"
            onClick={later}
            disabled={busy}
            className="w-full rounded-md px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Maybe later
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
