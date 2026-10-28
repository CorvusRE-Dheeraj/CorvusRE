// DWG reader worker for the Compliance Checker.
//
// Reads an AutoCAD DWG file with LibreDWG (GNU, GPL-3.0 —
// https://www.gnu.org/software/libredwg/, source: https://github.com/LibreDWG/libredwg)
// through @mlightcad/libredwg-web 0.7.17 (GPL-3.0 — source:
// https://github.com/mlightcad/libredwg-web), loaded unmodified from jsDelivr
// into this separate worker. The app only sends this worker a file and gets
// plain entity data back as a message; nothing of LibreDWG is bundled into
// the app itself.
//
// Pinned to 0.7.17: 0.8.0–0.8.2 crash on every DWG we tried. The .wasm must
// match the hash below or it is refused.
const BASE = "https://cdn.jsdelivr.net/npm/@mlightcad/libredwg-web@0.7.17";
const WASM_SHA256 = "2bd963e881cfa08d645e1c869f31ca7ae3e47552276c29e41829cd84250e301a";
const KEEP = [
  "type",
  "layer",
  "startPoint",
  "endPoint",
  "vertices",
  "flag",
  "center",
  "insertionPoint",
  "name",
  "text",
  "measurement",
];
const TYPES = new Set(["LINE", "LWPOLYLINE", "CIRCLE", "ARC", "INSERT", "TEXT", "MTEXT", "DIMENSION"]);

async function load() {
  const mod = await import(`${BASE}/dist/libredwg-web.js`);
  const res = await fetch(`${BASE}/wasm/libredwg-web.wasm`);
  if (!res.ok) throw new Error(`Couldn't load the DWG reader (${res.status}).`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hash = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  if (hash !== WASM_SHA256) throw new Error("The DWG reader failed its integrity check.");
  const instance = await mod.createModule({ wasmBinary: bytes });
  return { lib: mod.LibreDwg.createByWasmInstance(instance), FileType: mod.Dwg_File_Type };
}

self.onmessage = async (event) => {
  try {
    const { lib, FileType } = await load();
    const dwg = lib.dwg_read_data(event.data.buffer, FileType.DWG);
    if (dwg == null) throw new Error("This DWG couldn't be opened.");
    let db;
    try {
      db = lib.convert(dwg);
    } finally {
      lib.dwg_free(dwg);
    }
    // a damaged / unsupported file comes back "read" with critical error codes
    // (e.g. 2048 invalid DWG) and no entities — treat that as unreadable
    if (!db.entities || db.entities.length === 0)
      throw new Error("This DWG couldn't be read — it may be damaged or in a format the reader can't open");
    const entities = [];
    let total = 0;
    for (const e of db.entities || []) {
      total++;
      if (!TYPES.has(e.type)) {
        entities.push({ type: e.type, layer: e.layer });
        continue;
      }
      const slim = {};
      for (const k of KEEP) if (k in e) slim[k] = e[k];
      if (slim.vertices) slim.vertices = slim.vertices.map((v) => ({ x: v.x, y: v.y }));
      entities.push(slim);
    }
    self.postMessage({ ok: true, insunits: Number(db.header && db.header.INSUNITS) || 0, total, entities });
  } catch (err) {
    self.postMessage({ ok: false, error: err && err.message ? err.message : String(err) });
  }
};
