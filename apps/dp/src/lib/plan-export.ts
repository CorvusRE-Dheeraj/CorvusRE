// Downloads for the schematic: the plan on its own as SVG, and a one-page
// "concept sheet" PNG — the plan, the project, the numbers, the assumptions
// and the "Conceptual schematic…" label — for sharing with a client or team.
import { SCHEMATIC_LABEL, type SchematicOption } from "./schematic";

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Breaks text into lines of at most `max` characters, on word boundaries. */
export function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if ((line + " " + w).trim().length > max && line) {
      out.push(line);
      line = w;
    } else line = (line + " " + w).trim();
  }
  if (line) out.push(line);
  return out;
}

function planMarkup(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.removeAttribute("class");
  return new XMLSerializer().serializeToString(clone);
}

export function downloadPlanSvg(svg: SVGSVGElement, filename: string) {
  save(new Blob([planMarkup(svg)], { type: "image/svg+xml" }), filename);
}

/** Builds the concept sheet as SVG markup (exported for tests). */
export function conceptSheetSvg(
  plan: SVGSVGElement,
  o: SchematicOption,
  info: { project: string; address: string; date?: Date },
): { markup: string; width: number; height: number } {
  const vb = plan.viewBox.baseVal;
  const W = 1500;
  const planW = 900,
    planH = Math.round((planW * vb.height) / vb.width);
  const lines: { text: string; size: number; bold?: boolean; color?: string; gap?: number }[] = [];
  const add = (text: string, size = 15, extra: Partial<(typeof lines)[number]> = {}) =>
    lines.push({ text, size, ...extra });
  for (const t of wrap(o.title, 36)) add(t, 24, { bold: true });
  add(info.project, 15, { color: "#475569" });
  add(info.address, 15, { color: "#475569" });
  add(`Generated ${(info.date ?? new Date()).toLocaleDateString()}`, 13, {
    color: "#64748b",
    gap: 18,
  });
  const m = o.metrics;
  add("Key numbers", 17, { bold: true });
  add(
    `Footprint: ${m.footprintSqFt.toLocaleString()} sf${m.targetFootprintSqFt ? ` (target ${m.targetFootprintSqFt.toLocaleString()} sf)` : ""}`,
  );
  add(`Lot coverage: ${m.coveragePct}%`);
  if (m.stalls || m.stallsNeeded)
    add(`Parking: ${m.stalls} stalls${m.stallsNeeded ? ` (about ${m.stallsNeeded} needed)` : ""}`);
  if (m.openSpaceSqFt) add(`Open space: ${m.openSpaceSqFt.toLocaleString()} sf`);
  add(`Entrance: ${o.entrance}`, 15, { gap: 18 });
  if (o.rationale) {
    add("Why this layout", 17, { bold: true });
    for (const l of wrap(o.rationale, 62)) add(l, 14, { color: "#334155" });
    lines[lines.length - 1].gap = 18;
  }
  const notes = [...o.adjustments, ...o.assumptions];
  if (notes.length) {
    add("Assumptions", 17, { bold: true });
    for (const n of notes)
      wrap(`• ${n}`, 62).forEach((l, i) => add(i ? `  ${l}` : l, 13, { color: "#334155" }));
  }
  let y = 70;
  const text = lines
    .map((l) => {
      const t = `<text x="${planW + 70}" y="${y}" font-size="${l.size}" ${l.bold ? 'font-weight="700"' : ""} fill="${l.color ?? "#0f172a"}">${esc(l.text)}</text>`;
      y += l.size * 1.45 + (l.gap ?? 0);
      return t;
    })
    .join("");
  const H = Math.max(planH + 140, y + 90);
  const [l1, l2] = SCHEMATIC_LABEL.split("; ");
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Arial, Helvetica, sans-serif">
<rect width="${W}" height="${H}" fill="#ffffff"/>
<text x="40" y="44" font-size="14" font-weight="700" fill="#b45309">CorvusDP · Schematic concept</text>
<svg x="30" y="60" width="${planW}" height="${planH}" viewBox="${vb.x} ${vb.y} ${vb.width} ${vb.height}">${planMarkup(
    plan,
  )
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>$/, "")}</svg>
${text}
<rect x="30" y="${H - 64}" width="${W - 60}" height="44" rx="8" fill="#fef3c7" stroke="#f59e0b"/>
<text x="${W / 2}" y="${H - 37}" text-anchor="middle" font-size="16" font-weight="700" fill="#92400e">${esc(l1)}; ${esc(l2)}</text>
</svg>`;
  return { markup, width: W, height: H };
}

export async function downloadConceptSheet(
  plan: SVGSVGElement,
  o: SchematicOption,
  info: { project: string; address: string },
  filename: string,
) {
  const { markup, width, height } = conceptSheetSvg(plan, o, info);
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Couldn't draw the concept sheet."));
      i.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (!blob) throw new Error("Couldn't create the image.");
    save(blob, filename);
  } finally {
    URL.revokeObjectURL(url);
  }
}
