import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarClock,
  ListChecks,
  Layers,
  PhoneCall,
  Receipt,
  Route as RouteIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getMyProfile } from "@/lib/profile";
import {
  approveDesignBrief,
  requestDesignConsultation,
  DESIGN_STAGE_LABEL,
  type DesignStage,
  type DesignRequestRow,
} from "@/lib/design-requests";
import { designChecklist } from "@/lib/design-workspace";
import { scopeLabel } from "@/lib/design";
import { currencyRange, weeksLabel, dateShort } from "@/lib/format";
import { Section, Stat, Loading, Pill, Field, inputCls } from "@/components/dp-ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useActiveDesignRequest,
  EmptyDesign,
  downloadText,
  fileSlug,
} from "@/components/design-workspace";

export const Route = createFileRoute("/dashboard/_layout/design")({
  head: () => ({ meta: [{ title: "Design — CorvusDP" }] }),
  component: DesignDashboard,
});

function DesignDashboard() {
  const { loading, dr, brief: b, refetch } = useActiveDesignRequest();
  const [approving, setApproving] = useState(false);
  const [consultOpen, setConsultOpen] = useState(false);
  const [consultNotice, setConsultNotice] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (!dr || !b) return <EmptyDesign />;

  async function approve() {
    if (!dr) return;
    setApproving(true);
    await approveDesignBrief(dr.id);
    await refetch();
    setApproving(false);
  }

  // Design Proposal (PRD 2.2.19) — "a formal document shared with the client
  // including scope, fees, timeline, and deliverables." Same plain-text
  // download pattern as the permitting side's "Download site summary".
  function downloadProposal() {
    if (!dr || !b) return;
    const lines = [
      `CorvusDP — Design Proposal`,
      `Generated ${new Date().toLocaleString()}`,
      ``,
      `PROJECT`,
      `  Location: ${dr.address ?? dr.city ?? "—"}`,
      `  Scope: ${scopeLabel((dr.scope ?? undefined) as never)}`,
      `  Sector: ${dr.sector ?? "—"}`,
      `  Building area: ${dr.building_area ?? "—"} sf, ${dr.floors ?? "—"} floor(s)`,
      ``,
      `SCOPE — WHAT'S INCLUDED`,
      ...b.inclusions.map((i) => `  - ${i.title}: ${i.detail}`),
      ``,
      `FEES — DESIGN COST BY DISCIPLINE`,
      ...b.costBreakdown.map((c) => `  ${c.discipline}: ${currencyRange(c.low, c.high)}`),
      `  Total design fee: ${currencyRange(b.budgetLow, b.budgetHigh)}`,
      `  Estimated build cost (separate): ${currencyRange(b.buildCostLow, b.buildCostHigh)}`,
      ``,
      `TIMELINE`,
      ...b.timeline.map((t) => `  ${t.phase}: ${weeksLabel(t.weeksMin, t.weeksMax)} — ${t.note}`),
      ``,
      `DELIVERABLES — SUGGESTED APPROACH`,
      ...b.approaches.map((a) => `  ${a.name}: ${a.summary} (best when: ${a.bestWhen})`),
      ``,
      `Status: ${dr.approved_at ? `Approved ${dateShort(dr.approved_at)}` : "Pending approval"}`,
    ];
    downloadText(`design-proposal-${fileSlug(dr)}.txt`, lines.join("\n"));
  }

  const checklist = designChecklist(dr, b);
  const checklistDone = checklist.filter((i) => i.done).length;
  const workspace = [
    {
      to: "/dashboard/design-site",
      label: "Site Data",
      icon: Layers,
      desc: "Location, program, utilities, and site constraints",
    },
    {
      to: "/dashboard/design-checklist",
      label: "Checklist",
      icon: ListChecks,
      desc: `${checklistDone} of ${checklist.length} items done`,
    },
    {
      to: "/dashboard/design-fees",
      label: "Fees",
      icon: Receipt,
      desc: `${currencyRange(b.budgetLow, b.budgetHigh)} design fee by discipline`,
    },
    {
      to: "/dashboard/design-roadmap",
      label: "Roadmap",
      icon: RouteIcon,
      desc: "What happens before what, from brief to permit set",
    },
    {
      to: "/dashboard/design-timeline",
      label: "Timeline",
      icon: CalendarClock,
      desc: `${weeksLabel(b.totalWeeksMin, b.totalWeeksMax)}, phase by phase`,
    },
  ];

  return (
    <div className="grid gap-5">
      <Section
        title={dr.address ?? dr.city ?? "Design project"}
        subtitle={`${scopeLabel((dr.scope ?? undefined) as never)} · ${dr.sector ?? "commercial"} · ${dr.building_area ?? "?"} sf`}
        right={
          <div className="flex items-center gap-2">
            {dr.approved_at && <Pill tone="green">Approved {dateShort(dr.approved_at)}</Pill>}
            <button className="btn-outline text-sm" onClick={() => window.print()}>
              Print
            </button>
            <button className="btn-outline text-sm" onClick={downloadProposal}>
              Download proposal
            </button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Design fee range" value={currencyRange(b.budgetLow, b.budgetHigh)} />
          <Stat label="Est. build cost" value={currencyRange(b.buildCostLow, b.buildCostHigh)} />
          <Stat label="Timeline" value={weeksLabel(b.totalWeeksMin, b.totalWeeksMax)} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {!dr.approved_at && (
            <button
              className="btn-accent disabled:opacity-60"
              disabled={approving}
              onClick={approve}
            >
              {approving ? "Saving…" : "Approve & start detailed design"}
            </button>
          )}
          {!dr.consultation_requested_at && (
            <button className="btn-outline" onClick={() => setConsultOpen(true)}>
              <PhoneCall className="h-4 w-4" aria-hidden /> Schedule initial consultation call
            </button>
          )}
        </div>

        {dr.consultation_requested_at && (
          <div className="mt-4 rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <PhoneCall className="h-4 w-4" aria-hidden />
              Consultation requested {dateShort(dr.consultation_requested_at)}
            </div>
            <p className="mt-1 text-muted-foreground">
              {dr.consultation_phone
                ? `Our design team will call you at ${dr.consultation_phone}${dr.consultation_best_time ? ` (${dr.consultation_best_time})` : ""}.`
                : "Our design team will be in touch."}
            </p>
            {consultNotice && <p className="mt-1 text-muted-foreground">{consultNotice}</p>}
          </div>
        )}
      </Section>

      {dr.stage !== "brief" && dr.stage !== "approved" && (
        <Section
          title="Design progress"
          subtitle="Staff-tracked as your design team moves through each stage."
        >
          <DesignStageTracker stage={dr.stage as DesignStage} />
        </Section>
      )}

      <Section title="Design workspace" subtitle="Everything about this design, one page each.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {workspace.map((w) => {
            const Icon = w.icon;
            return (
              <Link
                key={w.to}
                to={w.to}
                className="group flex items-start gap-3 rounded-lg border border-border p-3 text-sm transition-colors hover:bg-secondary/50"
              >
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 font-medium">
                    {w.label}
                    <ArrowRight
                      className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100"
                      aria-hidden
                    />
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{w.desc}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </Section>

      <Section
        title="Suggested approach"
        subtitle="Delivery approaches worth considering for this project."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {b.approaches.map((ap) => (
            <div key={ap.name} className="rounded-lg border border-border p-3 text-sm">
              <div className="font-medium">{ap.name}</div>
              <p className="mt-1 text-xs text-muted-foreground">{ap.summary}</p>
              <p className="mt-2 text-xs">
                <span className="text-muted-foreground">Best when: </span>
                {ap.bestWhen}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Full space planning">
        <div className="grid gap-2 sm:grid-cols-2">
          {b.spacePlan.map((z) => (
            <div key={z.zone} className="rounded-lg border border-border p-3 text-sm">
              <div className="font-medium">{z.zone}</div>
              <p className="text-xs text-muted-foreground">{z.note}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Recommendations & next steps">
        <ul className="grid gap-1 text-sm text-muted-foreground">
          {b.recommendations.map((r) => (
            <li key={r}>• {r}</li>
          ))}
        </ul>
      </Section>

      <ConsultationDialog
        dr={dr}
        open={consultOpen}
        onOpenChange={setConsultOpen}
        onRequested={async (emailed) => {
          setConsultNotice(
            emailed
              ? "We've emailed you a confirmation."
              : "Your request is saved, but the confirmation email didn't go out — we'll still see it.",
          );
          await refetch();
        }}
      />
    </div>
  );
}

// US numbers: 10 digits, or 11 starting with 1.
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (d.length !== 10) return null;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function ConsultationDialog({
  dr,
  open,
  onOpenChange,
  onRequested,
}: {
  dr: DesignRequestRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRequested: (emailed: boolean) => Promise<void>;
}) {
  const { user } = useAuth();
  const profile = useQuery({
    queryKey: ["my-profile", user?.id],
    queryFn: () => getMyProfile(user!.id),
    enabled: !!user?.id,
  });
  const [phone, setPhone] = useState<string | null>(null);
  const [bestTime, setBestTime] = useState("");
  const [notes, setNotes] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const phoneValue = phone ?? profile.data?.phone ?? "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizePhone(phoneValue);
    if (!normalized) {
      setError("Enter a 10-digit US cell number, e.g. (469) 555-0123.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const { emailed } = await requestDesignConsultation(dr, {
        phone: normalized,
        bestTime: bestTime.trim(),
        notes: notes.trim(),
      });
      onOpenChange(false);
      await onRequested(emailed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the request. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule an initial consultation call</DialogTitle>
          <DialogDescription>
            Our design team will call you to talk through {dr.address ?? "your project"}. You'll get
            an email confirming the request.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <Field label="Cell number" required>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              className={inputCls}
              placeholder="(469) 555-0123"
              value={phoneValue}
              onChange={(e) => {
                setPhone(e.target.value);
                setError(null);
              }}
              required
            />
          </Field>
          <Field label="Best time to call (optional)">
            <select
              className={inputCls}
              value={bestTime}
              onChange={(e) => setBestTime(e.target.value)}
            >
              <option value="">Any time</option>
              <option value="Weekday mornings">Weekday mornings</option>
              <option value="Weekday afternoons">Weekday afternoons</option>
              <option value="Weekday evenings">Weekday evenings</option>
            </select>
          </Field>
          <Field label="Anything we should know? (optional)">
            <textarea
              className={inputCls}
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Tenant is a medical office; we'd like to break ground in spring."
            />
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-outline" onClick={() => onOpenChange(false)}>
              Cancel
            </button>
            <button type="submit" className="btn-accent disabled:opacity-60" disabled={sending}>
              {sending ? "Sending…" : "Request call"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// PRD 1.2.19.B — "Timeline bar / milestones." Staff advance the underlying
// stage from the admin console; this just renders where the request
// currently sits among the same three phases PRD 1.2.11.A names.
const TRACKED_STAGES: DesignStage[] = ["concept", "development", "final_drawings", "completed"];

function DesignStageTracker({ stage }: { stage: DesignStage }) {
  const currentIndex = TRACKED_STAGES.indexOf(stage);
  return (
    <div>
      <div className="flex items-center">
        {TRACKED_STAGES.map((s, i) => {
          const done = currentIndex >= 0 && i <= currentIndex;
          return (
            <Fragment key={s}>
              {i > 0 && (
                <span className={`h-px flex-1 ${done ? "bg-accent" : "bg-border"}`} aria-hidden />
              )}
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  done ? "bg-accent text-accent-foreground" : "bg-secondary text-muted-foreground"
                }`}
              >
                {i + 1}
              </span>
            </Fragment>
          );
        })}
      </div>
      <div className="mt-2 flex">
        {TRACKED_STAGES.map((s, i) => (
          <span
            key={s}
            className={`flex-1 text-center text-xs ${
              currentIndex >= i ? "font-medium text-foreground" : "text-muted-foreground"
            } ${i === 0 ? "-ml-4 text-left" : i === TRACKED_STAGES.length - 1 ? "-mr-4 text-right" : ""}`}
          >
            {DESIGN_STAGE_LABEL[s]}
          </span>
        ))}
      </div>
    </div>
  );
}
