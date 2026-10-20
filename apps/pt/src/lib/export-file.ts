// Download a table as CSV or a real Excel workbook (.xlsx). The Excel writer
// is loaded only when someone exports, so it never weighs on page load.
export type Table = { headers: string[]; rows: (string | number | null | undefined)[][] };

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (t: Table) =>
  [t.headers, ...t.rows].map((r) => r.map(csvCell).join(",")).join("\n");

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const safe = (name: string) =>
  name
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "_") || "export";

export function downloadCsv(name: string, t: Table) {
  // BOM so Excel opens UTF-8 (en dashes, accents) correctly
  const BOM = String.fromCharCode(0xfeff);
  save(new Blob([BOM + toCsv(t)], { type: "text/csv;charset=utf-8" }), `${safe(name)}.csv`);
}

export async function downloadXlsx(name: string, t: Table) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const header = t.headers.map((h) => ({ value: h, fontWeight: "bold" as const }));
  const body = t.rows.map((r) =>
    r.map((v) => (v == null || v === "" ? null : typeof v === "number" ? v : String(v))),
  );
  const blob = await writeXlsxFile([header, ...body], {
    sheet: safe(name).slice(0, 31),
    columns: t.headers.map((h) => ({ width: Math.min(40, Math.max(10, h.length + 4)) })),
  }).toBlob();
  save(blob, `${safe(name)}.xlsx`);
}
