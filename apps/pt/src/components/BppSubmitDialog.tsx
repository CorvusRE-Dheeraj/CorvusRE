import { useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Mail } from "lucide-react";
import { WorkflowPopup, FileButton } from "@/components/case/workflow-ui";
import { CountyResearchPanel } from "@/components/CountyResearchPanel";
import { useCountyResearch } from "@/lib/county-research";
import { lookupCadDirectory } from "@/lib/cad-directory";
import { getErrorMessage } from "@/lib/error-message";
import {
  recordExtension,
  recordRenditionSubmission,
  signedRenditionUrl,
  uploadRenditionConfirmation,
  type BppAccountRecord,
} from "@/lib/bpp-accounts";
import {
  SUBMISSION_METHOD_LABEL,
  daysUntil,
  effectiveRenditionDeadline,
  renditionEmailLink,
} from "@/lib/bpp-rendition";

const fmtDate = (d: string | null | undefined) =>
  d
    ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "—";
const input = "mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm";

type Method = {
  key: string;
  method: string;
  detail: string;
  url: string | null;
  email: string | null;
  address: string | null;
  source: string;
};

// Submit Rendition / View Submission Instructions: the ways THIS appraisal
// district accepts a rendition (read from its official pages by the county
// research engine, plus the Comptroller directory's contact facts), the
// deadline and extension, and the owner's own record of submitting it.
// CorvusPT never submits it or marks it submitted by itself.
export function BppSubmitDialog({
  account,
  onClose,
  onUpdate,
  instructionsOnly = false,
}: {
  account: BppAccountRecord;
  onClose: () => void;
  onUpdate: (a: BppAccountRecord) => void;
  instructionsOnly?: boolean;
}) {
  const { research, loading, reload } = useCountyResearch(account.cad, "bpp_rendition");
  const dir = lookupCadDirectory(account.cad);
  const ad = dir?.appraisalDistrict;

  const methods: Method[] = [
    ...(research?.submission ?? []).map((s, i) => ({
      key: `r${i}`,
      ...s,
      source: "official page",
    })),
  ];
  // the directory's facts fill in what the research didn't find
  if (ad?.email && !methods.some((m) => m.email?.toLowerCase() === ad.email!.toLowerCase()))
    methods.push({
      key: "d-email",
      method: "email",
      detail: "Appraisal district email (Comptroller directory) — confirm it accepts renditions",
      url: null,
      email: ad.email,
      address: null,
      source: "Comptroller directory",
    });
  if (ad?.mailingAddress && !methods.some((m) => m.method === "mail"))
    methods.push({
      key: "d-mail",
      method: "mail",
      detail: "Mail to the appraisal district",
      url: null,
      email: null,
      address: ad.mailingAddress,
      source: "Comptroller directory",
    });
  if (ad?.streetAddress && !methods.some((m) => m.method === "in_person"))
    methods.push({
      key: "d-in",
      method: "in_person",
      detail: "Deliver in person",
      url: null,
      email: null,
      address: ad.streetAddress,
      source: "Comptroller directory",
    });

  const [picked, setPicked] = useState<string | null>(null);
  const sel = methods.find((m) => m.key === picked) ?? null;
  const [recording, setRecording] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<string>("online");
  const [note, setNote] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [granted, setGranted] = useState(account.extensionGrantedUntil ?? "");
  const [busy, setBusy] = useState(false);

  const dl = effectiveRenditionDeadline(account);
  const days = daysUntil(dl.date);

  async function run(fn: () => Promise<BppAccountRecord>, ok: string) {
    setBusy(true);
    try {
      onUpdate(await fn());
      toast.success(ok);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save that."));
    } finally {
      setBusy(false);
    }
  }

  async function attachSigned() {
    if (!account.renditionDocumentPath) return;
    window.open(await signedRenditionUrl(account.renditionDocumentPath), "_blank", "noopener");
  }

  return (
    <WorkflowPopup
      open
      onClose={onClose}
      wide
      title={instructionsOnly ? "Submission instructions" : "Submit Rendition"}
      description={`${account.businessName} · ${account.cad ?? "county not set"}`}
    >
      <div className="grid gap-4 text-sm">
        <div
          className={`rounded-md p-3 ${days < 0 && !account.renditionFiledAt ? "bg-destructive/10" : "bg-secondary/40"}`}
        >
          <span className="font-semibold">Deadline: {fmtDate(dl.date)}</span>{" "}
          {dl.basis === "extension"
            ? "(extension you recorded as granted)"
            : "(April 15 — the usual Texas deadline; check your county)"}
          {!account.renditionFiledAt && (
            <span className="ml-1 text-muted-foreground">
              ·{" "}
              {days >= 0
                ? `${days} day${days === 1 ? "" : "s"} left`
                : `${-days} day${days === -1 ? "" : "s"} past`}
            </span>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            On written request the chief appraiser must extend the deadline to May 15, and may
            extend it another 15 days for good cause (Tax Code §22.23). A request isn&apos;t an
            extension until the district grants it. Late renditions can carry a 10% penalty
            (§22.28).
          </p>
          {!instructionsOnly && (
            <div className="mt-2 flex flex-wrap items-end gap-3 text-xs">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={!!account.extensionRequestedAt}
                  disabled={busy}
                  onChange={(e) =>
                    void run(
                      () =>
                        recordExtension(account.id, {
                          requested: e.target.checked,
                          grantedUntil: account.extensionGrantedUntil,
                        }),
                      e.target.checked
                        ? "Extension request recorded."
                        : "Extension request cleared.",
                    )
                  }
                />
                I requested an extension
                {account.extensionRequestedAt ? ` (${fmtDate(account.extensionRequestedAt)})` : ""}
              </label>
              {account.extensionRequestedAt && (
                <label>
                  Granted until
                  <input
                    type="date"
                    className={input}
                    value={granted}
                    onChange={(e) => setGranted(e.target.value)}
                  />
                </label>
              )}
              {account.extensionRequestedAt &&
                granted !== (account.extensionGrantedUntil ?? "") && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          recordExtension(account.id, {
                            requested: true,
                            grantedUntil: granted || null,
                          }),
                        "Extension saved.",
                      )
                    }
                    className="btn-outline py-1 text-xs"
                  >
                    Save
                  </button>
                )}
            </div>
          )}
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Ways to submit to {account.cad ?? "the appraisal district"}
          </p>
          {loading && methods.length === 0 ? (
            <p className="mt-1 text-muted-foreground">
              Corvus AI is reading the appraisal district&apos;s official pages…
            </p>
          ) : methods.length === 0 ? (
            <p className="mt-1 text-muted-foreground">
              No submission methods could be confirmed for this county. Contact the appraisal
              district
              {ad?.phone ? ` (${ad.phone})` : ""}
              {ad?.website ? ` or check ${ad.website}` : ""}.
            </p>
          ) : (
            <div className="mt-1 grid gap-1.5">
              {methods.map((m) => (
                <label
                  aria-label={`${SUBMISSION_METHOD_LABEL[m.method] ?? m.method}: ${m.detail}`}
                  key={m.key}
                  className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 ${picked === m.key ? "border-accent bg-accent/5" : "border-border"}`}
                >
                  <input
                    type="radio"
                    className="mt-1"
                    checked={picked === m.key}
                    onChange={() => {
                      setPicked(m.key);
                      setMethod(m.method);
                    }}
                  />
                  <span>
                    <span className="font-medium">
                      {SUBMISSION_METHOD_LABEL[m.method] ?? m.method}
                    </span>
                    <span className="text-muted-foreground"> — {m.detail}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      Source: {m.source}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        {sel && (
          <div className="grid gap-2 rounded-md border border-accent/40 p-3">
            <p className="font-medium">{SUBMISSION_METHOD_LABEL[sel.method] ?? sel.method}</p>
            {sel.url && (
              <a
                href={sel.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-accent hover:underline"
              >
                Open the portal <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            {sel.email && (
              <div className="grid gap-1">
                <span>Email: {sel.email}</span>
                <a
                  href={renditionEmailLink(sel.email, account)}
                  className="btn-outline inline-flex w-fit items-center gap-1 py-1 text-xs"
                >
                  <Mail className="h-3.5 w-3.5" /> Start the email
                </a>
                <span className="text-xs text-muted-foreground">
                  Opens your email app with the details filled in — attach the signed rendition
                  {account.renditionDocumentPath && (
                    <>
                      {" "}
                      (
                      <button
                        onClick={() => void attachSigned()}
                        className="text-accent hover:underline"
                      >
                        download it
                      </button>
                      )
                    </>
                  )}{" "}
                  and send it yourself.
                </span>
              </div>
            )}
            {sel.address && <span className="whitespace-pre-line">Address: {sel.address}</span>}
            <span className="text-xs text-muted-foreground">
              {sel.method === "mail"
                ? "Mail it so it's postmarked by the deadline; certified mail gives you proof of delivery."
                : sel.method === "in_person"
                  ? "Ask for a date-stamped copy as your receipt."
                  : sel.method === "online"
                    ? "Save or screenshot the confirmation page."
                    : "Keep any confirmation you receive."}
            </span>
          </div>
        )}

        {!account.renditionSignedAt && !account.renditionFiledAt && (
          <p className="rounded-md bg-warning/10 p-2 text-xs">
            The rendition isn&apos;t signed in CorvusPT yet — sign it (or upload the hand-signed
            copy) before submitting.
          </p>
        )}

        {!instructionsOnly &&
          (account.renditionFiledAt ? (
            <div className="rounded-md border border-success/40 bg-success/5 p-3">
              <p className="font-medium">
                You recorded it as submitted on {fmtDate(account.renditionFiledAt)}
                {account.renditionSubmissionMethod
                  ? ` by ${SUBMISSION_METHOD_LABEL[account.renditionSubmissionMethod]?.toLowerCase() ?? account.renditionSubmissionMethod}`
                  : ""}
                .
              </p>
              {account.renditionSubmissionNote && (
                <p className="text-xs text-muted-foreground">{account.renditionSubmissionNote}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {account.renditionConfirmationPath ? (
                  <button
                    onClick={() =>
                      void signedRenditionUrl(account.renditionConfirmationPath!).then((u) =>
                        window.open(u, "_blank", "noopener"),
                      )
                    }
                    className="text-xs text-accent hover:underline"
                  >
                    View confirmation
                  </button>
                ) : (
                  <FileButton
                    label="Upload Confirmation"
                    disabled={busy}
                    onFile={(f) =>
                      void run(
                        () => uploadRenditionConfirmation(account.id, f),
                        "Confirmation saved.",
                      )
                    }
                  />
                )}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Status: submitted — the appraisal district&apos;s notice of appraised value follows
                (usually from April/May).
              </p>
            </div>
          ) : recording ? (
            <div className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-3">
              <label className="text-xs">
                Date submitted
                <input
                  type="date"
                  className={input}
                  value={date}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <label className="text-xs">
                Method
                <select
                  className={input}
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                >
                  {Object.entries(SUBMISSION_METHOD_LABEL).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <div className="text-xs">
                Confirmation (receipt, email, tracking)
                <div className="mt-1">
                  <FileButton label={proof ? proof.name : "Upload (optional)"} onFile={setProof} />
                </div>
              </div>
              <label className="text-xs sm:col-span-3">
                Note (confirmation number, tracking number…)
                <input className={input} value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              <div className="flex gap-2 sm:col-span-3">
                <button
                  disabled={busy || !date}
                  onClick={() =>
                    void run(
                      () =>
                        recordRenditionSubmission(account.id, {
                          date,
                          method,
                          note,
                          confirmation: proof,
                        }),
                      "Recorded as submitted.",
                    ).then(() => setRecording(false))
                  }
                  className="btn-accent py-1 text-xs disabled:opacity-60"
                >
                  {busy ? "Saving…" : "Save — I Submitted It"}
                </button>
                <button onClick={() => setRecording(false)} className="btn-outline py-1 text-xs">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setRecording(true)}
              className="btn-primary btn-primary-hover w-fit"
            >
              Mark as Submitted
            </button>
          ))}

        <details>
          <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
            Official rules & sources
          </summary>
          <div className="mt-2">
            <CountyResearchPanel research={research} loading={loading} onRefresh={reload} />
          </div>
        </details>
      </div>
    </WorkflowPopup>
  );
}
