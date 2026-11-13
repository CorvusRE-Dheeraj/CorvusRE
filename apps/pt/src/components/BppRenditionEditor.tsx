import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Mic, MicOff, Sparkles, Trash2, Plus, Check } from "lucide-react";
import { Modal } from "@/components/Modal";
import { SignaturePad, type SignatureValue } from "@/components/SignaturePad";
import {
  BPP_RENDITION_SCHEMA,
  getBppRenditionDefaults,
  buildPdf,
  signPdf,
  downloadPdf,
  resolveDateInput,
  resolveDateFields,
  type FieldValues,
} from "@/lib/protest-documents";
import {
  signRendition,
  recordRenditionPaperSigned,
  signedRenditionUrl,
  saveRenditionValues,
  saveRenditionVerification,
  type BppAccountRecord,
  type RenditionAsset,
  type RenditionVerification,
} from "@/lib/bpp-accounts";
import {
  assetTotal,
  assetsFromAi,
  assetsFromGrid,
  extractJson,
  renditionMissing,
  scheduleAFields,
} from "@/lib/bpp-rendition";
import { askAboutDocument } from "@/lib/document-ai";
import { readSpreadsheet } from "@/lib/spreadsheet-import";
import { fileToDataUrl } from "@/lib/intake-store";
import { useSpeechInput } from "@/hooks/use-speech-input";
import { getErrorMessage } from "@/lib/error-message";
import { newTrackingId } from "@/lib/signing-packets";
import { SigningIdBadge } from "@/components/SigningIdBadge";
import { FileButton } from "@/components/case/workflow-ui";

const TEMPLATE_PATH = "forms/50-144.pdf";
const MAX_AI_FILE = 8 * 1024 * 1024;
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

// The fields Corvus AI may fill (autofill / dictation): the form's own names.
const FILLABLE = BPP_RENDITION_SCHEMA.flatMap((s) => s.fields)
  .filter((f) => !f.name.startsWith("ScA:") && f.name !== "Total market value of your property")
  .map((f) => (f.type === "radio" ? `${f.name} (one of: ${f.options.join(" | ")})` : f.name));

// Form 50-144 for one BPP account: filled in here (by hand, by Corvus AI from
// what CorvusPT already knows, by dictation, or from supporting files),
// saved as the owner goes, then signed online OR downloaded, signed by hand and
// uploaded. Submitting to the county is the owner's step (onSubmit opens the
// Submit Rendition popup) — nothing here sends or files anything.
export function BppRenditionEditor({
  account,
  property,
  userEmail,
  open,
  onClose,
  onUpdate,
  onSubmit,
}: {
  account: BppAccountRecord;
  // the linked CorvusPT property, when there is one (for autofill)
  property?: { address: string; ownerName?: string | null; cad?: string | null } | null;
  userEmail?: string | null;
  open: boolean;
  onClose: () => void;
  onUpdate: (account: BppAccountRecord) => void;
  onSubmit?: () => void;
}) {
  const saved = account.renditionValues;
  const [values, setValues] = useState<FieldValues>(() => ({
    ...getBppRenditionDefaults(account),
    ...(saved?.fields ?? {}),
  }));
  const [assets, setAssets] = useState<RenditionAsset[]>(saved?.assets ?? []);
  const [certified, setCertified] = useState(!!saved?.certified);
  const [aiFilled, setAiFilled] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"edit" | "preview" | "sign" | "done">(
    account.renditionSignedAt ? "done" : "edit",
  );
  const [signature, setSignature] = useState<SignatureValue | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dictation, setDictation] = useState("");
  const dictBase = useRef("");
  const signedInput = useRef<HTMLInputElement>(null);

  const speech = useSpeechInput(
    (t) => setDictation(`${dictBase.current}${dictBase.current ? " " : ""}${t}`),
    {
      onFinal: (t) => {
        dictBase.current = `${dictBase.current}${dictBase.current ? " " : ""}${t}`;
      },
    },
  );

  // The asset schedule drives Schedule A whenever there is one.
  const merged = useMemo<FieldValues>(
    () => (assets.some((a) => a.approved) ? { ...values, ...scheduleAFields(assets) } : values),
    [values, assets],
  );
  const missing = renditionMissing(account, { fields: merged, assets, certified });

  // Save progress (debounced) so the owner can come back to it.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      saveRenditionValues(account.id, { fields: values, assets, certified })
        .then(onUpdate)
        .catch(() => undefined);
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, assets, certified]);

  useEffect(() => () => void (previewUrl && URL.revokeObjectURL(previewUrl)), [previewUrl]);

  if (!open) return null;

  const set = (name: string, value: string | boolean) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setAiFilled((prev) => {
      if (!prev.has(name)) return prev;
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  };

  // Applies {fieldName: value} from Corvus AI — only known field names, only
  // where the field is empty (never overwrites what the owner typed).
  function applyAiFields(obj: Record<string, unknown> | null | undefined, overwrite = false) {
    if (!obj) return 0;
    const names = new Map(
      BPP_RENDITION_SCHEMA.flatMap((s) => s.fields).map((f) => [f.name, f] as const),
    );
    const filled: string[] = [];
    setValues((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(obj)) {
        const f = names.get(k);
        if (!f || v == null || v === "") continue;
        if (!overwrite && typeof prev[k] === "string" && (prev[k] as string).trim()) continue;
        if (f.type === "checkbox") next[k] = v === true || v === "true" || v === "Yes";
        else if (f.type === "radio") {
          const opt = f.options.find(
            (o) => o.trim().toLowerCase() === String(v).trim().toLowerCase(),
          );
          if (!opt) continue;
          next[k] = opt;
        } else next[k] = String(v);
        filled.push(k);
      }
      return next;
    });
    setAiFilled((prev) => new Set([...prev, ...filled]));
    return filled.length;
  }

  function knownContext(): string {
    return [
      `Business name: ${account.businessName}`,
      account.accountNumber && `Appraisal district account number: ${account.accountNumber}`,
      account.cad && `Appraisal district: ${account.cad}`,
      account.locationAddress && `Business location: ${account.locationAddress}`,
      account.taxYear && `Tax year: ${account.taxYear}`,
      account.renderedValue != null && `Last rendered value: ${money(account.renderedValue)}`,
      property?.address && `CorvusPT property at this location: ${property.address}`,
      property?.ownerName && `Property owner of record: ${property.ownerName}`,
      userEmail && `Account email: ${userEmail}`,
      `Current form values: ${JSON.stringify(values)}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  async function aiAutofill() {
    setBusy("autofill");
    try {
      const { answer } = await askAboutDocument({
        question: `Fill in Texas Form 50-144 (business personal property rendition) from the facts in the context. Reply with ONLY a JSON object mapping field names to values. Use only these field names:\n${FILLABLE.join("\n")}\nInclude a field ONLY when the context states the value — never guess names, phone numbers, dates or business types. Leave out fields that already have a value.`,
        context: knownContext(),
      });
      const n = applyAiFields(extractJson<Record<string, unknown>>(answer));
      toast.success(
        n
          ? `Corvus AI filled ${n} field${n === 1 ? "" : "s"} — please review them.`
          : "Nothing new to fill from what CorvusPT knows.",
      );
    } catch (err) {
      toast.error(getErrorMessage(err, "Corvus AI couldn't autofill right now."));
    } finally {
      setBusy(null);
    }
  }

  async function refineDictation() {
    if (!dictation.trim()) return;
    setBusy("dictation");
    try {
      const { answer } = await askAboutDocument({
        question: `The business owner described their business and its property out loud (transcript below). Turn it into Form 50-144 entries. Reply with ONLY JSON: {"fields": {fieldName: value}, "assets": [{"description","category","year","cost","marketValue"}]}. Field names allowed:\n${FILLABLE.join("\n")}\nCategories: Furniture & fixtures, Machinery & equipment, Computers & electronics, Vehicles, Inventory, Supplies, Leasehold improvements, Other. Use numbers for money and years. Only include what the owner actually said.\n\nTranscript: """${dictation.trim()}"""`,
        context: knownContext(),
      });
      const parsed = extractJson<{ fields?: Record<string, unknown>; assets?: unknown[] }>(answer);
      const n = applyAiFields(parsed?.fields, true);
      const found = assetsFromAi(JSON.stringify(parsed?.assets ?? []), "Dictation");
      setAssets((prev) => [...prev, ...found]);
      toast.success(
        `Added ${n} field${n === 1 ? "" : "s"} and ${found.length} asset${found.length === 1 ? "" : "s"} — review them below.`,
      );
      setDictation("");
      dictBase.current = "";
    } catch (err) {
      toast.error(getErrorMessage(err, "Corvus AI couldn't read the dictation."));
    } finally {
      setBusy(null);
    }
  }

  // Fixed-asset reports, depreciation schedules, prior renditions, invoices.
  async function readSupportingFile(file: File) {
    setBusy("file");
    try {
      const lower = file.name.toLowerCase();
      let found: RenditionAsset[] = [];
      const ask = `Extract the business personal property (assets) listed in this document for a Texas BPP rendition. Reply with ONLY a JSON array of {"description","category","year","cost","marketValue"} — category one of: Furniture & fixtures, Machinery & equipment, Computers & electronics, Vehicles, Inventory, Supplies, Leasehold improvements, Other. year = year acquired; cost = original/historical cost; marketValue only if the document states a current or book value. Skip totals and subtotals. Never invent amounts.`;
      if (/\.(xlsx|xls|csv)$/.test(lower)) {
        const grid = await readSpreadsheet(file);
        found = assetsFromGrid(grid, file.name) ?? [];
        if (found.length === 0 && grid.rows.length) {
          const csv = [grid.headers, ...grid.rows.slice(0, 150)]
            .map((r) => r.join(" | "))
            .join("\n");
          const { answer } = await askAboutDocument({
            question: ask,
            context: `File ${file.name}:\n${csv}`,
          });
          found = assetsFromAi(answer, file.name);
        }
      } else if (file.type === "application/pdf" || file.type.startsWith("image/")) {
        if (file.size > MAX_AI_FILE) throw new Error("That file is over 8 MB — please split it.");
        const { answer } = await askAboutDocument({
          question: ask,
          context: `File: ${file.name}`,
          file: { dataUrl: await fileToDataUrl(file) },
        });
        found = assetsFromAi(answer, file.name);
      } else {
        throw new Error("Upload a PDF, an image, or an Excel/CSV file.");
      }
      setAssets((prev) => [...prev, ...found]);
      toast[found.length ? "success" : "info"](
        found.length
          ? `Found ${found.length} asset${found.length === 1 ? "" : "s"} in ${file.name} — review and approve them below.`
          : `No assets found in ${file.name}.`,
      );
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not read that file."));
    } finally {
      setBusy(null);
    }
  }

  const patchAsset = (id: string, patch: Partial<RenditionAsset>) =>
    setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));

  async function pdfBytes() {
    return buildPdf(
      TEMPLATE_PATH,
      BPP_RENDITION_SCHEMA,
      resolveDateFields(BPP_RENDITION_SCHEMA, merged),
    );
  }

  async function handlePreview() {
    setBusy("preview");
    try {
      const bytes = await pdfBytes();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(
        URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" })),
      );
      setView("preview");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not build the preview."));
    } finally {
      setBusy(null);
    }
  }

  async function handleDownload() {
    setBusy("download");
    try {
      downloadPdf(await pdfBytes(), `Form-50-144-${account.businessName || "BPP"}.pdf`);
      toast.info("Print it, sign it, then upload the signed scan with Upload Signed Copy.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not build the PDF."));
    } finally {
      setBusy(null);
    }
  }

  async function handleSign() {
    if (!signature) return;
    setBusy("sign");
    try {
      const trackingId = newTrackingId();
      const bytes = await signPdf(
        TEMPLATE_PATH,
        BPP_RENDITION_SCHEMA,
        resolveDateFields(BPP_RENDITION_SCHEMA, merged),
        signature,
        new Date(),
        trackingId,
      );
      const fileName = `Form-50-144-signed-${account.businessName || "BPP"}.pdf`;
      const updated = await signRendition(
        account.id,
        signature,
        trackingId,
        new File([bytes as BlobPart], fileName, { type: "application/pdf" }),
      );
      onUpdate(updated);
      downloadPdf(bytes, fileName);
      toast.success("Rendition signed. Next: submit it to the appraisal district.");
      setView("done");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not sign this form."));
    } finally {
      setBusy(null);
    }
  }

  // Signed by hand: keep the scan, then let Corvus AI check it.
  async function handleUploadSigned(file: File) {
    setBusy("upload");
    try {
      let updated = await recordRenditionPaperSigned(account.id, file);
      onUpdate(updated);
      setView("done");
      toast.success("Signed copy saved. Corvus AI is checking it…");
      if (
        (file.type === "application/pdf" || file.type.startsWith("image/")) &&
        file.size <= MAX_AI_FILE
      ) {
        const { answer } = await askAboutDocument({
          question: `This should be a signed Texas Form 50-144 business personal property rendition for "${account.businessName}"${account.accountNumber ? `, account ${account.accountNumber}` : ""}. Check it and reply with ONLY JSON: {"signed": true|false|null, "dated": true|false|null, "matchesAccount": true|false|null, "issues": [short strings], "summary": "one sentence"}. signed = a handwritten or drawn signature is on the signature line; dated = the signature date is filled in; matchesAccount = the business name / account on the form match. Use null when you can't tell. List blank required items (Schedule A value, printed name) as issues.`,
          file: { dataUrl: await fileToDataUrl(file) },
        });
        const r = extractJson<Omit<RenditionVerification, "at">>(answer);
        if (r) {
          updated = await saveRenditionVerification(account.id, {
            at: new Date().toISOString(),
            signed: r.signed ?? null,
            dated: r.dated ?? null,
            matchesAccount: r.matchesAccount ?? null,
            issues: Array.isArray(r.issues) ? r.issues.map(String).slice(0, 8) : [],
            summary: String(r.summary ?? ""),
          });
          onUpdate(updated);
        }
      }
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not upload the signed copy."));
    } finally {
      setBusy(null);
    }
  }

  async function openSignedCopy() {
    if (!account.renditionDocumentPath) return handleDownload();
    try {
      window.open(await signedRenditionUrl(account.renditionDocumentPath), "_blank", "noopener");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not open the signed copy."));
    }
  }

  const uploadSigned = (
    <>
      <input
        ref={signedInput}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void handleUploadSigned(file);
        }}
      />
      <button
        type="button"
        onClick={() => signedInput.current?.click()}
        disabled={!!busy}
        title="Signed it by hand? Upload a scan or photo of the signed form"
        className="btn-outline disabled:opacity-60"
      >
        {busy === "upload" ? "Uploading…" : "Upload Signed Copy"}
      </button>
    </>
  );

  const v = account.renditionVerification;
  const total = assetTotal(assets);

  return (
    <Modal onClose={onClose} wide>
      <h3 className="font-serif text-xl font-semibold">
        Form 50-144 — Business Personal Property Rendition
      </h3>
      <p className="text-sm text-muted-foreground">
        {account.businessName}
        {account.cad ? ` · ${account.cad}` : ""}
        {saved?.updatedAt
          ? ` · progress saved ${new Date(saved.updatedAt).toLocaleString("en-US")}`
          : ""}
      </p>

      {view === "done" && account.renditionSignedAt ? (
        <div className="mt-4 grid gap-4">
          <SigningIdBadge trackingId={account.signingTrackingId} />
          <div className="rounded-lg border border-accent/30 bg-accent/5 p-4 text-sm">
            Signed {new Date(account.renditionSignedAt).toLocaleDateString("en-US")}
            {account.renditionSignatureType === "upload"
              ? " (hand-signed copy uploaded)"
              : ""}.{" "}
            {account.renditionFiledAt
              ? `You recorded it as submitted on ${new Date(account.renditionFiledAt).toLocaleDateString("en-US")}.`
              : "It hasn't been submitted yet — submit it to the appraisal district and record it here."}
          </div>
          {account.renditionSignatureType === "upload" && (
            <div className="rounded-md border border-border p-3 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Corvus AI check of the signed copy
              </p>
              {v ? (
                <>
                  <ul className="mt-1 grid gap-0.5">
                    {(
                      [
                        ["Signature present", v.signed],
                        ["Signature dated", v.dated],
                        ["Matches this account", v.matchesAccount],
                      ] as const
                    ).map(([label, ok]) => (
                      <li key={label} className={ok === false ? "text-destructive" : ""}>
                        {ok === true ? "✓" : ok === false ? "✗" : "?"} {label}
                        {ok == null ? " — couldn't tell, please check" : ""}
                      </li>
                    ))}
                  </ul>
                  {v.issues.length > 0 && (
                    <p className="mt-1 text-xs text-warning-foreground">
                      Check: {v.issues.join("; ")}
                    </p>
                  )}
                  {v.summary && <p className="mt-1 text-xs text-muted-foreground">{v.summary}</p>}
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    An automated check to help you catch mistakes — not a guarantee the county will
                    accept it.
                  </p>
                </>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  {busy === "upload"
                    ? "Checking…"
                    : "Not checked (the file couldn't be read automatically)."}
                </p>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void openSignedCopy()} className="btn-outline">
              Download Signed Copy
            </button>
            {onSubmit && (
              <button onClick={onSubmit} className="btn-primary btn-primary-hover">
                {account.renditionFiledAt ? "View Submission" : "Submit Rendition"}
              </button>
            )}
            {uploadSigned}
            <button onClick={() => setView("edit")} className="btn-outline">
              Make Changes
            </button>
          </div>
        </div>
      ) : view === "preview" && previewUrl ? (
        <div className="mt-4 grid gap-3">
          <iframe
            title="Rendition preview"
            src={previewUrl}
            className="h-[65vh] w-full rounded-md border border-border"
          />
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setView("edit")} className="btn-outline">
              Back to Edit
            </button>
            <button
              onClick={() => void handleDownload()}
              disabled={!!busy}
              className="btn-outline disabled:opacity-60"
            >
              Download to Sign by Hand
            </button>
            {uploadSigned}
            <button
              disabled={missing.length > 0}
              onClick={() => setView("sign")}
              title={missing.length ? "Fill in what's missing first" : undefined}
              className="btn-primary btn-primary-hover disabled:opacity-50"
            >
              Sign Online
            </button>
          </div>
        </div>
      ) : view === "sign" ? (
        <div className="mt-4 grid gap-4">
          <p className="text-sm text-muted-foreground">
            By signing, you affirm under Texas Tax Code §22.01 that this rendition, to the best of
            your knowledge, is true and correct.
          </p>
          <SignaturePad
            expectedName={merged["Printed Name of Authorized Individual"] as string}
            onChange={setSignature}
          />
          <div className="flex gap-2">
            <button onClick={() => setView("edit")} className="btn-outline">
              Back
            </button>
            <button
              disabled={!signature || !!busy}
              onClick={() => void handleSign()}
              className="btn-primary btn-primary-hover disabled:opacity-50"
            >
              {busy === "sign" ? "Signing…" : "Sign & Save"}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-5">
          {/* Corvus AI helpers */}
          <div className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-3">
            <div className="grid content-start gap-1.5 text-xs">
              <span className="font-semibold">Autofill</span>
              <span className="text-muted-foreground">
                From this account, its property and your profile.
              </span>
              <button
                onClick={() => void aiAutofill()}
                disabled={!!busy}
                className="btn-outline inline-flex w-fit items-center gap-1 py-1 text-xs disabled:opacity-60"
              >
                <Sparkles className="h-3.5 w-3.5" />{" "}
                {busy === "autofill" ? "Filling…" : "Autofill with Corvus AI"}
              </button>
            </div>
            <div className="grid content-start gap-1.5 text-xs">
              <span className="font-semibold">Dictate</span>
              <span className="text-muted-foreground">
                Describe the business and its equipment out loud.
              </span>
              {speech.supported ? (
                <button
                  onClick={speech.toggle}
                  disabled={busy === "dictation"}
                  className={`btn-outline inline-flex w-fit items-center gap-1 py-1 text-xs ${speech.listening ? "border-destructive text-destructive" : ""}`}
                >
                  {speech.listening ? (
                    <MicOff className="h-3.5 w-3.5" />
                  ) : (
                    <Mic className="h-3.5 w-3.5" />
                  )}
                  {speech.listening ? "Stop" : "Start dictation"}
                </button>
              ) : (
                <span className="text-muted-foreground">
                  Type below (this browser has no microphone input).
                </span>
              )}
            </div>
            <div className="grid content-start gap-1.5 text-xs">
              <span className="font-semibold">Supporting files</span>
              <span className="text-muted-foreground">
                Fixed asset report, depreciation schedule, Excel/CSV, prior rendition, invoices.
              </span>
              <FileButton
                label={busy === "file" ? "Reading…" : "Upload & extract assets"}
                accept=".pdf,image/*,.xlsx,.xls,.csv"
                disabled={!!busy}
                onFile={(f) => void readSupportingFile(f)}
              />
            </div>
            {(dictation || speech.listening) && (
              <div className="grid gap-1.5 sm:col-span-3">
                <textarea
                  value={dictation}
                  onChange={(e) => {
                    setDictation(e.target.value);
                    dictBase.current = e.target.value;
                  }}
                  rows={3}
                  placeholder="Listening…"
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <button
                  onClick={() => void refineDictation()}
                  disabled={!dictation.trim() || !!busy}
                  className="btn-outline w-fit py-1 text-xs disabled:opacity-60"
                >
                  {busy === "dictation" ? "Refining…" : "Refine into the form with Corvus AI"}
                </button>
              </div>
            )}
          </div>

          {BPP_RENDITION_SCHEMA.map((section) => (
            <div key={section.title}>
              <h2 className="text-sm font-semibold">{section.title}</h2>
              {section.title.startsWith("Schedule A") && assets.some((a) => a.approved) && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Filled from the approved assets below (grouped by category).
                </p>
              )}
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {section.fields.map((f) => {
                  const aiTag = aiFilled.has(f.name) && (
                    <span className="ml-1 rounded bg-accent/15 px-1 text-[10px] text-accent">
                      AI — review
                    </span>
                  );
                  const fromSchedule = f.name.startsWith("ScA:") && assets.some((a) => a.approved);
                  if (f.type === "checkbox") {
                    return (
                      <label key={f.name} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={!!merged[f.name]}
                          onChange={(e) => set(f.name, e.target.checked)}
                        />
                        {f.label}
                        {aiTag}
                      </label>
                    );
                  }
                  if (f.type === "radio") {
                    return (
                      <div key={f.name} className="sm:col-span-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          {f.label}
                          {f.required && <span className="text-destructive"> *</span>}
                          {aiTag}
                        </span>
                        <div className="mt-1 flex flex-wrap gap-3">
                          {f.options.map((opt) => (
                            <label key={opt} className="flex items-center gap-1.5 text-sm">
                              <input
                                type="radio"
                                checked={merged[f.name] === opt}
                                disabled={
                                  fromSchedule ||
                                  (f.name === "Total market value of your property" &&
                                    assets.some((a) => a.approved))
                                }
                                onChange={() => set(f.name, opt)}
                              />
                              {opt}
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <label
                      key={f.name}
                      className={
                        f.multiline ? "grid gap-1 text-sm sm:col-span-2" : "grid gap-1 text-sm"
                      }
                    >
                      <span className="text-xs font-medium text-muted-foreground">
                        {f.label}
                        {f.required && <span className="text-destructive"> *</span>}
                        {aiTag}
                      </span>
                      {f.multiline ? (
                        <textarea
                          value={(merged[f.name] as string) ?? ""}
                          onChange={(e) => set(f.name, e.target.value)}
                          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                          rows={3}
                        />
                      ) : (
                        <input
                          value={(merged[f.name] as string) ?? ""}
                          readOnly={fromSchedule}
                          onChange={(e) => set(f.name, e.target.value)}
                          onBlur={() => {
                            if (!f.dateFormat) return;
                            const cur = values[f.name];
                            if (typeof cur === "string") set(f.name, resolveDateInput(cur));
                          }}
                          placeholder={f.dateFormat ? "MM/DD/YYYY" : undefined}
                          className={`rounded-md border border-input bg-background px-3 py-2 text-sm ${fromSchedule ? "bg-secondary/40" : ""}`}
                        />
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}

          {/* asset schedule */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Asset schedule</h2>
              <div className="flex gap-2">
                {assets.some((a) => !a.approved) && (
                  <button
                    onClick={() => setAssets((p) => p.map((a) => ({ ...a, approved: true })))}
                    className="text-xs text-accent hover:underline"
                  >
                    Approve all
                  </button>
                )}
                <button
                  onClick={() =>
                    setAssets((p) => [
                      ...p,
                      {
                        id: `m${Date.now()}`,
                        description: "",
                        category: "Furniture & fixtures",
                        year: null,
                        cost: null,
                        marketValue: null,
                        source: "manual",
                        approved: true,
                      },
                    ])
                  }
                  className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                >
                  <Plus className="h-3 w-3" /> Add asset
                </button>
              </div>
            </div>
            {assets.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Optional — add assets by hand, by dictation or from a supporting file, and Schedule
                A is filled from them. Without a schedule, the good-faith estimate above is used.
              </p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="p-1">Description</th>
                      <th className="p-1">Category</th>
                      <th className="p-1">Year</th>
                      <th className="p-1">Cost</th>
                      <th className="p-1">Value</th>
                      <th className="p-1">From</th>
                      <th className="p-1">Approved</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {assets.map((a) => (
                      <tr key={a.id} className={a.approved ? "" : "bg-warning/10"}>
                        <td className="p-1">
                          <input
                            value={a.description}
                            onChange={(e) => patchAsset(a.id, { description: e.target.value })}
                            className="w-full min-w-32 rounded border border-input bg-background px-1.5 py-1"
                          />
                        </td>
                        <td className="p-1">
                          <input
                            value={a.category}
                            onChange={(e) => patchAsset(a.id, { category: e.target.value })}
                            className="w-full min-w-28 rounded border border-input bg-background px-1.5 py-1"
                          />
                        </td>
                        <td className="p-1">
                          <input
                            inputMode="numeric"
                            value={a.year ?? ""}
                            onChange={(e) =>
                              patchAsset(a.id, {
                                year: e.target.value
                                  ? Number(e.target.value.replace(/\D/g, "")) || null
                                  : null,
                              })
                            }
                            className="w-16 rounded border border-input bg-background px-1.5 py-1"
                          />
                        </td>
                        <td className="p-1">
                          <input
                            inputMode="decimal"
                            value={a.cost ?? ""}
                            onChange={(e) =>
                              patchAsset(a.id, {
                                cost: e.target.value
                                  ? Number(e.target.value.replace(/[^\d.]/g, "")) || null
                                  : null,
                              })
                            }
                            className="w-24 rounded border border-input bg-background px-1.5 py-1"
                          />
                        </td>
                        <td className="p-1">
                          <input
                            inputMode="decimal"
                            value={a.marketValue ?? ""}
                            onChange={(e) =>
                              patchAsset(a.id, {
                                marketValue: e.target.value
                                  ? Number(e.target.value.replace(/[^\d.]/g, "")) || null
                                  : null,
                              })
                            }
                            className="w-24 rounded border border-input bg-background px-1.5 py-1"
                          />
                        </td>
                        <td
                          className="max-w-24 truncate p-1 text-muted-foreground"
                          title={a.source}
                        >
                          {a.source}
                        </td>
                        <td className="p-1 text-center">
                          <input
                            type="checkbox"
                            aria-label="Approved"
                            checked={a.approved}
                            onChange={(e) => patchAsset(a.id, { approved: e.target.checked })}
                          />
                        </td>
                        <td className="p-1">
                          <button
                            aria-label="Remove asset"
                            onClick={() => setAssets((p) => p.filter((x) => x.id !== a.id))}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-1 text-xs text-muted-foreground">
                  Approved total:{" "}
                  <span className="font-medium text-foreground">{money(total)}</span> (market value
                  where given, else cost — a good-faith estimate; the appraisal district sets the
                  value).
                </p>
              </div>
            )}
          </div>

          <label className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={certified}
              onChange={(e) => setCertified(e.target.checked)}
            />
            <span>
              I have reviewed this rendition, including anything Corvus AI filled in, and the
              information is true and correct to the best of my knowledge.
            </span>
          </label>

          {missing.length > 0 ? (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
              <span className="font-semibold">Still missing before signing online:</span>
              <ul className="mt-1 list-disc pl-4">
                {missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
              <p className="mt-1 text-muted-foreground">
                You can still download it and complete it by hand.
              </p>
            </div>
          ) : (
            <p className="flex items-center gap-1 text-xs text-success">
              <Check className="h-3.5 w-3.5" /> Everything needed is filled in.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void handlePreview()}
              disabled={!!busy}
              className="btn-outline disabled:opacity-60"
            >
              {busy === "preview" ? "Building…" : "Preview"}
            </button>
            <button
              onClick={() => void handleDownload()}
              disabled={!!busy}
              className="btn-outline disabled:opacity-60"
            >
              {busy === "download" ? "Building…" : "Download PDF"}
            </button>
            {uploadSigned}
            <button
              disabled={missing.length > 0}
              onClick={() => setView("sign")}
              className="btn-primary btn-primary-hover disabled:opacity-50"
            >
              Sign Online
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
