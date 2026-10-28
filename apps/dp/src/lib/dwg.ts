// Reads a DWG in the browser for the Compliance Checker. The work happens in
// public/dwg-worker.js (LibreDWG, GPL — kept in its own worker, loaded from
// jsDelivr, never bundled into the app); this side only posts the file and
// turns the entities it gets back into the same summary a DXF upload gets.
//
// Not on the server: Supabase Edge Functions allow ~2 s of CPU and 256 MB per
// request, and compiling LibreDWG's 10.8 MB WebAssembly alone uses most of that.
import { fromDwgEntities, summarizeCad, type DwgEntityLike, type DxfSummary } from "./dxf";

export const MAX_DWG_BYTES = 60 * 1024 * 1024;
const TIMEOUT_MS = 90_000;

type WorkerReply =
  | { ok: true; insunits: number; total: number; entities: DwgEntityLike[] }
  | { ok: false; error: string };

export function readDwgFile(bytes: Uint8Array): Promise<DxfSummary> {
  if (bytes.length > MAX_DWG_BYTES)
    return Promise.reject(
      new Error("This DWG is over 60 MB — export the sheets as DXF or PDF instead."),
    );
  return new Promise((resolve, reject) => {
    const worker = new Worker(`${import.meta.env.BASE_URL}dwg-worker.js`, { type: "module" });
    const timer = window.setTimeout(() => {
      worker.terminate();
      reject(new Error("Reading the DWG took too long — export the sheets as DXF or PDF instead."));
    }, TIMEOUT_MS);
    const done = () => {
      window.clearTimeout(timer);
      worker.terminate(); // frees the reader's memory right away
    };
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      done();
      if (!e.data.ok) return reject(new Error(e.data.error));
      resolve({
        ...summarizeCad(e.data.insunits, fromDwgEntities(e.data.entities)),
        source: "dwg",
      });
    };
    worker.onerror = (e) => {
      done();
      reject(new Error(e.message || "The DWG reader stopped unexpectedly."));
    };
    const copy = bytes.slice().buffer;
    worker.postMessage({ buffer: copy }, [copy]);
  });
}
