import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  connectPodio,
  disconnectPodio,
  podioItems,
  podioStatus,
  podioWorkspaces,
  type PodioWorkspace,
} from "@/lib/podio";
import type { SpreadsheetGrid } from "@/lib/spreadsheet-import";

const errMsg = (e: unknown, f: string) => (e instanceof Error ? e.message : f);

// Bulk Upload → Import from Podio: connect, choose the app that holds the
// properties, and hand its items to the same review flow as a file upload.
export function PodioImportPanel({ onGrid }: { onGrid: (g: SpreadsheetGrid) => void }) {
  const [status, setStatus] = useState<{ configured: boolean; connected: boolean } | null>(null);
  const [workspaces, setWorkspaces] = useState<PodioWorkspace[] | null>(null);
  const [appId, setAppId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    podioStatus()
      .then((s) => {
        setStatus(s);
        if (s.connected)
          podioWorkspaces()
            .then((w) => {
              setWorkspaces(w);
              setAppId(w[0]?.apps[0]?.appId ?? null);
            })
            .catch((e) => toast.error(errMsg(e, "Couldn't list your Podio apps.")));
      })
      .catch(() => setStatus({ configured: false, connected: false }));
  }, []);

  async function load() {
    if (!appId) return;
    setBusy(true);
    try {
      const g = await podioItems(appId);
      if (g.rows.length === 0) {
        toast.error("That Podio app has no items.");
        return;
      }
      if (g.truncated)
        toast.info(
          `Imported the first ${g.rows.length} of ${g.total} items — import the rest from an export.`,
        );
      onGrid({ headers: g.headers, rows: g.rows });
    } catch (e) {
      toast.error(errMsg(e, "Couldn't read that Podio app."));
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    try {
      const started = await connectPodio();
      if (!started) toast.error("Podio connection isn't available right now.");
    } catch (e) {
      toast.error(errMsg(e, "Couldn't start the Podio connection."));
    }
  }

  return (
    <div className="grid gap-2 rounded-lg border border-border p-4">
      <div className="text-sm font-semibold">Import from Podio</div>
      {!status ? (
        <p className="text-xs text-muted-foreground">Checking your Podio connection…</p>
      ) : !status.configured ? (
        <p className="text-xs text-muted-foreground">
          Direct Podio connection isn&apos;t switched on yet. Meanwhile, in Podio open the app with
          your properties, choose Export to Excel from its menu, and upload that file above.
        </p>
      ) : !status.connected ? (
        <>
          <p className="text-xs text-muted-foreground">
            Connect your Podio account, pick the app that holds your properties, and Corvus AI reads
            every item — the same mapping, county matching and duplicate checks as a file.
          </p>
          <button type="button" onClick={connect} className="btn-outline w-fit text-sm">
            Connect Podio
          </button>
        </>
      ) : !workspaces ? (
        <p className="text-xs text-muted-foreground">Loading your Podio workspaces…</p>
      ) : workspaces.length === 0 ? (
        <p className="text-xs text-muted-foreground">No Podio apps found in your workspaces.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="podio-app" className="sr-only">
            Podio app
          </label>
          <select
            id="podio-app"
            value={appId ?? ""}
            onChange={(e) => setAppId(Number(e.target.value))}
            className="min-w-0 max-w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          >
            {workspaces.map((w) => (
              <optgroup key={`${w.org}/${w.space}`} label={`${w.org} · ${w.space}`}>
                {w.apps.map((a) => (
                  <option key={a.appId} value={a.appId}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            type="button"
            onClick={load}
            disabled={busy || !appId}
            className="btn-accent inline-flex items-center gap-1.5 text-sm disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Import these items
          </button>
          <button
            type="button"
            onClick={async () => {
              await disconnectPodio().catch(() => {});
              setStatus({ configured: true, connected: false });
              setWorkspaces(null);
            }}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
