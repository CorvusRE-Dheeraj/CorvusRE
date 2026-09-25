import { useState, type ComponentType } from "react";
import {
  Building2,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  FileText,
  Gavel,
  Handshake,
  Landmark,
  Lightbulb,
  MapPin,
  Percent,
  Scale,
  TrendingUp,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { MarkdownLite } from "@/components/MarkdownLite";
import { askAboutDocument } from "@/lib/document-ai";
import { getErrorMessage } from "@/lib/error-message";
import type { PropertyRecord } from "@/lib/properties";
import {
  STATUS_LABEL,
  TAG_LABEL,
  toBullets,
  type TaxUpdate,
  type TaxUpdateTag,
} from "@/lib/tax-updates";

type Icon = ComponentType<{ className?: string }>;

// One picture per topic, so a card reads at a glance before any text does.
export const TAG_ICON: Record<TaxUpdateTag, Icon> = {
  commercial: Building2,
  protest: Gavel,
  arb: Users,
  arbitration: Handshake,
  court: Landmark,
  valuation: TrendingUp,
  tax_rate: Percent,
  deadlines: CalendarClock,
};

const STATUS_TONE: Record<TaxUpdate["status"], string> = {
  enacted_law: "bg-success/15 text-success",
  adopted_rule: "bg-success/15 text-success",
  proposed_rule: "bg-warning/15 text-warning-foreground",
  pending_legislation: "bg-warning/15 text-warning-foreground",
  failed_legislation: "bg-destructive/10 text-destructive",
  notice_guidance: "bg-secondary text-muted-foreground",
};

// The colour bar and icon tile follow the legal status, so "law" reads different
// from "proposal" without reading the badge.
const STATUS_TILE: Record<TaxUpdate["status"], string> = {
  enacted_law: "from-emerald-500 to-teal-600",
  adopted_rule: "from-emerald-500 to-teal-600",
  proposed_rule: "from-amber-400 to-orange-500",
  pending_legislation: "from-amber-400 to-orange-500",
  failed_legislation: "from-rose-400 to-red-500",
  notice_guidance: "from-sky-400 to-indigo-500",
};

export function updateAsText(u: TaxUpdate): string {
  return [
    `${u.title} [${STATUS_LABEL[u.status]}]${u.counties.length ? ` (${u.counties.join(", ")})` : " (Texas statewide)"}`,
    `What changed: ${u.whatChanged}`,
    `Effective: ${u.effectiveDate ?? "Not stated"}. Affects: ${u.affects}.`,
    `Why it matters: ${u.whyItMatters}`,
    `Action: ${u.actionNeeded}`,
    `Source: ${u.sourceName} — ${u.sourceUrl}`,
  ].join("\n");
}

function Points({
  icon: PointIcon,
  label,
  tone,
  text,
}: {
  icon: Icon;
  label: string;
  tone: string;
  text: string;
}) {
  const bullets = toBullets(text);
  if (bullets.length === 0) return null;
  return (
    <div>
      <div className={`flex items-center gap-1.5 text-xs font-semibold ${tone}`}>
        <PointIcon className="h-3.5 w-3.5" />
        {label}
      </div>
      <ul className="mt-1 grid gap-1 pl-5 text-[13px] leading-snug text-foreground/90">
        {bullets.map((b) => (
          <li key={b} className="list-disc marker:text-muted-foreground/60">
            {b}
          </li>
        ))}
      </ul>
    </div>
  );
}

// One update as a scannable card: a topic icon and status colour, key facts as
// chips, three short bulleted points (what changed / why it matters / what to
// do), and the source + exact quote tucked into "Details" until wanted.
export function TaxUpdateCard({
  update,
  affected,
  myContext,
  index = 0,
}: {
  update: TaxUpdate;
  affected: PropertyRecord[];
  myContext: string;
  index?: number;
}) {
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [open, setOpen] = useState(false);

  async function explain() {
    setAsking(true);
    try {
      const { answer: a } = await askAboutDocument({
        question:
          "Explain in plain language how this Texas property-tax update may affect my property or my active case, " +
          "and what I should check. Use only the update text and my property/case summary below. " +
          "Do not give legal advice or predict outcomes; tell me to verify against the official source.",
        context: `UPDATE:\n${updateAsText(update)}\n\nMY PROPERTIES AND CASES:\n${myContext || "(none on file)"}`,
      });
      setAnswer(a);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not explain this update."));
    } finally {
      setAsking(false);
    }
  }

  const Hero = update.tags[0] ? TAG_ICON[update.tags[0]] : Scale;

  return (
    <article
      className="tu-rise tu-card overflow-hidden rounded-xl border border-border bg-card"
      style={{ animationDelay: `${Math.min(index, 8) * 70}ms` }}
    >
      <div className={`h-1.5 bg-gradient-to-r ${STATUS_TILE[update.status]}`} />
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-sm ${STATUS_TILE[update.status]}`}
          >
            <Hero className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_TONE[update.status]}`}
              >
                {STATUS_LABEL[update.status]}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  update.isNew ? "bg-accent/15 text-accent" : "bg-secondary text-muted-foreground"
                }`}
              >
                {update.isNew ? "New this week" : "Currently posted"}
              </span>
            </div>
            <h3 className="mt-1 text-sm font-semibold leading-snug">{update.title}</h3>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1">
            <MapPin className="h-3 w-3" />
            {update.counties.length ? update.counties.join(", ") : "All of Texas"}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1">
            <CalendarDays className="h-3 w-3" />
            {update.effectiveDate ?? "Effective date not stated"}
          </span>
          {update.tags.map((t) => {
            const TagIcon = TAG_ICON[t];
            return (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-muted-foreground"
              >
                <TagIcon className="h-3 w-3" />
                {TAG_LABEL[t]}
              </span>
            );
          })}
        </div>

        {affected.length > 0 && (
          <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs font-medium text-warning-foreground">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              May affect your property (
              {affected
                .slice(0, 3)
                .map((p) => p.address)
                .join("; ")}
              {affected.length > 3 ? `; +${affected.length - 3} more` : ""})
            </span>
          </p>
        )}

        <div className="mt-3 grid gap-3">
          <Points
            icon={FileText}
            label="What changed"
            tone="text-sky-700"
            text={update.whatChanged}
          />
          <Points
            icon={Lightbulb}
            label="Why it matters"
            tone="text-amber-700"
            text={update.whyItMatters}
          />
          <Points
            icon={CheckCircle2}
            label="What to do"
            tone="text-emerald-700"
            text={update.actionNeeded}
          />
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
        >
          Who it affects &amp; source
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        <div
          className={`grid transition-all duration-300 ${open ? "mt-2 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
        >
          <div className="overflow-hidden">
            <div className="grid gap-2 rounded-lg bg-secondary/40 p-3 text-xs">
              <div>
                <span className="font-semibold">Who it affects: </span>
                {update.affects}
              </div>
              <div className="italic text-muted-foreground">“{update.quote}”</div>
              <a
                href={update.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-accent hover:underline"
              >
                {update.sourceName}
                <ExternalLink className="h-3 w-3" />
                <span className="ml-1 text-muted-foreground">
                  checked {new Date(update.sourceCheckedAt).toLocaleDateString()}
                </span>
              </a>
            </div>
          </div>
        </div>

        <div className="mt-3">
          <button
            type="button"
            onClick={() => void explain()}
            disabled={asking}
            className="btn-outline text-xs py-1 disabled:opacity-60"
          >
            {asking ? "Thinking…" : answer ? "Explain again" : "How could this affect my property?"}
          </button>
          {answer && <MarkdownLite text={answer} className="mt-2 text-xs text-muted-foreground" />}
        </div>
      </div>
    </article>
  );
}
