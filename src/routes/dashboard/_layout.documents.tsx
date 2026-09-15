import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useActiveProjectBundle } from "@/hooks/use-project";
import { listDocuments, addDocument } from "@/lib/project-activity";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Section, EmptyProject, Loading, Field, inputCls } from "@/components/dp-ui";
import { dateShort } from "@/lib/format";

export const Route = createFileRoute("/dashboard/_layout/documents")({
  head: () => ({ meta: [{ title: "Documents — CorvusDP" }] }),
  component: Documents,
});

const CATEGORIES = [
  "Survey",
  "Site / Civil",
  "Architectural",
  "Structural",
  "MEP",
  "Studies",
  "Forms",
  "Approvals",
  "General",
];

function Documents() {
  const { user } = useAuth();
  const { loading, hasProject, project } = useActiveProjectBundle();
  const projectId = project?.id;
  const docs = useQuery({
    queryKey: ["documents", projectId],
    queryFn: () => listDocuments(projectId!),
    enabled: !!projectId,
  });
  const [name, setName] = useState("");
  const [category, setCategory] = useState("General");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (!hasProject || !project) return <EmptyProject />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId) return;
    setBusy(true);
    setError(null);
    try {
      let storagePath: string | undefined;
      if (file) {
        storagePath = `${user!.id}/${projectId}/${Date.now()}-${file.name}`;
        const { error: upErr } = await supabase.storage
          .from("project-docs")
          .upload(storagePath, file);
        if (upErr) throw upErr;
      }
      await addDocument({
        projectId,
        name: name || file?.name || "Untitled",
        category,
        storagePath,
        note: note || undefined,
      });
      setName("");
      setNote("");
      setFile(null);
      docs.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function open(path: string | null) {
    if (!path) return;
    const { data } = await supabase.storage.from("project-docs").createSignedUrl(path, 120);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
  }

  return (
    <div className="grid gap-5">
      <Section
        title="Document repository"
        subtitle="Central store for drawings, studies, forms, and approvals (PRD 2.1.9)."
      >
        {docs.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (docs.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No documents yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                  <th className="px-2 py-2 font-medium">Name</th>
                  <th className="px-2 py-2 font-medium">Category</th>
                  <th className="px-2 py-2 font-medium">Added</th>
                  <th className="px-2 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {(docs.data ?? []).map((d, i) => (
                  <tr
                    key={d.id}
                    className="list-item-enter row-hover border-b border-border/60"
                    style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
                  >
                    <td className="px-2 py-2 font-medium">
                      {d.name}
                      {d.note && <p className="text-xs text-muted-foreground">{d.note}</p>}
                    </td>
                    <td className="px-2 py-2">{d.category}</td>
                    <td className="px-2 py-2 text-muted-foreground">{dateShort(d.created_at)}</td>
                    <td className="px-2 py-2 text-right">
                      {d.storage_path && (
                        <button
                          onClick={() => open(d.storage_path)}
                          className="text-xs text-accent underline underline-offset-2"
                        >
                          Open
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <form
          onSubmit={submit}
          className="mt-5 grid gap-3 rounded-lg border border-dashed border-border p-4"
        >
          <div className="text-sm font-semibold">Add a document</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <input
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Civil plan set R1"
              />
            </Field>
            <Field label="Category">
              <select
                className={inputCls}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Note">
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Field label="File (optional)">
            <input
              type="file"
              className={inputCls}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button className="btn-accent w-fit disabled:opacity-60" disabled={busy}>
            {busy ? "Saving…" : "Add document"}
          </button>
        </form>
      </Section>
    </div>
  );
}
