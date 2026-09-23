import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  computeUsageSignals,
  getMyFeedbackResponse,
  saveFeedbackProgress,
  submitFeedback,
} from "@/lib/beta-feedback";
import {
  selectQuestionIds,
  validQuestionIds,
  visibleSections,
  ZERO_SIGNALS,
  type Answer,
  type Question,
  type Section,
  type UsageSignals,
} from "@/lib/beta-feedback-questions";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/dashboard/_layout/feedback")({
  head: () => ({
    meta: [{ title: "Beta Feedback — CorvusPT" }],
  }),
  component: BetaFeedbackForm,
});

const OTHER = "Other";

function otherText(answers: Record<string, Answer>, id: string): string {
  return (answers[`${id}__other`] as string) ?? "";
}

// Which section, if any, has at least one unanswered top-level question —
// where a returning tester resumes, instead of re-clicking through
// everything they already answered.
function firstUnfinishedIndex(sections: Section[], answers: Record<string, Answer>): number {
  for (let i = 0; i < sections.length; i++) {
    const unanswered = sections[i].questions.some((q) => answers[q.id] === undefined);
    if (unanswered) return i;
  }
  return Math.max(sections.length - 1, 0);
}

function QuestionField({
  question,
  value,
  otherValue,
  onChange,
  onOtherChange,
}: {
  question: Question;
  value: Answer | undefined;
  otherValue: string;
  onChange: (v: Answer) => void;
  onOtherChange: (v: string) => void;
}) {
  const options = question.otherOption ? [...(question.options ?? []), OTHER] : question.options;
  const showOtherInput =
    question.otherOption &&
    (typeof value === "string"
      ? value === OTHER
      : Array.isArray(value)
        ? value.includes(OTHER)
        : false);

  if (question.type === "text") {
    return (
      <Textarea
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="w-full"
        placeholder="Type your answer…"
      />
    );
  }

  if (question.type === "nps") {
    const selected = value as string | undefined;
    return (
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 11 }, (_, n) => String(n)).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`h-10 w-10 rounded-md border text-sm font-medium transition-colors ${
              selected === n
                ? "border-accent bg-accent text-accent-foreground"
                : "border-input bg-background hover:bg-secondary/60"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    );
  }

  if (question.type === "single") {
    return (
      <div className="grid gap-3">
        <RadioGroup value={(value as string) ?? ""} onValueChange={(v) => onChange(v)}>
          {options?.map((opt) => (
            <label
              key={opt}
              htmlFor={`${question.id}-${opt}`}
              className="flex cursor-pointer items-start gap-2 text-sm"
            >
              <RadioGroupItem value={opt} id={`${question.id}-${opt}`} className="mt-0.5" />
              <span>{opt}</span>
            </label>
          ))}
        </RadioGroup>
        {showOtherInput && (
          <input
            value={otherValue}
            onChange={(e) => onOtherChange(e.target.value)}
            placeholder="Tell us more…"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        )}
      </div>
    );
  }

  // multi
  const selected = (value as string[] | undefined) ?? [];
  const maxSelect = question.maxSelect;
  return (
    <div className="grid gap-3">
      {question.helper && !maxSelect && (
        <p className="text-xs text-muted-foreground">{question.helper}</p>
      )}
      <div className="grid gap-2">
        {options?.map((opt) => {
          const checked = selected.includes(opt);
          const atLimit = !!maxSelect && selected.length >= maxSelect && !checked;
          return (
            <label
              key={opt}
              htmlFor={`${question.id}-${opt}`}
              className={`flex cursor-pointer items-start gap-2 text-sm ${
                atLimit ? "opacity-40" : ""
              }`}
            >
              <Checkbox
                id={`${question.id}-${opt}`}
                checked={checked}
                disabled={atLimit}
                onCheckedChange={(c) => {
                  const next = c ? [...selected, opt] : selected.filter((v) => v !== opt);
                  onChange(next);
                }}
                className="mt-0.5"
              />
              <span>{opt}</span>
            </label>
          );
        })}
      </div>
      {showOtherInput && (
        <input
          value={otherValue}
          onChange={(e) => onOtherChange(e.target.value)}
          placeholder="Tell us more…"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      )}
    </div>
  );
}

function QuestionBlock({
  question,
  answers,
  setAnswer,
}: {
  question: Question;
  answers: Record<string, Answer>;
  setAnswer: (id: string, v: Answer) => void;
}) {
  const value = answers[question.id];
  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">{question.label}</p>
      {question.helper && question.type !== "multi" && (
        <p className="text-xs text-muted-foreground">{question.helper}</p>
      )}
      <QuestionField
        question={question}
        value={value}
        otherValue={otherText(answers, question.id)}
        onChange={(v) => setAnswer(question.id, v)}
        onOtherChange={(v) => setAnswer(`${question.id}__other`, v)}
      />
      {question.followUp?.showIf(value) && (
        <div className="ml-4 mt-2 border-l-2 border-border pl-4">
          <QuestionBlock
            question={question.followUp.question}
            answers={answers}
            setAnswer={setAnswer}
          />
        </div>
      )}
    </div>
  );
}

function BetaFeedbackForm() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [signals, setSignals] = useState<UsageSignals>(ZERO_SIGNALS);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  // The questions picked for THIS tester from their activity, saved with
  // their answers (as "__selected") on first visit so coming back later
  // shows the same questions even if they've done more in the app since.
  const [lockedIds, setLockedIds] = useState<string[]>([]);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [alreadyDone, setAlreadyDone] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!user) return;
    Promise.all([computeUsageSignals(user.id), getMyFeedbackResponse(user.id)])
      .then(([sig, existing]) => {
        setSignals(sig);
        const saved = validQuestionIds(existing?.answers.__selected);
        const ids = saved.length > 0 ? saved : selectQuestionIds(sig);
        setLockedIds(ids);
        if (existing) {
          setAnswers(existing.answers);
          if (existing.completedAt) {
            setAlreadyDone(true);
          } else {
            setSectionIndex(firstUnfinishedIndex(visibleSections(sig, ids), existing.answers));
          }
        }
      })
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : "Could not load your feedback."),
      )
      .finally(() => setLoading(false));
  }, [user]);

  const sections = useMemo(() => visibleSections(signals, lockedIds), [signals, lockedIds]);
  const currentSection = sections[sectionIndex];
  const isLast = sectionIndex === sections.length - 1;

  function setAnswer(id: string, v: Answer) {
    setAnswers((prev) => ({ ...prev, [id]: v }));
  }

  async function persist(sectionsShownSoFar: string[], completed: boolean) {
    if (!user) return;
    setSaving(true);
    try {
      const toSave = { ...answers, __selected: lockedIds };
      if (completed) {
        await submitFeedback(user.id, toSave, sectionsShownSoFar, signals);
      } else {
        await saveFeedbackProgress(user.id, toSave, sectionsShownSoFar, signals);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save your progress.");
    } finally {
      setSaving(false);
    }
  }

  async function handleNext() {
    const shown = sections.slice(0, sectionIndex + 1).map((s) => s.key);
    if (isLast) {
      await persist(shown, true);
      setAlreadyDone(true);
      setEditing(false);
      toast.success("Thank you — your feedback is in.");
      return;
    }
    await persist(shown, false);
    setSectionIndex((i) => Math.min(i + 1, sections.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleBack() {
    setSectionIndex((i) => Math.max(i - 1, 0));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Saves whatever's been answered so far — including the CURRENT section,
  // even if it's only partially filled in — then leaves. Distinct from
  // Next/persist's own saves, which only ever commit a section once it's
  // done; this is the only path that captures in-progress answers on the
  // section the tester is still on when they bail mid-way.
  async function handleSaveAndExit() {
    const shown = sections.slice(0, sectionIndex + 1).map((s) => s.key);
    await persist(shown, false);
    toast.success("Progress saved — come back anytime to finish.");
    nav({ to: "/dashboard" });
  }

  if (loading) {
    return <p className="mt-6 text-sm text-muted-foreground">Loading…</p>;
  }

  if (alreadyDone && !editing) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="card-elev p-8 text-center">
          <h1 className="font-serif text-2xl font-semibold">Thank you</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You already completed the Corvus Beta Tester Feedback form. Seriously — thank you for
            helping us make Corvus better.
          </p>
          <button onClick={() => setEditing(true)} className="btn-outline mt-6">
            Edit my answers
          </button>
        </div>
      </div>
    );
  }

  if (!currentSection) {
    return <p className="mt-6 text-sm text-muted-foreground">Nothing to show yet.</p>;
  }

  const progressPct = Math.round(((sectionIndex + 1) / sections.length) * 100);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-serif text-2xl font-semibold">Corvus Beta Tester Feedback</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Help us break Corvus — in a good way. You're one of our early testers, so we don't need you
        to be nice — we need you to be honest.
      </p>
      <div className="mt-4 flex items-center gap-3">
        <Progress value={progressPct} className="flex-1" />
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          Section {sectionIndex + 1} of {sections.length}
        </span>
      </div>

      <div className="card-elev mt-6 p-6">
        <h2 className="font-semibold">{currentSection.title}</h2>
        <div className="mt-5 grid gap-6">
          {currentSection.questions.map((q) => (
            <QuestionBlock key={q.id} question={q} answers={answers} setAnswer={setAnswer} />
          ))}
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={handleBack}
          disabled={sectionIndex === 0 || saving}
          className="btn-outline disabled:opacity-40"
        >
          Back
        </button>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSaveAndExit}
            disabled={saving}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline disabled:opacity-60"
          >
            Save &amp; exit
          </button>
          <button
            type="button"
            onClick={handleNext}
            disabled={saving}
            className="btn-primary btn-primary-hover disabled:opacity-60"
          >
            {saving ? "Saving…" : isLast ? "Submit" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
