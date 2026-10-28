// DXF (ASCII) reader for the Compliance Checker — runs in the browser when a
// DXF is uploaded and stores a compact summary on project_documents.cad_summary.
//
// Unlike a PDF, a DXF carries real geometry: drawing units, layers, every
// dimension's MEASURED length (group 42) next to the text printed on it
// (group 1), closed outlines whose areas can be computed, and text kept apart
// from lines. That lets the check tell annotation from geometry and catch a
// dimension whose printed text was typed over and no longer matches what is
// drawn. DWG goes through LibreDWG in public/dwg-worker.js (see dwg.ts) and
// lands in the same summary via fromDwgEntities → summarizeCad. Binary DXF
// is not read.

export type DxfUnits = { code: number; name: string; toFeet: number | null };

export type DxfDimension = {
  layer: string;
  measured: number; // in drawing units
  text: string | null; // printed override, null when it shows the measurement
  overridden: boolean; // printed text disagrees with the drawn length
};

export type DxfSummary = {
  format: "dxf";
  source?: "dwg"; // geometry read from a DWG rather than a DXF
  units: DxfUnits;
  entityCount: number;
  layers: { name: string; count: number }[];
  extents: { minX: number; minY: number; maxX: number; maxY: number } | null;
  texts: { layer: string; text: string }[];
  dimensions: DxfDimension[];
  closedAreas: { layer: string; area: number }[]; // square drawing units
  blocks: { name: string; count: number }[];
  warnings: string[];
};

// $INSUNITS codes (AutoCAD); 0 = unitless — scale then can't be trusted
const UNITS: Record<number, [string, number | null]> = {
  0: ["Unitless", null],
  1: ["Inches", 1 / 12],
  2: ["Feet", 1],
  4: ["Millimeters", 1 / 304.8],
  5: ["Centimeters", 1 / 30.48],
  6: ["Meters", 3.28084],
  3: ["Miles", 5280],
  14: ["Decimeters", 0.328084],
  21: ["US Survey Feet", 1.000002],
};

const MAX_TEXTS = 400;
const MAX_DIMS = 300;
const MAX_AREAS = 200;

export function isBinaryDxf(head: string): boolean {
  return head.startsWith("AutoCAD Binary DXF");
}

// "12'-6\"", "12' 6 1/2\"", "150.5'", "36\"", "4.5 m" → length in feet (null if not a length)
export function lengthTextToFeet(raw: string): number | null {
  const s = raw
    .replace(/\\[A-Za-z][^;]*;|[{}]/g, "")
    .replace(/%%[cdp]/gi, "")
    .trim();
  const fi = s.match(
    /^(-?\d+(?:\.\d+)?)\s*'\s*-?\s*(?:(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+))?\s*"?)?$/,
  );
  if (fi) {
    const inches = fi[2] ? Number(fi[2]) + (fi[3] ? Number(fi[3]) / Number(fi[4]) : 0) : 0;
    return Number(fi[1]) + inches / 12;
  }
  const inch = s.match(/^(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+))?\s*"$/);
  if (inch) return (Number(inch[1]) + (inch[2] ? Number(inch[2]) / Number(inch[3]) : 0)) / 12;
  const metric = s.match(/^(\d+(?:\.\d+)?)\s*(mm|cm|m)$/i);
  if (metric) {
    const f = { mm: 1 / 304.8, cm: 1 / 30.48, m: 3.28084 }[
      metric[2].toLowerCase() as "mm" | "cm" | "m"
    ];
    return Number(metric[1]) * f;
  }
  return null;
}

// does the printed text still say what the dimension measures?
function textMatches(text: string, measured: number, units: DxfUnits): boolean | null {
  if (text.includes("<>")) return true; // "<>" is the live measurement
  const asFeet = lengthTextToFeet(text);
  if (asFeet != null && units.toFeet) {
    const measuredFeet = measured * units.toFeet;
    return Math.abs(asFeet - measuredFeet) <= Math.max(0.05, measuredFeet * 0.01);
  }
  const plain = text.replace(/\\[A-Za-z][^;]*;|[{}]/g, "").trim();
  if (/^-?\d+(\.\d+)?$/.test(plain)) {
    const n = Number(plain);
    return Math.abs(n - measured) <= Math.max(0.01, Math.abs(measured) * 0.01);
  }
  return null; // words, not a number — e.g. "VARIES", "EQ" — can't compare
}

function cleanText(s: string): string {
  return s
    .replace(/\\P/g, " ")
    .replace(/\\[A-Za-z][^;]*;/g, "")
    .replace(/[{}]/g, "")
    .replace(/%%c/gi, "Ø")
    .replace(/%%d/gi, "°")
    .replace(/%%p/gi, "±")
    .replace(/\s+/g, " ")
    .trim();
}

function polygonArea(pts: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

type Entity = { type: string; codes: [number, string][] };

export function parseDxf(source: string): DxfSummary {
  const lines = source.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isFinite(code)) continue;
    pairs.push([code, lines[i + 1].trim()]);
  }

  let unitsCode = 0;
  const entities: Entity[] = [];
  let section = "";
  let inBlocks = false;
  let current: Entity | null = null;
  for (let i = 0; i < pairs.length; i++) {
    const [code, value] = pairs[i];
    if (code === 0 && value === "SECTION") {
      section = pairs[i + 1]?.[1] ?? "";
      inBlocks = section === "BLOCKS";
      continue;
    }
    if (code === 0 && value === "ENDSEC") {
      if (current) entities.push(current);
      current = null;
      section = "";
      continue;
    }
    if (section === "HEADER" && code === 9 && value === "$INSUNITS") {
      unitsCode = Number(pairs[i + 1]?.[1]) || 0;
      continue;
    }
    if (section !== "ENTITIES" || inBlocks) continue;
    if (code === 0) {
      if (current) entities.push(current);
      current = { type: value, codes: [] };
    } else if (current) {
      current.codes.push([code, value]);
    }
  }

  const get = (e: Entity, c: number) => e.codes.find(([k]) => k === c)?.[1];
  const num = (v: string | undefined) => Number(v);
  const cad: CadEntity[] = entities.map((e) => {
    const base = { type: e.type, layer: get(e, 8) ?? "0" };
    switch (e.type) {
      case "LINE":
        return {
          ...base,
          points: [
            [num(get(e, 10)), num(get(e, 20))],
            [num(get(e, 11)), num(get(e, 21))],
          ],
        };
      case "LWPOLYLINE": {
        const xs = e.codes.filter(([k]) => k === 10).map(([, v]) => Number(v));
        const ys = e.codes.filter(([k]) => k === 20).map(([, v]) => Number(v));
        return {
          ...base,
          points: xs.map((x, j) => [x, ys[j]] as [number, number]),
          closed: (num(get(e, 70)) & 1) === 1,
        };
      }
      case "CIRCLE":
      case "ARC":
        return { ...base, points: [[num(get(e, 10)), num(get(e, 20))]] };
      case "INSERT":
        return { ...base, points: [[num(get(e, 10)), num(get(e, 20))]], block: get(e, 2) ?? "?" };
      case "TEXT":
      case "MTEXT":
        return {
          ...base,
          points: [[num(get(e, 10)), num(get(e, 20))]],
          text: e.codes
            .filter(([k]) => k === 3 || k === 1)
            .map(([, v]) => v)
            .join(""),
        };
      case "DIMENSION":
        return { ...base, measured: num(get(e, 42)), dimText: get(e, 1) ?? null };
      default:
        return base;
    }
  });
  return summarizeCad(unitsCode, cad);
}

// One drawing entity, whichever file it came from (DXF group codes here, a
// DWG read by LibreDWG in public/dwg-worker.js) — only what the summary uses.
export type CadEntity = {
  type: string;
  layer: string;
  points?: [number, number][];
  closed?: boolean;
  text?: string;
  measured?: number;
  dimText?: string | null;
  block?: string;
};

// What LibreDWG's DwgDatabase gives for an entity (the fields we read).
type DwgPoint = { x: number; y: number };
export type DwgEntityLike = {
  type: string;
  layer?: string;
  startPoint?: DwgPoint;
  endPoint?: DwgPoint;
  vertices?: DwgPoint[];
  flag?: number;
  center?: DwgPoint;
  insertionPoint?: DwgPoint;
  name?: string;
  text?: string;
  measurement?: number;
};

export function fromDwgEntities(entities: DwgEntityLike[]): CadEntity[] {
  const pt = (p?: DwgPoint): [number, number][] => (p ? [[p.x, p.y]] : []);
  return entities.map((e) => {
    const base = { type: e.type, layer: e.layer || "0" };
    switch (e.type) {
      case "LINE":
        return { ...base, points: [...pt(e.startPoint), ...pt(e.endPoint)] };
      case "LWPOLYLINE":
        return {
          ...base,
          points: (e.vertices ?? []).map((v) => [v.x, v.y] as [number, number]),
          closed: ((e.flag ?? 0) & 1) === 1,
        };
      case "CIRCLE":
      case "ARC":
        return { ...base, points: pt(e.center) };
      case "INSERT":
        return { ...base, points: pt(e.insertionPoint), block: e.name ?? "?" };
      case "TEXT":
      case "MTEXT":
        return { ...base, points: pt(e.startPoint ?? e.insertionPoint), text: e.text ?? "" };
      case "DIMENSION":
        // LibreDWG gives "" when the dimension shows its own measurement
        return { ...base, measured: e.measurement, dimText: e.text || null };
      default:
        return base;
    }
  });
}

export function summarizeCad(unitsCode: number, entities: CadEntity[]): DxfSummary {
  const warnings: string[] = [];
  const [unitName, toFeet] = UNITS[unitsCode] ?? ["Unknown", null];
  const units: DxfUnits = { code: unitsCode, name: unitName, toFeet };
  if (toFeet == null)
    warnings.push(
      "The drawing has no units set ($INSUNITS is unitless) — lengths can't be converted to feet until the units are confirmed.",
    );

  const layerCount = new Map<string, number>();
  const blockCount = new Map<string, number>();
  const texts: DxfSummary["texts"] = [];
  const dimensions: DxfDimension[] = [];
  const closedAreas: DxfSummary["closedAreas"] = [];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const extend = ([x, y]: [number, number]) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (const e of entities) {
    layerCount.set(e.layer, (layerCount.get(e.layer) ?? 0) + 1);
    e.points?.forEach(extend);
    if (
      e.type === "LWPOLYLINE" &&
      e.closed &&
      e.points &&
      e.points.length >= 3 &&
      closedAreas.length < MAX_AREAS
    )
      closedAreas.push({ layer: e.layer, area: Math.round(polygonArea(e.points) * 100) / 100 });
    if (e.type === "INSERT" && e.block) blockCount.set(e.block, (blockCount.get(e.block) ?? 0) + 1);
    if ((e.type === "TEXT" || e.type === "MTEXT") && e.text) {
      const text = cleanText(e.text);
      if (text && texts.length < MAX_TEXTS)
        texts.push({ layer: e.layer, text: text.slice(0, 200) });
    }
    if (e.type === "DIMENSION") {
      const measured = Number(e.measured);
      if (!Number.isFinite(measured) || dimensions.length >= MAX_DIMS) continue;
      const raw = e.dimText;
      const text = raw && raw !== "<>" ? cleanText(raw) : null;
      const match = text ? textMatches(raw!, measured, units) : true;
      dimensions.push({
        layer: e.layer,
        measured: Math.round(measured * 10000) / 10000,
        text,
        overridden: match === false,
      });
    }
  }

  const overridden = dimensions.filter((d) => d.overridden).length;
  if (overridden)
    warnings.push(
      `${overridden} dimension${overridden === 1 ? " shows" : "s show"} text that doesn't match the drawn length — confirm which is right.`,
    );
  if (entities.length === 0) warnings.push("No drawing entities were found in this file.");

  const top = (m: Map<string, number>, n: number) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([name, count]) => ({ name, count }));

  return {
    format: "dxf",
    units,
    entityCount: entities.length,
    layers: top(layerCount, 80),
    extents: Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null,
    texts,
    dimensions,
    closedAreas,
    blocks: top(blockCount, 60),
    warnings,
  };
}
