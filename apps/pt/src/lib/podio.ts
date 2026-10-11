import { invokeEdgeFunction } from "./edge-functions";
import type { SpreadsheetGrid } from "./spreadsheet-import";

// Podio for the bulk property import (the podio edge function). The owner
// connects their Podio account once, picks the app that holds their
// properties, and its items come back as a spreadsheet grid for the usual
// mapping and county matching. Tokens never reach the browser.

export type PodioWorkspace = {
  org: string;
  space: string;
  apps: { appId: number; name: string }[];
};

export const podioStatus = () =>
  invokeEdgeFunction<{ configured: boolean; connected: boolean }>("podio", {
    action: "status",
  });

export async function connectPodio(): Promise<boolean> {
  const r = await invokeEdgeFunction<{ configured: boolean; url?: string }>("podio", {
    action: "start",
    // A full URL so the owner comes back to whichever copy of the app they
    // started from (the live site, or localhost while developing).
    returnPath: `${window.location.origin}${import.meta.env.BASE_URL}dashboard/properties`,
  });
  if (!r.configured || !r.url) return false;
  window.location.assign(r.url);
  return true;
}

export const podioWorkspaces = () =>
  invokeEdgeFunction<{ workspaces: PodioWorkspace[] }>("podio", { action: "apps" }).then(
    (r) => r.workspaces,
  );

export const podioItems = (appId: number) =>
  invokeEdgeFunction<SpreadsheetGrid & { total: number; truncated: boolean }>("podio", {
    action: "items",
    appId,
  });

export const disconnectPodio = () =>
  invokeEdgeFunction<{ ok: boolean }>("podio", { action: "disconnect" });
