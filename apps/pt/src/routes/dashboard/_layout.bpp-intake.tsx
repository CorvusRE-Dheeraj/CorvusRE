import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { addBppAccount, nextBppRenditionDeadline } from "@/lib/bpp-accounts";
import { SUPPORTED_COUNTY_NAMES } from "@/lib/cad-record-url";
import { classifyDocument, validateDocument, type Extraction } from "@/lib/document-ai";
import { getFirstPage } from "@/lib/pdf-utils";
import { fileToDataUrl, readIntake, UPLOAD_LIMITS } from "@/lib/intake-store";

export const Route = createFileRoute("/dashboard/_layout/bpp-intake")({
  component: BppIntake,
});

const COUNTIES = Array.from(SUPPORTED_COUNTY_NAMES).sort();

type Step = "business" | "value" | "confirm";

function isBppDocument(e: Extraction): boolean {
  return e.documentType === "BPP Rendition Form" || e.documentType === "BPP Appraisal Notice";
}

function BppIntake() {
  const { user } = useAuth();
  const nav = useNavigate();

  const [step, setStep] = useState<Step>("business");
  const [businessName, setBusinessName] = useState("");
  const [cad, setCad] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [locationAddress, setLocationAddress] = useState("");

  const [taxYear, setTaxYear] = useState("");
  const [renderedValue, setRenderedValue] = useState("");
  const [priorValue, setPriorValue] = useState("");
  const [noticeValue, setNoticeValue] = useState("");
  const [protestDeadline, setProtestDeadline] = useState("");

  const [extracting, setExtracting] = useState(false);
  const [extractNote, setExtractNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Synchronous double-submit guard — see handleSave below for why the
  // `saving` state (and the button's own disabled attribute) isn't enough.
  const savingRef = useRef(false);

  // A document classified upstream by document-review.tsx (the real-property
  // intake funnel's own upload step) as a BPP document routes here — reuse
  // that extraction instead of asking the user to upload the same file
  // again. Session-scoped guest intake state, same store real-estate intake
  // already uses; only ever read here, never written, so it can't interfere
  // with an in-progress real-estate intake in the same tab.
  useEffect(() => {
    const prior = readIntake().extraction;
    if (prior && isBppDocument(prior)) applyExtraction(prior);
  }, []);

  function applyExtraction(e: Extraction) {
    setBusinessName((prev) => prev || e.propertyName || e.ownerName || "");
    if (e.cadName) {
      const short = e.cadName.replace(/\s*(Central\s+)?Appraisal District$/i, "").trim();
      setCad((prev) => prev || (SUPPORTED_COUNTY_NAMES.has(short) ? short : e.county || ""));
    } else if (e.county) {
      setCad((prev) => prev || e.county!);
    }
    setAccountNumber((prev) => prev || e.accountNumber || "");
    setLocationAddress((prev) => prev || e.propertyAddress || e.situsAddress || "");
    if (e.taxYear != null) setTaxYear((prev) => prev || String(e.taxYear));
    if (e.bppValue != null) setRenderedValue((prev) => prev || String(e.bppValue));
    if (e.priorValue != null) setPriorValue((prev) => prev || String(e.priorValue));
    if (e.noticeValue != null) setNoticeValue((prev) => prev || String(e.noticeValue));
    if (e.protestDeadline) setProtestDeadline((prev) => prev || e.protestDeadline!.slice(0, 10));
  }

  async function handleUpload(file: File) {
    if (file.size > UPLOAD_LIMITS.maxFileBytes) {
      toast.error(
        `Document exceeds ${Math.round(UPLOAD_LIMITS.maxFileBytes / (1024 * 1024))} MB maximum file size.`,
      );
      return;
    }
    if (!/pdf|png|jpe?g/i.test(file.type)) {
      toast.error("Supported types: PDF, PNG, JPG.");
      return;
    }
    setExtracting(true);
    setExtractNote(null);
    try {
      const firstPage = await getFirstPage(file);
      if (firstPage.pageCount > UPLOAD_LIMITS.maxPages) {
        throw new Error(
          `This document has ${firstPage.pageCount} pages — the maximum is ${UPLOAD_LIMITS.maxPages}.`,
        );
      }
      const validation = await validateDocument({
        fileName: file.name,
        mimeType: firstPage.mimeType,
        dataUrl: firstPage.dataUrl,
      });
      if (!validation.isValid) {
        throw new Error(
          validation.reason ??
            "This doesn't look like a Texas property tax document. Please try another file.",
        );
      }
      const dataUrl = await fileToDataUrl(file);
      const extraction = await classifyDocument({
        fileName: file.name,
        mimeType: file.type,
        dataUrl,
      });
      applyExtraction(extraction);
      setExtractNote(
        isBppDocument(extraction)
          ? `Read as a ${extraction.documentType} — values below were filled in from it.`
          : `This looked like a ${extraction.documentType}, not a BPP document — check the values below before continuing.`,
      );
      toast.success("Document read — review the values below.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read this document.");
    } finally {
      setExtracting(false);
    }
  }

  const businessValid = businessName.trim().length > 0;

  async function handleSave() {
    if (!user || !businessValid) return;
    // `disabled={saving}` alone does NOT stop a real double-click: setSaving
    // is a React state update, so the button only actually becomes disabled
    // on the next render, and a second click landing inside that window runs
    // this handler again. Reproduced live — two rapid clicks on "Save BPP
    // Account" created two identical bpp_accounts rows 265ms apart. A ref
    // flips synchronously, so the second call returns immediately. (Same
    // pattern as signingOutRef in src/lib/auth.tsx.)
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await addBppAccount(user.id, {
        businessName: businessName.trim(),
        accountNumber: accountNumber.trim() || undefined,
        cad: cad.trim() || undefined,
        locationAddress: locationAddress.trim() || undefined,
        taxYear: taxYear ? Number(taxYear) : undefined,
        renderedValue: renderedValue ? Number(renderedValue) : undefined,
        priorValue: priorValue ? Number(priorValue) : undefined,
        noticeValue: noticeValue ? Number(noticeValue) : undefined,
        protestDeadline: protestDeadline || undefined,
      });
      toast.success("BPP account added.");
      nav({ to: "/dashboard/bpp-accounts" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save this BPP account.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const field = "rounded-md border border-input bg-background px-3 py-2 text-sm";
  const label = "grid gap-1 text-sm";
  const labelText = "text-xs font-medium text-muted-foreground";

  return (
    <div className="max-w-2xl">
      <h1 className="font-serif text-2xl font-semibold">Add a BPP Account</h1>
      <p className="text-muted-foreground text-sm">
        Business Personal Property — upload a prior rendition or the county's BPP notice and AI
        fills in the real values, or enter them yourself.
      </p>

      <div className="mt-6 flex items-center gap-2 text-xs">
        {(["business", "value", "confirm"] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <span className="text-muted-foreground">→</span>}
            <span
              className={`rounded-full px-2.5 py-1 ${
                step === s
                  ? "bg-accent text-accent-foreground font-semibold"
                  : "bg-secondary text-muted-foreground"
              }`}
            >
              {i + 1}. {s === "business" ? "Business" : s === "value" ? "Value" : "Confirm"}
            </span>
          </div>
        ))}
      </div>

      {step === "business" && (
        <div className="card-elev mt-6 grid gap-4 p-6">
          <label className={label}>
            <span className={labelText}>
              Business Name<span className="text-destructive"> *</span>
            </span>
            <input
              className={field}
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="e.g. Acme Fabrication LLC"
            />
          </label>
          <label className={label}>
            <span className={labelText}>County / CAD</span>
            <select className={field} value={cad} onChange={(e) => setCad(e.target.value)}>
              <option value="">Select a county (optional)</option>
              {COUNTIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value="Other">Other</option>
            </select>
          </label>
          <label className={label}>
            <span className={labelText}>CAD Account Number (if known)</span>
            <input
              className={field}
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
            />
          </label>
          <label className={label}>
            <span className={labelText}>Business Location Address</span>
            <input
              className={field}
              value={locationAddress}
              onChange={(e) => setLocationAddress(e.target.value)}
            />
          </label>
          <button
            disabled={!businessValid}
            onClick={() => setStep("value")}
            className="btn-primary btn-primary-hover w-fit disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}

      {step === "value" && (
        <div className="card-elev mt-6 grid gap-4 p-6">
          <label className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-md border border-accent/40 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/10">
            <input
              type="file"
              accept="image/*,.pdf"
              disabled={extracting}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
                e.target.value = "";
              }}
            />
            <Upload className="h-3.5 w-3.5" />
            {extracting
              ? "Reading document…"
              : "Upload a prior rendition or BPP notice (AI reads it)"}
          </label>
          {extractNote && <p className="text-xs text-accent">{extractNote}</p>}
          <p className="text-xs text-muted-foreground">
            Or enter the values yourself — no document required.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>
              <span className={labelText}>Tax Year</span>
              <input
                className={field}
                value={taxYear}
                onChange={(e) => setTaxYear(e.target.value)}
                placeholder="2026"
              />
            </label>
            <label className={label}>
              <span className={labelText}>Rendered Value (good faith estimate)</span>
              <input
                className={field}
                type="number"
                value={renderedValue}
                onChange={(e) => setRenderedValue(e.target.value)}
              />
            </label>
            <label className={label}>
              <span className={labelText}>Prior Year Value (optional)</span>
              <input
                className={field}
                type="number"
                value={priorValue}
                onChange={(e) => setPriorValue(e.target.value)}
              />
            </label>
            <label className={label}>
              <span className={labelText}>County's Notice Value (if received)</span>
              <input
                className={field}
                type="number"
                value={noticeValue}
                onChange={(e) => setNoticeValue(e.target.value)}
              />
            </label>
            <label className={label}>
              <span className={labelText}>Protest Deadline (if a notice was received)</span>
              <input
                className={field}
                type="date"
                value={protestDeadline}
                onChange={(e) => setProtestDeadline(e.target.value)}
              />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            The statutory rendition deadline (April 15) is tracked automatically once this account
            is saved.
          </p>
          <div className="flex gap-2">
            <button onClick={() => setStep("business")} className="btn-outline">
              Back
            </button>
            <button onClick={() => setStep("confirm")} className="btn-primary btn-primary-hover">
              Next
            </button>
          </div>
        </div>
      )}

      {step === "confirm" && (
        <div className="card-elev mt-6 grid gap-4 p-6">
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-lg bg-secondary/40 p-4 text-sm sm:grid-cols-2">
            {[
              ["Business", businessName],
              ["County / CAD", cad || "—"],
              ["Account Number", accountNumber || "—"],
              ["Location", locationAddress || "—"],
              ["Tax Year", taxYear || "—"],
              [
                "Rendered Value",
                renderedValue ? `$${Number(renderedValue).toLocaleString("en-US")}` : "—",
              ],
              [
                "Notice Value",
                noticeValue ? `$${Number(noticeValue).toLocaleString("en-US")}` : "—",
              ],
              [
                "Rendition Deadline",
                new Date(`${nextBppRenditionDeadline()}T00:00:00`).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                }),
              ],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs font-medium text-muted-foreground">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <div className="flex gap-2">
            <button onClick={() => setStep("value")} className="btn-outline">
              Back
            </button>
            <button
              disabled={saving}
              onClick={handleSave}
              className="btn-primary btn-primary-hover disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save BPP Account"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
