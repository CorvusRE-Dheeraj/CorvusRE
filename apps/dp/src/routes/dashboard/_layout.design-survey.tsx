import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Download, FileText, Loader2, RefreshCw, Trash2, UploadCloud } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  SURVEY_ACCEPT,
  SURVEY_TYPES,
  formatBytes,
  removeSurvey,
  surveyFileProblem,
  surveyUrl,
  uploadSurvey,
} from "@/lib/design-survey";
import { Section, Loading } from "@/components/dp-ui";
import { SurveyReadingPanel } from "@/components/SurveyReading";
import { useActiveDesignRequest, EmptyDesign, designSubtitle } from "@/components/design-workspace";

export const Route = createFileRoute("/dashboard/_layout/design-survey")({
  head: () => ({ meta: [{ title: "Land Survey — CorvusDP" }] }),
  component: DesignSurvey,
});

// The land survey for the active design request: drop or pick one PNG, JPEG
// or PDF, see it, replace or remove it. The site-fit and schematic-plan steps
// work from this file.
function DesignSurvey() {
  const { user } = useAuth();
  const { loading, dr, brief, refetch } = useActiveDesignRequest();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const path = dr?.survey_path ?? null;
  useEffect(() => {
    setPreview(null);
    if (!path) return;
    let live = true;
    surveyUrl(path)
      .then((u) => live && setPreview(u))
      .catch(() => live && setPreview(null));
    return () => {
      live = false;
    };
  }, [path]);

  if (loading) return <Loading />;
  if (!dr || !brief) return <EmptyDesign />;

  async function pick(file: File | undefined) {
    if (!file || !dr || !user) return;
    setError(null);
    setNotice(null);
    const problem = surveyFileProblem(file);
    if (problem) return setError(problem);
    setBusy("upload");
    try {
      await uploadSurvey(dr, user.id, file);
      await refetch();
      setNotice(dr.survey_path ? "Survey replaced." : "Survey uploaded.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't upload the survey.");
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    if (!dr || !window.confirm("Remove this survey? You can upload another one any time.")) return;
    setError(null);
    setBusy("remove");
    try {
      await removeSurvey(dr);
      await refetch();
      setNotice("Survey removed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove the survey.");
    } finally {
      setBusy(null);
    }
  }

  async function download() {
    if (!dr?.survey_path) return;
    try {
      window.open(
        await surveyUrl(dr.survey_path, dr.survey_name ?? "survey"),
        "_blank",
        "noopener",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't download the survey.");
    }
  }

  const isPdf = dr.survey_type === "application/pdf";
  const dropZone = (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        void pick(e.dataTransfer.files?.[0]);
      }}
      className={`grid place-items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors ${drag ? "border-accent bg-accent/5" : "border-border"}`}
    >
      {busy === "upload" ? (
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
      ) : (
        <UploadCloud className="h-8 w-8 text-muted-foreground" aria-hidden />
      )}
      <p className="text-sm font-medium">
        {busy === "upload"
          ? "Uploading…"
          : dr.survey_path
            ? "Drop a new file here to replace the survey"
            : "Drop your land survey here"}
      </p>
      <p className="text-xs text-muted-foreground">PNG, JPG/JPEG or PDF · up to 15 MB</p>
      <button
        type="button"
        disabled={!!busy}
        onClick={() => input.current?.click()}
        className="btn-outline mt-1 text-sm"
      >
        {dr.survey_path ? "Choose another file" : "Choose a file"}
      </button>
      <input
        ref={input}
        type="file"
        accept={SURVEY_ACCEPT}
        className="sr-only"
        aria-label="Land survey file"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
    </div>
  );

  return (
    <div className="grid gap-5">
      <Section title="Land Survey" subtitle={designSubtitle(dr)}>
        <p className="mb-4 text-sm text-muted-foreground">
          Upload the property&apos;s existing boundary or topographic survey. CorvusDP uses it to
          read the lot, setbacks and easements and to check how the design fits on the land.
        </p>
        {error && (
          <p
            role="alert"
            className="mb-3 rounded-lg border border-red-400/40 bg-red-400/10 p-3 text-sm"
          >
            {error}
          </p>
        )}
        {notice && !error && (
          <p role="status" className="mb-3 text-sm text-emerald-700 dark:text-emerald-400">
            {notice}
          </p>
        )}

        {dr.survey_path ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="overflow-hidden rounded-lg border border-border bg-secondary/30">
              {!preview ? (
                <div className="grid h-72 place-items-center text-sm text-muted-foreground">
                  Loading preview…
                </div>
              ) : isPdf ? (
                <iframe title="Survey preview" src={preview} className="h-[32rem] w-full" />
              ) : (
                <img
                  src={preview}
                  alt={`Land survey: ${dr.survey_name ?? "uploaded file"}`}
                  className="max-h-[32rem] w-full object-contain"
                />
              )}
            </div>
            <div className="grid content-start gap-3">
              <div className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-start gap-2">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0">
                    <div className="break-words font-medium">{dr.survey_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {SURVEY_TYPES[dr.survey_type ?? ""] ?? "File"}
                      {dr.survey_size ? ` · ${formatBytes(dr.survey_size)}` : ""}
                      {dr.survey_uploaded_at
                        ? ` · uploaded ${new Date(dr.survey_uploaded_at).toLocaleDateString()}`
                        : ""}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void download()}
                    className="btn-outline inline-flex items-center gap-1.5 text-xs"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden /> Download
                  </button>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => input.current?.click()}
                    className="btn-outline inline-flex items-center gap-1.5 text-xs"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Replace
                  </button>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => void remove()}
                    className="btn-outline inline-flex items-center gap-1.5 text-xs text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />{" "}
                    {busy === "remove" ? "Removing…" : "Remove"}
                  </button>
                </div>
              </div>
              {dropZone}
            </div>
          </div>
        ) : (
          dropZone
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          * Only you (and CorvusDP staff) can see this file. A clear scan or the surveyor&apos;s PDF
          works best.
        </p>
      </Section>
      <SurveyReadingPanel dr={dr} refetch={refetch} />
    </div>
  );
}
