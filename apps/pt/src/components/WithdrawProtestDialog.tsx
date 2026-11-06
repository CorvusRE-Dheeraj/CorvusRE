import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  HelpCircle,
  Mail,
  Phone,
  XCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LoadingLine } from "@/components/LoadingLine";
import type { PropertyRecord } from "@/lib/properties";
import {
  countyCodeFor,
  downloadBytes,
  draftWithdrawal,
  letterPdf,
  letterText,
  loadWithdrawalRules,
  mailtoHref,
  methodOptions,
  phoneScriptText,
  suggestedMethod,
  telHref,
  type DistrictContact,
  type DraftFacts,
  type MethodOption,
  type PhoneDraft,
  type WithdrawalMethod,
  type WithdrawalRules,
  type WrittenDraft,
} from "@/lib/protest-withdrawal";

// Withdraw a protest, in three steps: pick the property → AI reads the county's
// own withdrawal rules and the owner picks how to send it (email, letter or
// phone) → AI writes it, ready to send, download or read out.

const METHOD_LABEL: Record<WithdrawalMethod, string> = {
  email: "Email",
  letter: "Written letter",
  phone: "Telephone",
};
const METHOD_ICON = { email: Mail, letter: FileText, phone: Phone } as const;

const STATUS_COPY: Record<
  MethodOption["status"],
  { text: string; tone: string; Icon: typeof CheckCircle2 }
> = {
  accepted: { text: "County accepts this", tone: "text-success", Icon: CheckCircle2 },
  not_accepted: { text: "County doesn't accept this", tone: "text-destructive", Icon: XCircle },
  unstated: {
    text: "Not stated by the county — confirm first",
    tone: "text-muted-foreground",
    Icon: HelpCircle,
  },
};

type Loaded = { rules: WithdrawalRules | null; contact: DistrictContact; countyCode: string };

export function WithdrawProtestDialog({
  open,
  onOpenChange,
  properties,
  initialPropertyId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  properties: PropertyRecord[];
  initialPropertyId?: string | null;
}) {
  const [propertyId, setPropertyId] = useState<string>("");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [method, setMethod] = useState<WithdrawalMethod | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [written, setWritten] = useState<{ subject: string; body: string } | null>(null);
  const [script, setScript] = useState<string | null>(null);
  const [facts, setFacts] = useState<DraftFacts | null>(null);
  const [downloading, setDownloading] = useState(false);

  const property = properties.find((p) => p.id === propertyId) ?? null;

  // Reset whenever the dialog opens, pre-selecting the property it was opened for.
  useEffect(() => {
    if (!open) return;
    setPropertyId(initialPropertyId ?? (properties.length === 1 ? properties[0].id : ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPropertyId]);

  // A new property: check that county's rules before anything is written.
  useEffect(() => {
    setLoaded(null);
    setRulesError(null);
    setMethod(null);
    setWritten(null);
    setScript(null);
    setFacts(null);
    if (!open || !property) return;
    const countyCode = countyCodeFor(property.cad);
    if (!countyCode) {
      setRulesError(
        `We couldn't match "${property.cad ?? "this property's county"}" to a Texas appraisal district. Add the county on the property, then try again.`,
      );
      return;
    }
    let live = true;
    setRulesLoading(true);
    loadWithdrawalRules(countyCode)
      .then((r) => {
        if (!live) return;
        setLoaded({ ...r, countyCode });
      })
      .catch((e) => {
        if (live)
          setRulesError(
            e instanceof Error && e.message
              ? e.message
              : "Couldn't check the county's rules. Please try again.",
          );
      })
      .finally(() => {
        if (live) setRulesLoading(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, propertyId]);

  const options = useMemo(
    () => (loaded ? methodOptions(loaded.rules, loaded.contact) : []),
    [loaded],
  );
  const suggested = options.length ? suggestedMethod(options) : null;
  const chosen = options.find((o) => o.method === method) ?? null;

  async function write() {
    if (!loaded || !property || !method) return;
    setDrafting(true);
    setWritten(null);
    setScript(null);
    try {
      const { draft, facts } = await draftWithdrawal(loaded.countyCode, property.id, method);
      setFacts(facts);
      if (method === "phone") setScript(phoneScriptText(draft as PhoneDraft));
      else {
        const d = draft as WrittenDraft;
        setWritten({
          subject: d.subject,
          body:
            method === "letter"
              ? letterText({ contact: loaded.contact, subject: d.subject, body: d.body, facts })
              : d.body,
        });
      }
    } catch (e) {
      toast.error(
        e instanceof Error && e.message
          ? e.message
          : "Couldn't write the withdrawal. Please try again.",
      );
    } finally {
      setDrafting(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy — select the text and copy it instead.");
    }
  }

  async function downloadLetter() {
    if (!written) return;
    setDownloading(true);
    try {
      const bytes = await letterPdf(written.body);
      const acct = (facts?.accountNumber ?? "property").replace(/[^\w-]+/g, "");
      downloadBytes(bytes, `Protest-Withdrawal-${acct}.pdf`, "application/pdf");
    } finally {
      setDownloading(false);
    }
  }

  const rules = loaded?.rules ?? null;
  const contact = loaded?.contact ?? null;
  const checked = rules?.retrievedAt
    ? new Date(rules.retrievedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-y-auto overflow-x-hidden rounded-lg p-4 sm:max-w-2xl sm:p-6 [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>Withdraw a Protest</DialogTitle>
          <DialogDescription>
            We check the county&apos;s current withdrawal rules first, then write the withdrawal the
            way you choose to send it.
          </DialogDescription>
        </DialogHeader>

        {/* Step 1 — property */}
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">Property</span>
          <select
            className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            aria-label="Property to withdraw the protest for"
          >
            <option value="">Select a property…</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.address}
                {p.cad ? ` — ${p.cad}` : ""}
              </option>
            ))}
          </select>
        </label>

        {property && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            <div className="flex gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
              <p>
                Withdrawing ends this protest for tax year {property.taxYear ?? "this year"}. The
                appraised value then stands, and once the protest deadline has passed you generally
                can&apos;t file a new protest for the same year.
              </p>
            </div>
          </div>
        )}

        {rulesLoading && property && (
          <LoadingLine
            text={`Checking ${property.cad ?? "the county"}'s current protest withdrawal rules…`}
            className="text-sm"
          />
        )}
        {rulesError && <p className="text-sm text-destructive">{rulesError}</p>}

        {/* Step 2 — the county's rules and the way to send it */}
        {loaded && contact && property && (
          <section className="grid gap-4" aria-label="County withdrawal rules">
            <div className="rounded-lg border p-4 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold">{contact.name}: how to withdraw</h3>
                {checked && (
                  <span className="text-xs text-muted-foreground">Checked {checked}</span>
                )}
              </div>
              {rules?.withdrawalDiscussed ? (
                <>
                  {rules.summary && <p className="mt-2">{rules.summary}</p>}
                  <dl className="mt-3 grid gap-2">
                    {rules.form.name && (
                      <Row label={rules.form.required ? "Required form" : "Form"}>
                        {rules.form.url ? (
                          <a
                            href={rules.form.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent underline"
                          >
                            {rules.form.name}
                          </a>
                        ) : (
                          rules.form.name
                        )}
                        {rules.form.required === false && " (optional)"}
                      </Row>
                    )}
                    {rules.deadline && <Row label="Deadline">{rules.deadline}</Row>}
                    {rules.online.accepted && rules.online.url && (
                      <Row label="Online">
                        <a
                          href={rules.online.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent underline"
                        >
                          Withdraw through the district&apos;s portal
                        </a>
                        {rules.online.notes && ` — ${rules.online.notes}`}
                      </Row>
                    )}
                  </dl>
                  {rules.steps.length > 0 && (
                    <div className="mt-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Steps
                      </div>
                      <ol className="mt-1 list-decimal space-y-1 pl-5">
                        {rules.steps.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ol>
                    </div>
                  )}
                  {rules.otherRequirements.length > 0 && (
                    <div className="mt-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Also required
                      </div>
                      <ul className="mt-1 list-disc space-y-1 pl-5">
                        {rules.otherRequirements.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <p className="mt-2 text-muted-foreground">
                  {rules
                    ? "The district's website doesn't spell out how to withdraw a protest."
                    : "We couldn't read the district's website just now."}{" "}
                  A written withdrawal (email or letter) naming your account number and tax year
                  gives you a record — call {contact.phone ?? "the district"} to confirm it&apos;s
                  been received.
                </p>
              )}
              {rules && rules.sourceUrls.length > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  From the district&apos;s own site:{" "}
                  {rules.sourceUrls.map((u, i) => (
                    <span key={u}>
                      {i > 0 && " · "}
                      <a href={u} target="_blank" rel="noreferrer" className="underline">
                        {new URL(u).pathname === "/" ? new URL(u).hostname : new URL(u).pathname}
                      </a>
                    </span>
                  ))}
                </p>
              )}
            </div>

            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">
                How do you want to send the withdrawal?
              </legend>
              <div
                role="radiogroup"
                aria-label="How to send the withdrawal"
                className="grid gap-2 sm:grid-cols-3"
              >
                {options.map((o) => {
                  const Icon = METHOD_ICON[o.method];
                  const s = STATUS_COPY[o.status];
                  const selected = method === o.method;
                  return (
                    <button
                      key={o.method}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => {
                        setMethod(o.method);
                        setWritten(null);
                        setScript(null);
                      }}
                      className={`rounded-lg border p-3 text-left text-sm transition-colors ${
                        selected
                          ? "border-accent bg-accent/5 ring-1 ring-accent"
                          : "hover:bg-muted/50"
                      }`}
                    >
                      <div className="flex items-center gap-2 font-medium">
                        <Icon className="h-4 w-4" aria-hidden />
                        {METHOD_LABEL[o.method]}
                        {suggested === o.method && (
                          <span className="ml-auto rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                            Suggested
                          </span>
                        )}
                      </div>
                      <div className={`mt-1 flex items-center gap-1 text-xs ${s.tone}`}>
                        <s.Icon className="h-3.5 w-3.5" aria-hidden />
                        {s.text}
                      </div>
                      <div className="mt-1 break-words text-xs text-muted-foreground">
                        {o.target ?? "No contact listed"}
                      </div>
                      {o.note && <div className="mt-1 text-xs">{o.note}</div>}
                    </button>
                  );
                })}
              </div>
              {chosen?.status === "not_accepted" && (
                <p className="text-xs text-destructive">
                  The district says it doesn&apos;t take withdrawals this way — pick another method
                  so it counts.
                </p>
              )}
              {chosen?.method === "phone" && chosen.status !== "accepted" && (
                <p className="text-xs text-muted-foreground">
                  A call leaves no record. Ask the district whether you also need to send it in
                  writing, and note the name of who you spoke with.
                </p>
              )}
            </fieldset>

            <div>
              <button
                type="button"
                className="btn-primary btn-primary-hover"
                disabled={!method || drafting || chosen?.status === "not_accepted"}
                onClick={write}
              >
                {drafting
                  ? "Writing…"
                  : method === "phone"
                    ? "Write my phone script"
                    : method === "letter"
                      ? "Write my letter"
                      : method === "email"
                        ? "Write my email"
                        : "Choose how to send it"}
              </button>
            </div>
          </section>
        )}

        {/* Step 3 — ready to send */}
        {written && chosen && method !== "phone" && (
          <section className="grid gap-3" aria-label="Your withdrawal">
            {method === "email" && (
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Subject</span>
                <input
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={written.subject}
                  onChange={(e) => setWritten({ ...written, subject: e.target.value })}
                />
              </label>
            )}
            <label className="grid gap-1 text-sm">
              <span className="font-medium">
                {method === "email" ? "Email" : "Letter"} — edit anything before sending
              </span>
              <textarea
                className="min-h-[260px] rounded-md border border-input bg-background px-3 py-2 font-mono text-[13px] leading-relaxed"
                value={written.body}
                onChange={(e) => setWritten({ ...written, body: e.target.value })}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {method === "email" && chosen.target && (
                <a
                  className="btn-primary btn-primary-hover inline-flex items-center gap-2"
                  href={mailtoHref(chosen.target, written.subject, written.body)}
                >
                  <Mail className="h-4 w-4" aria-hidden /> Email {chosen.target}
                </a>
              )}
              {method === "letter" && (
                <button
                  type="button"
                  className="btn-primary btn-primary-hover inline-flex items-center gap-2"
                  onClick={downloadLetter}
                  disabled={downloading}
                >
                  <Download className="h-4 w-4" aria-hidden />{" "}
                  {downloading ? "Preparing…" : "Download letter (PDF)"}
                </button>
              )}
              <button
                type="button"
                className="btn-outline inline-flex items-center gap-2"
                onClick={() =>
                  copy(
                    method === "email"
                      ? `Subject: ${written.subject}\n\n${written.body}`
                      : written.body,
                  )
                }
              >
                <Copy className="h-4 w-4" aria-hidden /> Copy
              </button>
              {rules?.form.url && (
                <a
                  className="btn-outline inline-flex items-center gap-2"
                  href={rules.form.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden /> Open the county form
                </a>
              )}
            </div>
            {method === "letter" && (
              <p className="text-xs text-muted-foreground">
                Sign it, then mail or hand-deliver it to {chosen.target ?? "the appraisal district"}
                . Certified mail with a return receipt gives you proof it arrived.
              </p>
            )}
            {method === "email" && (
              <p className="text-xs text-muted-foreground">
                Opens in your email app. Keep the sent email; ask the district to confirm it was
                received.
              </p>
            )}
          </section>
        )}

        {script && chosen && method === "phone" && (
          <section className="grid gap-3" aria-label="Your phone script">
            <label className="grid gap-1 text-sm">
              <span className="font-medium">What to say</span>
              <textarea
                className="min-h-[260px] rounded-md border border-input bg-background px-3 py-2 text-[13px] leading-relaxed"
                value={script}
                onChange={(e) => setScript(e.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {chosen.target && (
                <a
                  className="btn-primary btn-primary-hover inline-flex items-center gap-2"
                  href={telHref(chosen.target)}
                >
                  <Phone className="h-4 w-4" aria-hidden /> Call {chosen.target}
                </a>
              )}
              <button
                type="button"
                className="btn-outline inline-flex items-center gap-2"
                onClick={() => copy(script)}
              >
                <Copy className="h-4 w-4" aria-hidden /> Copy script
              </button>
            </div>
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[130px_1fr] sm:gap-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground sm:pt-0.5">
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}
