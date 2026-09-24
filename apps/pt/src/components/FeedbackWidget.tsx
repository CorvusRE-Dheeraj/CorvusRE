import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { getMyBilling } from "@/lib/billing";
import {
  computeUsageSignals,
  getMyFeedbackResponse,
  isFormV2Complete,
  saveFormV2,
  type FeedbackResponse,
} from "@/lib/beta-feedback";
import { ZERO_SIGNALS, type Answer, type UsageSignals } from "@/lib/beta-feedback-questions";
import {
  FORM_QUESTIONS,
  FORM_TOTAL,
  firstUnansweredIndex,
  isAnswered,
  sectionKeyOf,
} from "@/lib/feedback-form";
import { OPEN_FEEDBACK_EVENT } from "@/lib/feedback-widget-events";
import { Progress } from "@/components/ui/progress";

type Stage = "closed" | "bubble" | "invite" | "form" | "done";

const DISMISSED_KEY = "corvuspt.feedbackBubbleDismissed";
const BUBBLE_DELAY_MS = 6000;
const BUBBLE_VISIBLE_MS = 14000;

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function FeedbackBot({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <defs>
        <linearGradient id="fb-bot-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
      </defs>
      <rect x="4" y="9" width="40" height="32" rx="14" fill="url(#fb-bot-bg)" />
      <rect x="10" y="16" width="28" height="18" rx="9" fill="#0b1f1a" />
      <circle cx="18.5" cy="25" r="3" fill="#a7f3d0" />
      <circle cx="29.5" cy="25" r="3" fill="#a7f3d0" />
      <rect x="22" y="3" width="4" height="7" rx="2" fill="#059669" />
      <circle cx="24" cy="3.5" r="2.5" fill="#34d399" />
    </svg>
  );
}

// The beta-feedback experience: a floating bot in the bottom-right corner that
// pops a friendly hello, asks if now is a good time (2–3 minutes), then walks
// through the 20 questions one at a time, chat-style. Progress saves after every
// answer, so closing it (or the browser) never loses anything.
export function FeedbackWidget() {
  const { user } = useAuth();
  const [isBeta, setIsBeta] = useState(false);
  const [response, setResponse] = useState<FeedbackResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [stage, setStage] = useState<Stage>("closed");
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const signalsRef = useRef<UsageSignals | null>(null);

  const complete = isFormV2Complete(response);
  const indexKey = user ? `corvuspt.feedbackIndex.${user.id}` : null;

  // Who sees this at all: signed-in beta testers.
  useEffect(() => {
    if (!user) {
      setIsBeta(false);
      setResponse(null);
      setLoaded(false);
      setStage("closed");
      return;
    }
    let live = true;
    Promise.all([getMyBilling(user.id), getMyFeedbackResponse(user.id)])
      .then(([billing, existing]) => {
        if (!live) return;
        setIsBeta(billing.plan === "beta");
        setResponse(existing);
        if (existing) setAnswers(existing.answers as Record<string, Answer>);
        setLoaded(true);
      })
      .catch(() => {
        if (live) setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, [user]);

  // The friendly pop-up: once per browser session, a few seconds in, only for
  // someone who hasn't finished and hasn't said "maybe later" this session.
  useEffect(() => {
    if (!loaded || !isBeta || complete || readDismissed()) return;
    const show = setTimeout(
      () => setStage((s) => (s === "closed" ? "bubble" : s)),
      BUBBLE_DELAY_MS,
    );
    return () => clearTimeout(show);
  }, [loaded, isBeta, complete]);

  useEffect(() => {
    if (stage !== "bubble") return;
    const hide = setTimeout(
      () => setStage((s) => (s === "bubble" ? "closed" : s)),
      BUBBLE_VISIBLE_MS,
    );
    return () => clearTimeout(hide);
  }, [stage]);

  const openWidget = useCallback(() => {
    if (isFormV2Complete(response)) {
      setStage("done");
      return;
    }
    const started = FORM_QUESTIONS.some((q) => isAnswered(q, answers));
    if (started) {
      let resume = firstUnansweredIndex(answers);
      try {
        const saved = indexKey ? Number(localStorage.getItem(indexKey)) : NaN;
        if (Number.isInteger(saved) && saved >= 0 && saved < FORM_TOTAL) resume = saved;
      } catch {
        // storage blocked — use the first unanswered question
      }
      setIndex(resume);
      setStage("form");
    } else {
      setStage("invite");
    }
  }, [response, answers, indexKey]);

  // Nav tab, profile menu, dashboard banner and sign-out prompt all open it.
  useEffect(() => {
    window.addEventListener(OPEN_FEEDBACK_EVENT, openWidget);
    return () => window.removeEventListener(OPEN_FEEDBACK_EVENT, openWidget);
  }, [openWidget]);

  // Saves run one at a time, in order, and never block the screen: answers
  // autosave a moment after they change, and Next moves on immediately.
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const lastSavedRef = useRef<string>("");
  const latestRef = useRef({ answers, index });
  latestRef.current = { answers, index };

  function persist(
    next: Record<string, Answer>,
    upToIndex: number,
    completed: boolean,
  ): Promise<void> {
    const snapshot = JSON.stringify(next);
    if (!completed && snapshot === lastSavedRef.current) return Promise.resolve();
    const run = async () => {
      if (!user) return;
      if (!signalsRef.current) {
        signalsRef.current = await computeUsageSignals(user.id).catch(() => ZERO_SIGNALS);
      }
      const sections = Array.from(
        new Set(FORM_QUESTIONS.slice(0, upToIndex + 1).map((q) => sectionKeyOf(q.id))),
      );
      await saveFormV2(
        user.id,
        next as Record<string, string | string[]>,
        sections,
        signalsRef.current,
        completed,
      );
      lastSavedRef.current = snapshot;
      if (completed) {
        const fresh = await getMyFeedbackResponse(user.id).catch(() => null);
        if (fresh) setResponse(fresh);
      }
    };
    const result = queueRef.current.then(run, run);
    queueRef.current = result.catch(() => {});
    return result;
  }

  // Autosave shortly after any answer changes while the form is open.
  useEffect(() => {
    if (stage !== "form" || !Object.keys(answers).length) return;
    const t = setTimeout(() => {
      void persist(latestRef.current.answers, latestRef.current.index, false).catch(() => {});
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, stage]);

  // Remember which question they were on, so reopening resumes there.
  useEffect(() => {
    if (stage !== "form" || !indexKey) return;
    try {
      localStorage.setItem(indexKey, String(index));
    } catch {
      // storage blocked — reopening falls back to the first unanswered question
    }
  }, [stage, index, indexKey]);

  function setAnswer(id: string, value: string) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  async function goNext(skip = false) {
    const q = FORM_QUESTIONS[index];
    if (!skip && !isAnswered(q, answers)) return;
    const last = index === FORM_TOTAL - 1;
    if (!last) {
      setIndex(index + 1);
      void persist(answers, index, false).catch(() =>
        toast.error("Could not save your answer — it will retry as you continue."),
      );
      return;
    }
    setSaving(true);
    try {
      await persist(answers, index, true);
      setStage("done");
      toast.success("Thank you — your feedback is in.");
    } catch {
      toast.error("Could not save your answer. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function closeWidget() {
    if (stage === "form" && Object.keys(answers).length > 0) {
      void persist(answers, index, false).catch(() => {});
    }
    setStage("closed");
  }

  function maybeLater() {
    try {
      sessionStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // storage blocked — it may reappear next page load, harmless
    }
    setStage("closed");
  }

  if (!user || !isBeta || !loaded || typeof document === "undefined") return null;

  const q = FORM_QUESTIONS[index];
  const answer = answers[q.id];
  const showFollowUp = q.followUp?.showIf(typeof answer === "string" ? answer : undefined);
  const otherValue = (answers[`${q.id}__other`] as string | undefined) ?? "";
  const last = index === FORM_TOTAL - 1;

  const panel =
    "print:hidden fixed bottom-40 right-5 z-40 w-[22rem] max-w-[calc(100vw-2.5rem)] rounded-2xl border border-border bg-card p-4 shadow-xl fb-pop";

  return createPortal(
    <>
      {stage === "closed" && !complete && (
        <div className="print:hidden fixed bottom-24 right-5 z-40 flex max-w-[calc(100vw-2.5rem)] flex-col items-end gap-2">
          <button
            type="button"
            onClick={openWidget}
            className="rounded-2xl rounded-br-sm border border-border bg-card px-3 py-2 text-left text-xs font-medium shadow-lg"
          >
            👋 Hey! Got 2 minutes? Tell us what you think!
          </button>
          <button
            type="button"
            onClick={openWidget}
            aria-label="Give feedback"
            className="grid h-14 w-14 place-items-center rounded-full bg-card shadow-lg ring-1 ring-border transition-transform hover:scale-105 fb-bob"
          >
            <FeedbackBot className="h-10 w-10" />
          </button>
        </div>
      )}

      {stage === "bubble" && (
        <div className="print:hidden fixed bottom-24 right-5 z-40 flex max-w-[calc(100vw-2.5rem)] items-end gap-2">
          <button
            type="button"
            onClick={() => setStage("invite")}
            className="w-64 rounded-2xl rounded-br-sm border border-border bg-card p-3 text-left text-sm shadow-lg fb-pop"
          >
            <span className="font-semibold">Hi! 👋</span>
            <br />
            We&apos;d love your feedback on your experience with Corvus.
          </button>
          <button
            type="button"
            onClick={() => setStage("invite")}
            aria-label="Give feedback"
            className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-card shadow-lg ring-1 ring-border fb-bob"
          >
            <FeedbackBot className="h-10 w-10" />
          </button>
        </div>
      )}

      {stage === "invite" && (
        <div className={panel} role="dialog" aria-label="Share your feedback">
          <div className="flex items-start gap-3">
            <FeedbackBot className="h-10 w-10 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                It will only take 2–3 minutes. Shall we get started?
              </p>
            </div>
            <button
              type="button"
              onClick={maybeLater}
              aria-label="Close"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 grid gap-2">
            <button
              type="button"
              onClick={() => {
                setIndex(firstUnansweredIndex(answers));
                setStage("form");
              }}
              className="btn-primary btn-primary-hover w-full text-sm"
            >
              Yes, let&apos;s do it
            </button>
            <button type="button" onClick={maybeLater} className="btn-outline w-full text-sm">
              Maybe later
            </button>
          </div>
        </div>
      )}

      {stage === "form" && (
        <div
          className={`${panel} flex max-h-[calc(100vh-11rem)] flex-col`}
          role="dialog"
          aria-label="Feedback form"
        >
          <div className="flex items-center gap-3">
            <FeedbackBot className="h-9 w-9 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                {index === 0 ? "Great! Let's start." : "Thanks — keep going."}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <Progress value={((index + 1) / FORM_TOTAL) * 100} className="h-1.5 flex-1" />
                <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                  {index + 1} / {FORM_TOTAL}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={closeWidget}
              aria-label="Close"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div key={q.id} className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1 fb-pop">
            <p className="text-sm font-semibold">{q.label}</p>
            {q.helper && <p className="mt-0.5 text-xs text-muted-foreground">{q.helper}</p>}

            {q.type === "single" && (
              <div className="mt-3 grid gap-2" role="radiogroup" aria-label={q.label}>
                {q.options?.map((opt) => (
                  <label
                    key={opt}
                    className={`flex cursor-pointer items-center gap-2 rounded-full border px-3.5 py-2 text-sm transition-colors ${
                      answer === opt
                        ? "border-accent bg-accent/10"
                        : "border-input bg-background hover:bg-secondary/60"
                    }`}
                  >
                    <input
                      type="radio"
                      name={q.id}
                      checked={answer === opt}
                      onChange={() => setAnswer(q.id, opt)}
                      className="accent-[var(--color-accent)]"
                    />
                    <span>{opt}</span>
                  </label>
                ))}
                <input
                  value={otherValue}
                  onChange={(e) => setAnswer(`${q.id}__other`, e.target.value)}
                  placeholder="Other / Comment"
                  aria-label="Other or comment"
                  className="rounded-full border border-input bg-background px-3.5 py-2 text-sm"
                />
              </div>
            )}

            {q.type === "text" && (
              <textarea
                value={typeof answer === "string" ? answer : ""}
                onChange={(e) => setAnswer(q.id, e.target.value)}
                rows={4}
                placeholder="Type your answer…"
                aria-label={q.label}
                className="mt-3 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
              />
            )}

            {showFollowUp && q.followUp && (
              <div className="mt-3">
                <p className="text-xs font-medium">{q.followUp.question.label}</p>
                <input
                  value={(answers[q.followUp.question.id] as string | undefined) ?? ""}
                  onChange={(e) => setAnswer(q.followUp!.question.id, e.target.value)}
                  placeholder="Optional"
                  aria-label={q.followUp.question.label}
                  className="mt-1 w-full rounded-full border border-input bg-background px-3.5 py-2 text-sm"
                />
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              disabled={index === 0 || saving}
              className="text-xs text-muted-foreground hover:underline disabled:opacity-40"
            >
              ← Back
            </button>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void goNext(true)}
                disabled={saving}
                className="text-xs text-muted-foreground hover:underline disabled:opacity-40"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={() => void goNext()}
                disabled={saving || !isAnswered(q, answers)}
                className="btn-primary btn-primary-hover text-sm disabled:opacity-50"
              >
                {saving ? "Saving…" : last ? "Submit" : "Next →"}
              </button>
            </div>
          </div>
        </div>
      )}

      {stage === "done" && (
        <div className={panel} role="dialog" aria-label="Thank you">
          <div className="flex items-start gap-3">
            <FeedbackBot className="h-10 w-10 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Thank you!</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Your feedback is in — it directly shapes what we build next.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStage("closed")}
              aria-label="Close"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              setIndex(0);
              setStage("form");
            }}
            className="btn-outline mt-3 w-full text-sm"
          >
            Edit my answers
          </button>
        </div>
      )}
    </>,
    document.body,
  );
}
