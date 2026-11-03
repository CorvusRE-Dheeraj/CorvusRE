// Module 10's "Download Protest Report (PDF)" — the analysis already done
// across CorvusPT consolidated into one short, mostly graphical report.
// Pure layout over the data it's handed (built in ai-report.tsx from the
// modules' real outputs); a section with nothing real to show is left out.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { winAnsiSafe } from "./court-appeal-package";
import {
  ASSESSMENT_TIER,
  READINESS_LABEL,
  type AssessmentTier,
  type ProtestReadinessResult,
} from "./executive-assessment";

export type ExecutiveReportData = {
  property: {
    address: string | null;
    county: string | null;
    account: string | null;
    owner: string | null;
    propertyType: string | null;
    taxYear: number | null;
  };
  tier: AssessmentTier;
  explanation: string | null;
  readiness: ProtestReadinessResult;
  values: {
    cad: number | null;
    compsMedian: number | null;
    compsRange: { min: number; max: number } | null;
    income: number | null;
    cost: number | null;
    valueToConsider: number | null;
    valueBasis: string | null;
  };
  comps: { address: string; distanceMi: number | null; value: number | null }[];
  compsGapPct: number | null;
  land: {
    keyFinding: string | null;
    factors: { factor: string; finding: string; severity: string }[];
  } | null;
  zoning: {
    matches: "consistent" | "inconsistent" | "uncertain";
    assessment: string;
    discrepancies: string[];
  } | null;
  improvement: {
    keyFinding: string | null;
    components: { component: string; condition: string }[];
  } | null;
  savings: {
    annual: number;
    reductionPct: number | null;
    taxRatePct: number | null;
    taxRateSource: string | null;
    assumptions: string[];
  } | null;
  strategies: { name: string; strengthScore: number; reason: string }[];
  evidence: { verified: number; found: number; missing: number; sources: string[] };
  missingCritical: string[];
  deadline: string | null;
  filingMethod: string | null;
};

const PAGE: [number, number] = [612, 792];
const M = 40;
const W = PAGE[0] - M * 2;
const FOOTER = 34;

const INK = rgb(0.09, 0.1, 0.13);
const MUTED = rgb(0.42, 0.44, 0.49);
const RULE = rgb(0.86, 0.87, 0.9);
const PANEL = rgb(0.96, 0.97, 0.98);
const NAVY = rgb(0.08, 0.13, 0.24);
const BLUE = rgb(0.2, 0.42, 0.78);
const TEAL = rgb(0.06, 0.55, 0.55);
const GREEN = rgb(0.13, 0.6, 0.38);
const AMBER = rgb(0.86, 0.6, 0.1);
const LAVENDER = rgb(0.58, 0.48, 0.84);
const RED = rgb(0.82, 0.25, 0.25);
const SLATE = rgb(0.55, 0.58, 0.64);

const TIER_COLOR: Record<AssessmentTier, RGB> = {
  recommended: GREEN,
  review: AMBER,
  limited: LAVENDER,
};
const READINESS_COLOR: Record<ProtestReadinessResult["status"], RGB> = {
  ready: GREEN,
  info_needed: AMBER,
  deadline_review: RED,
};
const CONDITION_COLOR: Record<string, RGB> = { Good: GREEN, Fair: AMBER, Poor: RED };
const SEVERITY_COLOR: Record<string, RGB> = { High: RED, Moderate: AMBER, Low: GREEN };

const tint = (c: RGB, t: number) =>
  rgb(c.red + (1 - c.red) * t, c.green + (1 - c.green) * t, c.blue + (1 - c.blue) * t);

export const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export async function buildExecutiveReportPdf(data: ExecutiveReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Executive Protest Report");
  doc.setProducer("CorvusPT");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = doc.addPage(PAGE);
  let y = PAGE[1] - M;

  const newPage = () => {
    page = doc.addPage(PAGE);
    y = PAGE[1] - M;
  };
  const ensure = (h: number) => {
    if (y - h < M + FOOTER) newPage();
  };

  const wrap = (text: string, f: PDFFont, size: number, maxW: number, maxLines = 99) => {
    const out: string[] = [];
    let line = "";
    for (const word of winAnsiSafe(text).split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && f.widthOfTextAtSize(next, size) > maxW) {
        out.push(line);
        line = word;
      } else line = next;
    }
    if (line) out.push(line);
    if (out.length > maxLines) {
      const kept = out.slice(0, maxLines);
      let last = kept[maxLines - 1];
      while (last && f.widthOfTextAtSize(`${last}...`, size) > maxW) last = last.slice(0, -1);
      kept[maxLines - 1] = `${last.trimEnd()}...`;
      return kept;
    }
    return out;
  };
  const text = (s: string, x: number, yy: number, size: number, f = font, color = INK) =>
    page.drawText(winAnsiSafe(s), { x, y: yy, size, font: f, color });
  const para = (
    s: string,
    x: number,
    size: number,
    maxW: number,
    opts: { f?: PDFFont; color?: RGB; maxLines?: number } = {},
  ) => {
    for (const l of wrap(s, opts.f ?? font, size, maxW, opts.maxLines)) {
      ensure(size * 1.4);
      text(l, x, y - size, size, opts.f ?? font, opts.color ?? INK);
      y -= size * 1.4;
    }
  };
  const rect = (x: number, yy: number, w: number, h: number, color: RGB) =>
    page.drawRectangle({ x, y: yy, width: w, height: h, color });
  const section = (title: string, needed: number) => {
    ensure(needed + 30);
    y -= 14;
    text(title.toUpperCase(), M, y - 9, 9, bold, TEAL);
    page.drawLine({
      start: { x: M, y: y - 14 },
      end: { x: M + W, y: y - 14 },
      thickness: 0.6,
      color: RULE,
    });
    y -= 24;
  };

  // --- Header -------------------------------------------------------------
  rect(0, PAGE[1] - 96, PAGE[0], 96, NAVY);
  text("EXECUTIVE PROTEST REPORT", M, PAGE[1] - 34, 9, bold, tint(TEAL, 0.35));
  const p = data.property;
  text(
    wrap(p.address ?? "Property", bold, 17, W - 130, 1)[0] ?? "",
    M,
    PAGE[1] - 56,
    17,
    bold,
    rgb(1, 1, 1),
  );
  const idLine = [
    p.county,
    p.account && `Account ${p.account}`,
    p.taxYear != null && `Tax year ${p.taxYear}`,
    p.propertyType,
  ]
    .filter(Boolean)
    .join("  |  ");
  text(wrap(idLine, font, 9.5, W, 1)[0] ?? "", M, PAGE[1] - 74, 9.5, font, tint(SLATE, 0.5));
  if (p.owner)
    text(
      wrap(`Owner: ${p.owner}`, font, 9, W, 1)[0] ?? "",
      M,
      PAGE[1] - 87,
      9,
      font,
      tint(SLATE, 0.5),
    );
  const generated = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  text(
    generated,
    M + W - font.widthOfTextAtSize(generated, 9),
    PAGE[1] - 34,
    9,
    font,
    tint(SLATE, 0.5),
  );
  y = PAGE[1] - 96 - 18;

  // --- Recommendation + readiness -----------------------------------------
  const tier = ASSESSMENT_TIER[data.tier];
  const tc = TIER_COLOR[data.tier];
  const cardW = W * 0.6;
  const explanation = wrap(data.explanation || tier.description, font, 10, cardW - 40, 4);
  const cardH = Math.max(86, 48 + explanation.length * 14);
  rect(M, y - cardH, cardW, cardH, tint(tc, 0.88));
  rect(M, y - cardH, 5, cardH, tc);
  page.drawCircle({ x: M + 22, y: y - 22, size: 6, color: tc });
  text("CORVUS AI FINAL RECOMMENDATION", M + 34, y - 18, 7.5, bold, MUTED);
  text(tier.label, M + 34, y - 36, 15, bold, INK);
  explanation.forEach((l, i) => text(l, M + 20, y - 54 - i * 14, 10, font, INK));

  const rx = M + cardW + 12;
  const rw = W - cardW - 12;
  const rc = READINESS_COLOR[data.readiness.status];
  rect(rx, y - cardH, rw, cardH, PANEL);
  text("PROTEST READINESS", rx + 12, y - 18, 7.5, bold, MUTED);
  const rLabel = wrap(READINESS_LABEL[data.readiness.status], bold, 10.5, rw - 34, 2);
  page.drawCircle({ x: rx + 16, y: y - 33, size: 4, color: rc });
  rLabel.forEach((l, i) => text(l, rx + 26, y - 37 - i * 13, 10.5, bold, INK));
  const req = data.readiness.requirement
    ? wrap(
        data.readiness.requirement,
        font,
        8.5,
        rw - 24,
        Math.max(1, Math.floor((cardH - 48 - rLabel.length * 13) / 11)),
      )
    : [];
  req.forEach((l, i) => text(l, rx + 12, y - 44 - rLabel.length * 13 - i * 11, 8.5, font, MUTED));
  y -= cardH + 4;

  // --- Value picture -------------------------------------------------------
  const v = data.values;
  const bars: { label: string; value: number; color: RGB; range?: { min: number; max: number } }[] =
    [];
  if (v.cad != null) bars.push({ label: "Current CAD value", value: v.cad, color: SLATE });
  if (v.compsMedian != null)
    bars.push({
      label: "Comparable sales",
      value: v.compsMedian,
      color: BLUE,
      range: v.compsRange ?? undefined,
    });
  if (v.income != null) bars.push({ label: "Income approach", value: v.income, color: TEAL });
  if (v.cost != null) bars.push({ label: "Cost approach", value: v.cost, color: tint(TEAL, 0.3) });
  if (v.valueToConsider != null)
    bars.push({ label: "Value to consider", value: v.valueToConsider, color: GREEN });
  if (bars.length > 0) {
    section("Value findings", bars.length * 24 + 20);
    const max = Math.max(...bars.map((b) => Math.max(b.value, b.range?.max ?? 0))) * 1.08 || 1;
    const lx = M + 118;
    const bw = W - 118 - 92;
    for (const b of bars) {
      text(b.label, M, y - 12, 9, font, INK);
      rect(lx, y - 16, bw, 14, PANEL);
      rect(lx, y - 16, (b.value / max) * bw, 14, b.color);
      if (b.range) {
        const x1 = lx + (b.range.min / max) * bw;
        const x2 = lx + (b.range.max / max) * bw;
        page.drawLine({
          start: { x: x1, y: y - 19 },
          end: { x: x2, y: y - 19 },
          thickness: 1,
          color: INK,
        });
        page.drawLine({
          start: { x: x1, y: y - 21 },
          end: { x: x1, y: y - 17 },
          thickness: 1,
          color: INK,
        });
        page.drawLine({
          start: { x: x2, y: y - 21 },
          end: { x: x2, y: y - 17 },
          thickness: 1,
          color: INK,
        });
      }
      const label = usd(b.value);
      text(label, M + W - bold.widthOfTextAtSize(label, 9.5), y - 12, 9.5, bold, INK);
      y -= 24;
    }
    if (v.compsRange) {
      text(
        `Comparable range ${usd(v.compsRange.min)} - ${usd(v.compsRange.max)} (whisker); bar shows the median.`,
        lx,
        y - 6,
        7.5,
        font,
        MUTED,
      );
      y -= 12;
    }
    if (v.valueBasis) {
      y -= 2;
      para(`Value to consider - basis: ${v.valueBasis}`, M, 8.5, W, { color: MUTED, maxLines: 2 });
    }
  }

  // --- Savings -------------------------------------------------------------
  if (data.savings) {
    const s = data.savings;
    section("Estimated tax savings", 70);
    const tiles: [string, string][] = [["Est. annual savings", usd(s.annual)]];
    if (s.reductionPct != null) tiles.push(["Value reduction", `${s.reductionPct}%`]);
    if (s.taxRatePct != null) tiles.push(["Effective tax rate", `${s.taxRatePct.toFixed(2)}%`]);
    const tw = (W - (tiles.length - 1) * 10) / tiles.length;
    tiles.forEach(([l, val], i) => {
      const x = M + i * (tw + 10);
      rect(x, y - 50, tw, 50, i === 0 ? tint(GREEN, 0.86) : PANEL);
      text(l.toUpperCase(), x + 10, y - 15, 7.5, bold, MUTED);
      text(val, x + 10, y - 38, 18, bold, i === 0 ? GREEN : INK);
    });
    y -= 58;
    const notes = [...s.assumptions.slice(0, 3)];
    if (s.taxRateSource) notes.push(`Tax rate source: ${s.taxRateSource}`);
    for (const n of notes) para(`-  ${n}`, M, 8.5, W, { color: MUTED, maxLines: 2 });
  }

  // --- Strategy --------------------------------------------------------------
  if (data.strategies.length > 0) {
    section("Recommended protest strategy", data.strategies.length * 34);
    for (const st of data.strategies) {
      ensure(34);
      const score = Math.max(0, Math.min(100, Math.round(st.strengthScore)));
      text(wrap(st.name, bold, 10, W - 150, 1)[0] ?? "", M, y - 11, 10, bold, INK);
      rect(M + W - 140, y - 13, 110, 9, PANEL);
      rect(
        M + W - 140,
        y - 13,
        (score / 100) * 110,
        9,
        score >= 70 ? GREEN : score >= 40 ? AMBER : SLATE,
      );
      text(`${score}`, M + W - 22, y - 12, 9.5, bold, INK);
      y -= 16;
      if (st.reason) para(st.reason, M, 8.5, W - 150, { color: MUTED, maxLines: 2 });
      y -= 4;
    }
  }

  // --- Comparable sales ----------------------------------------------------
  if (data.comps.length > 0) {
    section("Comparable sales", 22 + data.comps.length * 18);
    const cols = [M + 6, M + W - 170, M + W - 90];
    rect(M, y - 18, W, 18, PANEL);
    text("Property", cols[0], y - 12, 8, bold, MUTED);
    text("Distance", cols[1], y - 12, 8, bold, MUTED);
    text("Market value", cols[2], y - 12, 8, bold, MUTED);
    y -= 18;
    for (const c of data.comps) {
      ensure(18);
      text(wrap(c.address || "Comparable", font, 9, W - 190, 1)[0] ?? "", cols[0], y - 12, 9);
      text(c.distanceMi != null ? `${c.distanceMi.toFixed(1)} mi` : "-", cols[1], y - 12, 9);
      text(c.value != null ? usd(c.value) : "-", cols[2], y - 12, 9);
      page.drawLine({
        start: { x: M, y: y - 18 },
        end: { x: M + W, y: y - 18 },
        thickness: 0.4,
        color: RULE,
      });
      y -= 18;
    }
    if (data.compsGapPct != null) {
      y -= 4;
      para(
        data.compsGapPct > 0
          ? `The CAD value sits ${data.compsGapPct}% above the comparable median.`
          : `The CAD value sits at or below the comparable median (${data.compsGapPct}%).`,
        M,
        8.5,
        W,
        { color: MUTED },
      );
    }
  }

  // --- Land, zoning, improvements ------------------------------------------
  if (data.land || data.zoning || data.improvement) {
    section("Land, zoning and improvement condition", 90);
    if (data.land) {
      ensure(30);
      text("Land condition", M, y - 11, 10, bold, INK);
      y -= 16;
      if (data.land.keyFinding) para(data.land.keyFinding, M, 9, W, { maxLines: 3 });
      for (const f of data.land.factors.slice(0, 5)) {
        ensure(14);
        page.drawCircle({
          x: M + 4,
          y: y - 6,
          size: 3,
          color: SEVERITY_COLOR[f.severity] ?? SLATE,
        });
        const head = `${f.factor}: `;
        text(head, M + 12, y - 9, 8.5, bold, INK);
        const rest =
          wrap(f.finding, font, 8.5, W - 12 - bold.widthOfTextAtSize(head, 8.5), 1)[0] ?? "";
        text(rest, M + 12 + bold.widthOfTextAtSize(head, 8.5), y - 9, 8.5, font, MUTED);
        y -= 13;
      }
      y -= 6;
    }
    if (data.zoning) {
      ensure(30);
      text("Zoning & classification", M, y - 11, 10, bold, INK);
      const z = data.zoning;
      const chip =
        z.matches === "consistent"
          ? "Consistent"
          : z.matches === "inconsistent"
            ? "Inconsistent"
            : "Uncertain";
      const cc = z.matches === "consistent" ? GREEN : z.matches === "inconsistent" ? RED : AMBER;
      const cx = M + bold.widthOfTextAtSize("Zoning & classification", 10) + 10;
      const cw = bold.widthOfTextAtSize(chip, 8) + 12;
      rect(cx, y - 13, cw, 13, tint(cc, 0.82));
      text(chip, cx + 6, y - 10, 8, bold, cc);
      y -= 18;
      if (z.assessment) para(z.assessment, M, 9, W, { maxLines: 3 });
      for (const dsc of z.discrepancies.slice(0, 3))
        para(`-  ${dsc}`, M, 8.5, W, { color: MUTED, maxLines: 2 });
      y -= 6;
    }
    if (data.improvement) {
      ensure(40);
      text("Improvement condition", M, y - 11, 10, bold, INK);
      y -= 18;
      if (data.improvement.components.length > 0) {
        let x = M;
        for (const c of data.improvement.components) {
          const label = `${c.component}: ${c.condition === "Unknown" ? "Not assessed" : c.condition}`;
          const w = font.widthOfTextAtSize(label, 8.5) + 16;
          const col = CONDITION_COLOR[c.condition] ?? SLATE;
          rect(x, y - 15, w, 15, tint(col, 0.84));
          page.drawCircle({ x: x + 6, y: y - 7.5, size: 2.5, color: col });
          text(label, x + 11, y - 11, 8.5, font, INK);
          x += w + 6;
        }
        y -= 22;
      }
      if (data.improvement.keyFinding) para(data.improvement.keyFinding, M, 9, W, { maxLines: 3 });
    }
  }

  // --- Evidence ------------------------------------------------------------
  const ev = data.evidence;
  const evTotal = ev.verified + ev.found + ev.missing;
  if (evTotal > 0) {
    section("Supporting evidence", 60);
    const parts: [string, number, RGB][] = [
      ["Verified", ev.verified, GREEN],
      ["Found", ev.found, BLUE],
      ["Missing", ev.missing, tint(RED, 0.25)],
    ];
    let x = M;
    for (const [, n, c] of parts) {
      if (n === 0) continue;
      const w = (n / evTotal) * W;
      rect(x, y - 16, Math.max(0, w - 2), 16, c);
      x += w;
    }
    y -= 26;
    let lx = M;
    for (const [l, n, c] of parts) {
      rect(lx, y - 8, 8, 8, c);
      const s = `${l} ${n}`;
      text(s, lx + 12, y - 8, 8.5, font, INK);
      lx += font.widthOfTextAtSize(s, 8.5) + 30;
    }
    y -= 16;
    if (ev.sources.length > 0)
      para(`Sources: ${ev.sources.slice(0, 8).join("; ")}`, M, 8.5, W, {
        color: MUTED,
        maxLines: 3,
      });
  }

  // --- Missing evidence & filing readiness ---------------------------------
  if (data.missingCritical.length > 0 || data.deadline || data.filingMethod) {
    section("Missing critical evidence & filing readiness", 50);
    for (const item of data.missingCritical.slice(0, 6)) {
      ensure(14);
      page.drawCircle({ x: M + 4, y: y - 6, size: 3, color: AMBER });
      const lines = wrap(item, font, 9, W - 14, 2);
      lines.forEach((l, i) => text(l, M + 12, y - 9 - i * 12, 9));
      y -= lines.length * 12 + 2;
    }
    if (data.missingCritical.length === 0)
      para("No critical evidence gaps on file.", M, 9, W, { color: MUTED });
    y -= 4;
    const rows: [string, string][] = [];
    if (data.deadline) rows.push(["Protest deadline", data.deadline]);
    if (data.filingMethod) rows.push(["Filing method", data.filingMethod]);
    for (const [l, val] of rows) {
      ensure(14);
      text(l, M, y - 10, 9, bold, INK);
      text(wrap(val, font, 9, W - 110, 1)[0] ?? "", M + 110, y - 10, 9, font, INK);
      y -= 14;
    }
  }

  // --- Footer on every page -----------------------------------------------
  const pages = doc.getPages();
  pages.forEach((pg, i) => {
    pg.drawLine({
      start: { x: M, y: M + 14 },
      end: { x: M + W, y: M + 14 },
      thickness: 0.5,
      color: RULE,
    });
    pg.drawText(
      "CorvusPT analysis from the data on file - estimates, not a guarantee or legal/tax advice. The owner decides whether to protest.",
      { x: M, y: M, size: 7, font, color: MUTED },
    );
    const n = `${i + 1} / ${pages.length}`;
    pg.drawText(n, { x: M + W - font.widthOfTextAtSize(n, 7), y: M, size: 7, font, color: MUTED });
  });

  return doc.save();
}
