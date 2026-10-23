import { useCallback, useEffect, useState } from "react";
import { BellRing, CheckCircle2, ExternalLink, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/error-message";
import { getStaffRole } from "@/lib/marketing";
import { supabase } from "@/lib/supabase";
import { plainCitations } from "@/lib/tax-updates";

// CorvusPT Regulatory Watch — staff only. generate-tax-updates checks the
// official Texas sources daily; every NEW change it judges material for
// commercial owners (deadlines, protest procedures, evidence, hearings,
// representation) lands here with what it means for CorvusPT and the
// recommended action. Customers never see this panel (RLS: staff only).

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
  adopted_rule: "Adopted rule",
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
            corvus_impact: a.corvus_impact && plainCitations(a.corvus_impact),
            recommended_action: a.recommended_action && plainCitations(a.recommended_action),
            quote: plainCitations(a.quote),
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
      <dl className="mt-2 grid gap-1.5">
        <Row label="What changed">{a.what_changed}</Row>
        <Row label="Effective date">{a.effective_date ?? "Not stated on the source"}</Row>
        {a.owner_impact && <Row label="Owner impact">{a.owner_impact}</Row>}
        <Row label="CorvusPT implications">{a.corvus_impact ?? "None"}</Row>
        <Row label="Recommended action">{a.recommended_action ?? "No action"}</Row>
        <Row label="Official source">
          <a
            href={a.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-accent hover:underline"
          >
            {a.source_name} <ExternalLink className="h-3 w-3" />
          </a>
          <span className="mt-0.5 block text-xs italic text-muted-foreground">“{a.quote}”</span>
        </Row>
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
