import { useCallback, useEffect, useState } from "react";
import { BellRing, CheckCircle2, Copy, ExternalLink, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/error-message";
import { getStaffRole } from "@/lib/marketing";
import { supabase } from "@/lib/supabase";
import { plainCitations } from "@/lib/tax-updates";

// CorvusPT Regulatory Watch — staff only. generate-tax-updates checks the
// official Texas sources daily; every NEW change it judges material for
// commercial owners (deadlines, protest procedures, evidence, hearings,
// representation) lands here: what changed, what applied before, why it
// matters and a recommended action for owners. Customers never see this panel
// (RLS: staff only).

type TaxAlert = {
  id: string;
  created_at: string;
  title: string;
  area: string;
  status: string;
  what_changed: string;
  effective_date: string | null;
  owner_impact: string | null;
  corvus_impact: string | null;
  recommended_action: string | null;
  counties: string[];
  source_name: string;
  source_url: string;
  quote: string;
  previously_applied: string | null;
  marketing_sentence: string | null;
  verification_note: string | null;
  related_sources: { name: string; url: string }[] | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
};

const AREA_LABEL: Record<string, string> = {
  deadlines: "Filing deadlines",
  protest_procedures: "Protest procedures",
  evidence: "Evidence requirements",
  hearings: "Hearings",
  representation: "Representation",
  valuation: "Valuation",
  tax_rate: "Tax rates",
  other: "Other",
};
const STATUS_LABEL: Record<string, string> = {
  enacted_law: "Enacted law",
  adopted_rule: "Adopted administrative rule",
  proposed_rule: "Proposed rule",
  pending_legislation: "Pending bill",
  notice_guidance: "Notice / guidance",
};

export function TaxRegulatoryWatch({ lastChecked }: { lastChecked: string | null }) {
  const { user } = useAuth();
  const [staff, setStaff] = useState(false);
  const [alerts, setAlerts] = useState<TaxAlert[] | null>(null);
  const [showReviewed, setShowReviewed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    supabase
      .from("tax_update_alerts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data }) =>
        setAlerts(
          ((data ?? []) as TaxAlert[]).map((a) => ({
            ...a,
            title: plainCitations(a.title),
            what_changed: plainCitations(a.what_changed),
            owner_impact: a.owner_impact && plainCitations(a.owner_impact),
            recommended_action: a.recommended_action && plainCitations(a.recommended_action),
            quote: plainCitations(a.quote),
            previously_applied: a.previously_applied && plainCitations(a.previously_applied),
            marketing_sentence: a.marketing_sentence && plainCitations(a.marketing_sentence),
          })),
        ),
      );
  }, []);

  useEffect(() => {
    if (!user) return;
    void getStaffRole(user.id).then((r) => {
      const isStaff =
        r.isSuperAdmin || r.isMarketingAdmin || r.isSupportAdmin || r.isOperationsAdmin;
      setStaff(isStaff);
      if (isStaff) load();
    });
  }, [user, load]);

  if (!staff || !alerts) return null;
  const open = alerts.filter((a) => !a.reviewed_at);
  const reviewed = alerts.filter((a) => a.reviewed_at);
  const review = async (a: TaxAlert) => {
    setBusy(a.id);
    try {
      const { error } = await supabase.rpc("review_tax_alert", { p_id: a.id, p_note: null });
      if (error) throw error;
      toast.success("Marked reviewed.");
      load();
    } catch (e) {
      toast.error(getErrorMessage(e, "Couldn't mark it reviewed."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      className="card-elev mt-6 grid grid-cols-[minmax(0,1fr)] gap-3 border-accent/40 p-5"
      aria-label="Regulatory Watch"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-serif text-lg font-semibold">
            <ShieldAlert className="h-5 w-5 text-accent" /> Regulatory Watch — for the CorvusPT team
          </h2>
          <p className="text-xs text-muted-foreground">
            Official Texas sources are checked daily; you&apos;re alerted only when a material
            change for commercial owners is found (deadlines, protest procedures, evidence,
            hearings, representation). Staff only — customers don&apos;t see this panel.
            {lastChecked && ` Last checked ${new Date(lastChecked).toLocaleString()}.`}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${open.length ? "bg-warning/20 text-warning-foreground" : "bg-success/15 text-success"}`}
        >
          {open.length ? `${open.length} to review` : "No open alerts"}
        </span>
      </div>

      {open.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No material changes found{reviewed.length ? " since the last review" : " yet"}.
        </p>
      )}
      {open.map((a) => (
        <AlertCard key={a.id} a={a} onReview={() => void review(a)} busy={busy === a.id} />
      ))}

      {reviewed.length > 0 && (
        <div>
          <button
            type="button"
            className="text-xs text-accent hover:underline"
            onClick={() => setShowReviewed(!showReviewed)}
          >
            {showReviewed ? "Hide" : "Show"} reviewed alerts ({reviewed.length})
          </button>
          {showReviewed && (
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-2">
              {reviewed.map((a) => (
                <AlertCard key={a.id} a={a} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function AlertCard({ a, onReview, busy }: { a: TaxAlert; onReview?: () => void; busy?: boolean }) {
  return (
    <article
      className={`rounded-lg border p-4 text-sm [overflow-wrap:anywhere] ${a.reviewed_at ? "border-border opacity-80" : "border-warning/50 bg-warning/5"}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <BellRing className="h-3.5 w-3.5 text-warning-foreground" />
        <span className="font-semibold">{AREA_LABEL[a.area] ?? a.area}</span>
        <span className="rounded-full bg-secondary px-2 py-0.5">
          {STATUS_LABEL[a.status] ?? a.status}
        </span>
        {a.counties.length > 0 && (
          <span className="text-muted-foreground">{a.counties.join(", ")}</span>
        )}
        <span className="text-muted-foreground">
          found {new Date(a.created_at).toLocaleDateString()}
        </span>
      </div>
      <h3 className="mt-1.5 font-semibold">{a.title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">Status:</span>{" "}
        {STATUS_LABEL[a.status] ?? a.status} ·{" "}
        <span className="font-semibold text-foreground">Effective:</span>{" "}
        {a.effective_date ? longDate(a.effective_date) : "not stated on the source"}
      </p>
      <dl className="mt-2 grid gap-1.5">
        <Row label="1. What changed">{a.what_changed}</Row>
        <Row label="2. What previously applied">
          {(a.previously_applied ?? "Not stated on the official source.").replace(
            /^background:\s*/i,
            "",
          )}
          {/^background:/i.test(a.previously_applied ?? "") && (
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Background from Corvus AI — not from the official page; verify.
            </span>
          )}
        </Row>
        <Row label="3. Why it matters to commercial owners">{a.owner_impact ?? "Not stated"}</Row>
        <Row label="4. Recommended action for owners">
          {a.recommended_action ?? "Check the official source."}
        </Row>
        <Row label="5. Official sources">
          <ul className="grid gap-0.5">
            {(a.related_sources?.length
              ? a.related_sources
              : [{ name: a.source_name, url: a.source_url }]
            ).map((s) => (
              <li key={s.url}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-accent hover:underline"
                >
                  {s.name} <ExternalLink className="h-3 w-3" />
                </a>
              </li>
            ))}
          </ul>
          <span className="mt-1 block text-xs italic text-muted-foreground">
            “{a.quote}” — {a.source_name}
          </span>
        </Row>
        {a.marketing_sentence && (
          <Row label="6. Marketing-ready sentence">
            <span className="block rounded-md bg-secondary/60 p-2">{a.marketing_sentence}</span>
            <button
              type="button"
              className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:underline"
              onClick={() =>
                void navigator.clipboard
                  .writeText(a.marketing_sentence!)
                  .then(() => toast.success("Copied — review before you post it."))
                  .catch(() => toast.error("Couldn't copy."))
              }
            >
              <Copy className="h-3 w-3" /> Copy
            </button>
          </Row>
        )}
        {a.verification_note && (
          <Row label="Verification note">
            <span className="text-muted-foreground">{a.verification_note}</span>
          </Row>
        )}
      </dl>
      {a.reviewed_at ? (
        <p className="mt-2 flex items-center gap-1 text-xs text-success">
          <CheckCircle2 className="h-3.5 w-3.5" /> Reviewed{" "}
          {new Date(a.reviewed_at).toLocaleDateString()}
        </p>
      ) : (
        onReview && (
          <button
            type="button"
            disabled={busy}
            onClick={onReview}
            className="btn-outline mt-3 py-1 text-xs disabled:opacity-60"
          >
            {busy ? "Saving…" : "Mark reviewed"}
          </button>
        )
      )}
    </article>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

/** "2026-10-25" → "October 25, 2026"; anything else as written on the source. */
function longDate(d: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(d)
    ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : d;
}
