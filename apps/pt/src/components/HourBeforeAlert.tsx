import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { getCalendarEvents, type CalendarEvent } from "@/lib/tax-calendar";
import { listProtests, type ProtestRecord } from "@/lib/protests";
import { getMyProfile } from "@/lib/profile";
import { alertTarget, inAlertWindow, minutesLeft } from "@/lib/hour-alert";

const CHECK_MS = 30_000;
const REFRESH_MS = 5 * 60_000;
const seenKey = (id: string, date: string) => `corvuspt.hourAlert.${id}.${date}`;

const wasShown = (id: string, date: string) => {
  try {
    return localStorage.getItem(seenKey(id, date)) === "1";
  } catch {
    return false;
  }
};
const markShown = (id: string, date: string) => {
  try {
    localStorage.setItem(seenKey(id, date), "1");
  } catch {
    // storage blocked — the alert may repeat on the next check, harmless
  }
};

// The calendar's own "resolved" flag treats a date-only deadline as past from
// midnight UTC, so on the day itself it can't be trusted for these: a protest
// deadline only counts while no protest has been filed for that property, and a
// bill only while it is unpaid.
function stillOpen(ev: CalendarEvent, protests: ProtestRecord[]): boolean {
  const prefix = ev.id.split(":")[0];
  if (prefix === "hearing" || prefix === "informal-review") return true;
  if (prefix === "protest-deadline") {
    const propertyId = ev.id.split(":")[1];
    return !protests.some((p) => p.propertyId === propertyId && p.status !== "requested");
  }
  if (prefix === "bpp-protest-deadline") {
    const accountId = ev.id.split(":")[1];
    return !protests.some((p) => p.bppAccountId === accountId && p.status !== "requested");
  }
  if (prefix === "tax-due") return !ev.resolved;
  return false; // penalty dates: only the emailed alert (can't tell paid from past here)
}

// An on-screen heads-up when a hearing / informal review is about to start, or a
// deadline day is about to close, within the hour. Mirrors the emailed alert
// (send-hour-before-alerts): same timing rules, once per event.
export function HourBeforeAlert() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const data = useRef<{ events: CalendarEvent[]; protests: ProtestRecord[]; enabled: boolean }>({
    events: [],
    protests: [],
    enabled: true,
  });

  useEffect(() => {
    if (!user) return;
    let live = true;

    async function refresh() {
      try {
        const [events, protests, profile] = await Promise.all([
          getCalendarEvents(user!.id),
          listProtests(user!.id),
          getMyProfile(user!.id),
        ]);
        if (live) {
          data.current = {
            events,
            protests,
            enabled: profile.notificationPrefs.deadlineHourAlert,
          };
        }
      } catch {
        // keep whatever we had — the next refresh tries again
      }
    }

    function check() {
      const { events, protests, enabled } = data.current;
      if (!enabled) return;
      const now = Date.now();
      for (const ev of events) {
        if (!stillOpen(ev, protests)) continue;
        const target = alertTarget(ev.id, ev.date, ev.time);
        if (!target || !inAlertWindow(target.dueMs, now) || wasShown(ev.id, ev.date)) continue;
        markShown(ev.id, ev.date);
        const left = minutesLeft(target.dueMs, now);
        toast.warning(
          target.kind === "timed"
            ? `About an hour to go — ${ev.title} (${left} min)`
            : `Due today — ${ev.title}. About ${left} min until 5:00 PM Central; confirm your county's cutoff.`,
          {
            duration: Infinity,
            closeButton: true,
            action: {
              label: "Open Calendar",
              onClick: () => void navigate({ to: "/dashboard/calendar" }),
            },
          },
        );
      }
    }

    void refresh().then(check);
    const checkTimer = setInterval(check, CHECK_MS);
    const refreshTimer = setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      live = false;
      clearInterval(checkTimer);
      clearInterval(refreshTimer);
    };
  }, [user, navigate]);

  return null;
}
