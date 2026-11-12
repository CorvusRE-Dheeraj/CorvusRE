import { useRef, useState } from "react";
import { toast } from "sonner";
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
  isFormComplete,
  getIncompleteRequiredLabels,
  type FieldValues,
} from "@/lib/protest-documents";
import {
  signRendition,
  markRenditionFiled,
  recordRenditionPaperSigned,
  signedRenditionUrl,
  type BppAccountRecord,
} from "@/lib/bpp-accounts";
import { getErrorMessage } from "@/lib/error-message";
import { newTrackingId } from "@/lib/signing-packets";
import { SigningIdBadge } from "@/components/SigningIdBadge";

const TEMPLATE_PATH = "forms/50-144.pdf";

// Standalone signing UI for Form 50-144 (BPP Rendition) — not built on top of
// PdfFormEditor, which is deeply tuned to the real-estate protest/agent/
// evidence-declaration flow (its own "formKind" copy, CountyProtestInfo-
// driven post-sign guidance, ProtestStatus-aware "Mark as Filed"). A
// rendition isn't a protest at all (no ARB process, no case status) and this
// app has no BPP-specific CountyProtestInfo — reusing that component would
// mean threading a 4th, semantically-different formKind through logic that
// doesn't apply to it. This reuses everything that IS actually shared: the
// FieldSection/FieldValues schema model, SignaturePad, and the real
// buildPdf/signPdf/downloadPdf pipeline against the real Form 50-144 PDF.
export function BppRenditionEditor({
  account,
  open,
  onClose,
  onUpdate,
}: {
  account: BppAccountRecord;
  open: boolean;
  onClose: () => void;
  onUpdate: (account: BppAccountRecord) => void;
}) {
  const [values, setValues] = useState<FieldValues>(() => getBppRenditionDefaults(account));
  const [view, setView] = useState<"edit" | "sign">(account.renditionSignedAt ? "sign" : "edit");
  const [signature, setSignature] = useState<SignatureValue | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [signing, setSigning] = useState(false);
  const [markingFiled, setMarkingFiled] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const complete = isFormComplete(BPP_RENDITION_SCHEMA, values);
  const missing = getIncompleteRequiredLabels(BPP_RENDITION_SCHEMA, values);

  function handleChange(name: string, value: string | boolean) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  function handleBlurDate(name: string) {
    setValues((prev) => {
      const v = prev[name];
      return typeof v === "string" ? { ...prev, [name]: resolveDateInput(v) } : prev;
    });
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const resolved = resolveDateFields(BPP_RENDITION_SCHEMA, values);
      const bytes = await buildPdf(TEMPLATE_PATH, BPP_RENDITION_SCHEMA, resolved);
      downloadPdf(bytes, `Form-50-144-${account.businessName || "BPP"}.pdf`);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not build the PDF."));
    } finally {
      setDownloading(false);
    }
  }

  async function handleSign() {
    if (!signature) return;
    setSigning(true);
    try {
      const resolved = resolveDateFields(BPP_RENDITION_SCHEMA, values);
      const trackingId = newTrackingId();
      const bytes = await signPdf(
        TEMPLATE_PATH,
        BPP_RENDITION_SCHEMA,
        resolved,
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
      toast.success("Rendition signed. Download it and file it with the county.");
      setView("sign");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not sign this form."));
    } finally {
      setSigning(false);
    }
  }

  // Signed on paper: upload the scan of the hand-signed printout.
  async function handleUploadSigned(file: File) {
    setSigning(true);
    try {
      const updated = await recordRenditionPaperSigned(account.id, file);
      onUpdate(updated);
      toast.success("Signed copy saved. File it with the county by the rendition deadline.");
      setView("sign");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not upload the signed copy."));
    } finally {
      setSigning(false);
    }
  }

  // The copy that was actually signed; older signings without one rebuild it.
  async function handleDownloadSigned() {
    if (!account.renditionDocumentPath) return handleDownload();
    setDownloading(true);
    try {
      window.open(await signedRenditionUrl(account.renditionDocumentPath), "_blank", "noopener");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not open the signed copy."));
    } finally {
      setDownloading(false);
    }
  }

  const uploadButton = (
    <>
      <input
        ref={fileInput}
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
        onClick={() => fileInput.current?.click()}
        disabled={signing}
        title="Signed it by hand? Upload a scan or photo of the signed form"
        className="btn-outline disabled:opacity-60"
      >
        {signing ? "Uploading…" : "Upload Signed Copy"}
      </button>
    </>
  );

  async function handleMarkFiled() {
    setMarkingFiled(true);
    try {
      const updated = await markRenditionFiled(account.id);
      onUpdate(updated);
      toast.success("Marked as filed with the county.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not update this account."));
    } finally {
      setMarkingFiled(false);
    }
  }

  return (
    <Modal onClose={onClose} wide>
      <h3 className="font-serif text-xl font-semibold">
        Form 50-144 — Business Personal Property Rendition
      </h3>
      <p className="text-muted-foreground text-sm">{account.businessName}</p>

      {view === "sign" && account.renditionSignedAt ? (
        <div className="mt-4 grid gap-4">
          <SigningIdBadge trackingId={account.signingTrackingId} />
          <div className="rounded-lg border border-accent/30 bg-accent/5 p-4 text-sm">
            Signed {new Date(account.renditionSignedAt).toLocaleDateString("en-US")}. Download a
            copy and deliver it to {account.cad || "your county's appraisal district"} by the
            rendition deadline{" "}
            {account.renditionDeadline
              ? `(${new Date(`${account.renditionDeadline}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })})`
              : ""}
            .
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void handleDownloadSigned()}
              disabled={downloading}
              className="btn-outline disabled:opacity-60"
            >
              {downloading
                ? "Opening…"
                : account.renditionSignatureType === "upload"
                  ? "Download Signed Copy"
                  : "Download Signed PDF"}
            </button>
            {account.renditionFiledAt ? (
              <span className="badge-soft self-center">
                Filed {new Date(account.renditionFiledAt).toLocaleDateString("en-US")}
              </span>
            ) : (
              <button
                onClick={handleMarkFiled}
                disabled={markingFiled}
                className="btn-primary btn-primary-hover disabled:opacity-60"
              >
                {markingFiled ? "Saving…" : "Mark as Filed with County"}
              </button>
            )}
            <button onClick={() => setView("edit")} className="btn-outline">
              Make Changes
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
            expectedName={values["Printed Name of Authorized Individual"] as string}
            onChange={setSignature}
          />
          <div className="flex gap-2">
            <button onClick={() => setView("edit")} className="btn-outline">
              Back
            </button>
            <button
              disabled={!signature || signing}
              onClick={handleSign}
              className="btn-primary btn-primary-hover disabled:opacity-50"
            >
              {signing ? "Signing…" : "Sign & Save"}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-6">
          {BPP_RENDITION_SCHEMA.map((section) => (
            <div key={section.title}>
              <h2 className="text-sm font-semibold">{section.title}</h2>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {section.fields.map((f) => {
                  if (f.type === "checkbox") {
                    return (
                      <label key={f.name} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={!!values[f.name]}
                          onChange={(e) => handleChange(f.name, e.target.checked)}
                        />
                        {f.label}
                      </label>
                    );
                  }
                  if (f.type === "radio") {
                    return (
                      <div key={f.name} className="sm:col-span-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          {f.label}
                          {f.required && <span className="text-destructive"> *</span>}
                        </span>
                        <div className="mt-1 flex flex-wrap gap-3">
                          {f.options.map((opt) => (
                            <label key={opt} className="flex items-center gap-1.5 text-sm">
                              <input
                                type="radio"
                                checked={values[f.name] === opt}
                                onChange={() => handleChange(f.name, opt)}
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
                        f.multiline ? "sm:col-span-2 grid gap-1 text-sm" : "grid gap-1 text-sm"
                      }
                    >
                      <span className="text-xs font-medium text-muted-foreground">
                        {f.label}
                        {f.required && <span className="text-destructive"> *</span>}
                      </span>
                      {f.multiline ? (
                        <textarea
                          value={(values[f.name] as string) ?? ""}
                          onChange={(e) => handleChange(f.name, e.target.value)}
                          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                          rows={3}
                        />
                      ) : (
                        <input
                          value={(values[f.name] as string) ?? ""}
                          onChange={(e) => handleChange(f.name, e.target.value)}
                          onBlur={() => f.dateFormat && handleBlurDate(f.name)}
                          placeholder={f.dateFormat ? "MM/DD/YYYY" : undefined}
                          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                        />
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}

          {!complete && missing.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Still needed to sign here: {missing.join(", ")}. You can also download the form and
              fill them in by hand.
            </p>
          )}
          <p className="rounded-md bg-secondary/50 p-3 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Prefer to sign on paper?</span> Download
            the form, print and sign it, then upload a scan or photo with{" "}
            <span className="font-medium">Upload Signed Copy</span> — no online signature needed.
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="btn-outline disabled:opacity-60"
            >
              {downloading ? "Building…" : "Download PDF"}
            </button>
            {uploadButton}
            <button
              disabled={!complete}
              onClick={() => setView("sign")}
              className="btn-primary btn-primary-hover disabled:opacity-50"
            >
              Review & Sign
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
