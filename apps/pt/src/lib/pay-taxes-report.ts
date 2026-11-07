import type { PayTaxesRow, Installment } from "./pay-taxes";

// Pay Taxes → "Download PDF" (a one-table summary of every property's tax, due
// date and half-payment option, with totals) and "Add to Calendar" (every due
// date as a calendar file, with reminders before each one).

export type HalfPayState = "available" | "to_confirm" | "not_available";

export type SummaryLine = {
  propertyId: string;
  property: string; // the street line
  address: string; // city, state, ZIP
  owner: string | null;
  county: string | null;
  taxYear: number;
  totalTax: number | null;
  totalIsEstimate: boolean;
  totalFromCad: boolean; // appraisal district value × adopted rates, no statement yet
  dueDate: string;
  halfPay: HalfPayState;
  firstHalf: Installment | null;
  secondHalf: Installment | null;
};

export type SummaryTotals = {
  totalTax: number;
  firstHalf: number;
  secondHalf: number;
  estimated: number; // how many totals are estimates
  halfPayCount: number;
};

// "10247 WARREN PKWY, FRISCO, TX 75035" → ["10247 WARREN PKWY", "FRISCO, TX 75035"]
export function splitAddress(address: string): [string, string] {
  const i = address.indexOf(",");
  return i < 0 ? [address.trim(), ""] : [address.slice(0, i).trim(), address.slice(i + 1).trim()];
}

export function summaryLine(row: PayTaxesRow): SummaryLine {
  const [property, address] = splitAddress(row.property.address);
  const enrolledHalf = row.enrolledPlan?.plan.kind === "half" ? row.enrolledPlan : null;
  const plan = enrolledHalf ?? row.halfPay;
  const halfPay: HalfPayState = enrolledHalf
    ? "available"
    : !plan || plan.status === "not_eligible"
      ? "not_available"
      : plan.status === "eligible"
        ? "available"
        : "to_confirm";
  const inst = halfPay === "not_available" ? [] : (plan?.installments ?? []);
  return {
    propertyId: row.property.id,
    property,
    address,
    owner: row.property.ownerName,
    county: row.county,
    taxYear: row.taxYear,
    totalTax: row.totalTax,
    totalIsEstimate: row.totalTaxIsEstimate && row.totalTax != null,
    totalFromCad: row.totalTaxBasis === "cad",
    // the bill's own due date (an installment plan's next date lives in the half columns)
    dueDate: row.bill?.dueDate ?? row.property.paymentDueDate ?? row.dueDate,
    halfPay,
    firstHalf: inst[0] ?? null,
    secondHalf: inst[1] ?? null,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Half-payment totals count only properties where the option is available —
// a "check with the county" property isn't added to a total someone may pay by.
export function summaryTotals(lines: SummaryLine[]): SummaryTotals {
  const avail = lines.filter((l) => l.halfPay === "available");
  return {
    totalTax: round2(lines.reduce((s, l) => s + (l.totalTax ?? 0), 0)),
    firstHalf: round2(avail.reduce((s, l) => s + (l.firstHalf?.amount ?? 0), 0)),
    secondHalf: round2(avail.reduce((s, l) => s + (l.secondHalf?.amount ?? 0), 0)),
    estimated: lines.filter((l) => l.totalIsEstimate).length,
    halfPayCount: avail.length,
  };
}

const usd = (n: number | null | undefined) =>
  n == null
    ? "—"
    : n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

export const fmtLongDate = (iso: string | null | undefined) =>
  iso
    ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

const HALF_LABEL: Record<HalfPayState, string> = {
  available: "Yes",
  to_confirm: "Check with county",
  not_available: "Not available",
};

// The table's cells as text, in column order — shared by the PDF and its tests.
export const REPORT_COLUMNS = [
  "Property",
  "Address",
  "Owner",
  "County",
  "Total tax",
  "Tax due date",
  "Half-payment",
  "1st half",
  "1st half due",
  "2nd half",
  "2nd half due",
] as const;

export function reportCells(l: SummaryLine): string[] {
  const halfCell = (i: Installment | null, what: "amount" | "date") => {
    if (l.halfPay === "not_available") return "N/A";
    if (!i) return "—";
    const v = what === "amount" ? usd(i.amount) : fmtLongDate(i.dueDate);
    return l.halfPay === "to_confirm" && what === "amount" ? `${v}†` : v;
  };
  return [
    l.property,
    l.address,
    l.owner ?? "—",
    l.county ?? "—",
    `${usd(l.totalTax)}${l.totalIsEstimate ? "*" : l.totalFromCad ? "‡" : ""}`,
    fmtLongDate(l.dueDate),
    HALF_LABEL[l.halfPay],
    halfCell(l.firstHalf, "amount"),
    halfCell(l.firstHalf, "date"),
    halfCell(l.secondHalf, "amount"),
    halfCell(l.secondHalf, "date"),
  ];
}

export function totalsCells(t: SummaryTotals): string[] {
  return [
    "Total",
    "",
    "",
    "",
    usd(t.totalTax),
    "",
    "",
    usd(t.firstHalf),
    "",
    usd(t.secondHalf),
    "",
  ];
}

// ── PDF ─────────────────────────────────────────────────────────────────────

export async function summaryPdf(
  lines: SummaryLine[],
  opts: { generatedAt?: Date; preparedFor?: string | null } = {},
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setTitle("Property Tax Summary");
  doc.setCreator("CorvusPT");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 792;
  const H = 612;
  const M = 36;
  const ink = rgb(0.09, 0.14, 0.23);
  const muted = rgb(0.4, 0.45, 0.53);
  const line = rgb(0.85, 0.88, 0.91);
  const headFill = rgb(0.06, 0.29, 0.25);
  const zebra = rgb(0.965, 0.973, 0.98);
  const red = rgb(0.7, 0.14, 0.1);
  // column widths (sum = W - 2M = 720); money columns right-aligned
  const widths = [86, 92, 88, 46, 64, 58, 62, 54, 58, 54, 58];
  const right = new Set([4, 7, 9]);
  const size = 7.6;
  const lh = 9.6;
  const pad = 4;
  const clean = (s: string) =>
    s
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, "-")
      .replace(/[^\t\n\r\x20-\x7E\xA0-\xFF†‡]/g, "");
  const wrap = (text: string, w: number, f = font): string[] => {
    const out: string[] = [];
    let cur = "";
    for (const word of clean(text).split(/\s+/)) {
      const next = cur ? `${cur} ${word}` : word;
      if (f.widthOfTextAtSize(next, size) <= w - pad * 2 || !cur) cur = next;
      else {
        out.push(cur);
        cur = word;
      }
    }
    if (cur) out.push(cur);
    // a single word wider than the cell: hard-cut it
    return out.flatMap((l) => {
      if (f.widthOfTextAtSize(l, size) <= w - pad * 2) return [l];
      const parts: string[] = [];
      let p = "";
      for (const ch of l) {
        if (f.widthOfTextAtSize(p + ch, size) > w - pad * 2) {
          parts.push(p);
          p = ch;
        } else p += ch;
      }
      return [...parts, p];
    });
  };

  const generated = (opts.generatedAt ?? new Date()).toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const years = [...new Set(lines.map((l) => l.taxYear))].sort();
  const totals = summaryTotals(lines);

  let page = doc.addPage([W, H]);
  let y = H - M;
  const pages = [page];

  const drawHeader = (first: boolean) => {
    if (first) {
      page.drawText("Property Tax Summary", { x: M, y: y - 16, size: 18, font: bold, color: ink });
      page.drawText("CorvusPT", {
        x: W - M - bold.widthOfTextAtSize("CorvusPT", 12),
        y: y - 14,
        size: 12,
        font: bold,
        color: headFill,
      });
      y -= 30;
      const sub = [
        `Tax year${years.length > 1 ? "s" : ""} ${years.join(", ")}`,
        `${lines.length} propert${lines.length === 1 ? "y" : "ies"}`,
        opts.preparedFor ? `Prepared for ${opts.preparedFor}` : null,
        `Generated ${generated}`,
      ]
        .filter(Boolean)
        .join("   ·   ");
      page.drawText(clean(sub), { x: M, y, size: 9, font, color: muted });
      y -= 16;
    }
    // column header
    const hh = 2 * lh + 6;
    page.drawRectangle({ x: M, y: y - hh, width: W - 2 * M, height: hh, color: headFill });
    let x = M;
    REPORT_COLUMNS.forEach((c, i) => {
      const ls = wrap(c, widths[i], bold);
      ls.forEach((t, j) => {
        const tw = bold.widthOfTextAtSize(t, size);
        page.drawText(t, {
          x: right.has(i) ? x + widths[i] - pad - tw : x + pad,
          y: y - 4 - lh * (j + 1) + 2,
          size,
          font: bold,
          color: rgb(1, 1, 1),
        });
      });
      x += widths[i];
    });
    y -= hh;
  };

  const newPage = () => {
    page = doc.addPage([W, H]);
    pages.push(page);
    y = H - M;
    drawHeader(false);
  };

  drawHeader(true);

  const drawRow = (
    cells: string[],
    opts2: { fill?: boolean; total?: boolean; notAvail?: boolean },
  ) => {
    const f = opts2.total ? bold : font;
    const wrapped = cells.map((c, i) => wrap(c, widths[i], f));
    const rows = Math.max(...wrapped.map((w) => w.length));
    const h = rows * lh + 6;
    if (y - h < M + 40) newPage();
    if (opts2.fill)
      page.drawRectangle({ x: M, y: y - h, width: W - 2 * M, height: h, color: zebra });
    if (opts2.total) {
      page.drawRectangle({
        x: M,
        y: y - h,
        width: W - 2 * M,
        height: h,
        color: rgb(0.91, 0.95, 0.93),
      });
      page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.2, color: headFill });
    }
    let x = M;
    wrapped.forEach((ls, i) => {
      ls.forEach((t, j) => {
        const tw = f.widthOfTextAtSize(t, size);
        const isNA = opts2.notAvail && (i === 6 || t === "N/A");
        page.drawText(t, {
          x: right.has(i) ? x + widths[i] - pad - tw : x + pad,
          y: y - 3 - lh * (j + 1) + 2,
          size,
          font: f,
          color: isNA ? red : ink,
        });
      });
      x += widths[i];
    });
    y -= h;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: line });
  };

  lines.forEach((l, i) =>
    drawRow(reportCells(l), { fill: i % 2 === 1, notAvail: l.halfPay === "not_available" }),
  );
  drawRow(totalsCells(totals), { total: true });

  // notes
  const notes = [
    totals.estimated > 0
      ? `* Estimate (${totals.estimated} propert${totals.estimated === 1 ? "y" : "ies"}): assessed value x the county's typical tax rate - upload the tax statement for the official amount.`
      : null,
    lines.some((l) => l.totalFromCad)
      ? "‡ From the appraisal district: the certified value x each taxing unit's adopted rate (no tax statement on file yet; exemptions can lower the bill)."
      : null,
    "Half-payment: Yes = the county's split-payment option applies; N/A / Not available = the property must be paid in full by the tax due date.",
    lines.some((l) => l.halfPay === "to_confirm")
      ? "† Check with county: the option may apply (e.g. it depends on an exemption) - amounts are shown for reference and not included in the half-payment totals."
      : null,
    `Half-payment totals include only the ${totals.halfPayCount} propert${totals.halfPayCount === 1 ? "y" : "ies"} where the option is available.`,
    "CorvusPT doesn't collect tax payments; amounts and dates are from your tax bills or the county's published schedule. Confirm with your county tax office before paying.",
  ].filter((n): n is string => !!n);
  y -= 10;
  for (const n of notes) {
    const ls = wrap(n, W - 2 * M + pad * 2);
    if (y - ls.length * 10 < M) newPage();
    for (const t of ls) {
      page.drawText(t, { x: M, y: y - 8, size: 7.2, font, color: muted });
      y -= 10;
    }
    y -= 2;
  }

  pages.forEach((p, i) => {
    const t = `Page ${i + 1} of ${pages.length}`;
    p.drawText(t, {
      x: W - M - font.widthOfTextAtSize(t, 7.5),
      y: M - 18,
      size: 7.5,
      font,
      color: muted,
    });
    p.drawText(clean(`Property Tax Summary - generated ${generated}`), {
      x: M,
      y: M - 18,
      size: 7.5,
      font,
      color: muted,
    });
  });
  return doc.save();
}

// ── Calendar ────────────────────────────────────────────────────────────────

export type DueEvent = { uid: string; date: string; title: string; description: string };

// Every date to pay by: the bill's due date, and — where the half-payment option
// is available — the first and second half dates.
export function dueEvents(lines: SummaryLine[]): DueEvent[] {
  const out: DueEvent[] = [];
  for (const l of lines) {
    const where = `${l.property}${l.address ? `, ${l.address}` : ""}`;
    out.push({
      uid: `tax-due-${l.propertyId}-${l.taxYear}`,
      date: l.dueDate.slice(0, 10),
      title: `Property tax due — ${l.property}`,
      description: `${l.taxYear} property tax for ${where} (${l.county ?? "county"} County)${
        l.totalTax != null ? ` — ${usd(l.totalTax)}${l.totalIsEstimate ? " (estimate)" : ""}` : ""
      }. Pay on the county's site; CorvusPT → Pay Taxes has the link.`,
    });
    if (l.halfPay === "available") {
      for (const [n, inst] of [
        ["First", l.firstHalf],
        ["Second", l.secondHalf],
      ] as const) {
        if (!inst?.dueDate) continue;
        out.push({
          uid: `tax-half-${n.toLowerCase()}-${l.propertyId}-${l.taxYear}`,
          date: inst.dueDate.slice(0, 10),
          title: `${n} half of property tax due — ${l.property}`,
          description: `${n} half-payment of the ${l.taxYear} property tax for ${where}${
            inst.amount != null ? ` — ${usd(inst.amount)}` : ""
          } (if you split the payment).`,
        });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const icsText = (t: string) => t.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");

// Alerts 30, 15, 7, 2 and 1 days before, and the morning of (9 AM).
const ALARM_DAYS = [30, 15, 7, 2, 1, 0];

export function dueEventsIcs(events: DueEvent[], now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const body = events.map((e) => {
    const start = e.date.replace(/-/g, "");
    const end = new Date(`${e.date}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    return [
      "BEGIN:VEVENT",
      `UID:${e.uid}@corvusre.com`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${end.toISOString().slice(0, 10).replace(/-/g, "")}`,
      `SUMMARY:${icsText(e.title)}`,
      `DESCRIPTION:${icsText(e.description)}`,
      "TRANSP:TRANSPARENT",
      ...ALARM_DAYS.flatMap((d) => [
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `DESCRIPTION:${icsText(d === 0 ? `Today: ${e.title}` : `In ${d} day${d === 1 ? "" : "s"}: ${e.title}`)}`,
        // all-day events start at midnight: 9 AM on the day = +9h; N days before at 9 AM = -(N*24-9)h
        `TRIGGER:${d === 0 ? "PT9H" : `-PT${d * 24 - 9}H`}`,
        "END:VALARM",
      ]),
      "END:VEVENT",
    ].join("\r\n");
  });
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CorvusPT.ai//Pay Taxes//EN",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Property tax due dates",
    ...body,
    "END:VCALENDAR",
  ].join("\r\n");
}

export function downloadFile(data: Uint8Array | string, name: string, type: string) {
  const blob = new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
