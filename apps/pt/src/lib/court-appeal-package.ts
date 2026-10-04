// The "Prepare for Attorney" package: the existing case organized into one PDF —
// a clean summary up front, then the evidence files already in the case — that
// the owner can hand to an attorney. Organizing only: no legal argument is
// generated and nothing is filed.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { buildEvidencePackagePdf, type PackageFile } from "./evidence-package";

export type PackageSection = { heading: string; lines: string[] };

// pdf-lib's built-in fonts only cover WinAnsi — swap the few symbols the app
// uses and drop anything else rather than throwing mid-render.
export function winAnsiSafe(text: string): string {
  return text
    .replace(/→/g, "->")
    .replace(/≈/g, "~")
    .replace(/[✓✔]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, "...")
    .replace(/[^\n\x20-\x7E -ÿ–—•]/g, "");
}

const PAGE: [number, number] = [612, 792];
const MARGIN = 54;

export async function buildAttorneyPackagePdf(input: {
  title: string;
  subtitle: string;
  sections: PackageSection[];
  evidence: PackageFile[];
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const maxWidth = PAGE[0] - MARGIN * 2;

  let page = doc.addPage(PAGE);
  let y = PAGE[1] - MARGIN;

  const ensure = (needed: number) => {
    if (y - needed < MARGIN) {
      page = doc.addPage(PAGE);
      y = PAGE[1] - MARGIN;
    }
  };

  const wrap = (text: string, f: typeof font, size: number): string[] => {
    const out: string[] = [];
    for (const paragraph of winAnsiSafe(text).split("\n")) {
      let line = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(next, size) > maxWidth && line) {
          out.push(line);
          line = word;
        } else {
          line = next;
        }
      }
      out.push(line);
    }
    return out;
  };

  const draw = (text: string, f: typeof font, size: number, gap = 4, indent = 0) => {
    for (const line of wrap(text, f, size)) {
      ensure(size + gap);
      page.drawText(line, {
        x: MARGIN + indent,
        y: y - size,
        size,
        font: f,
        color: rgb(0.1, 0.1, 0.1),
      });
      y -= size + gap;
    }
  };

  draw(input.title, bold, 20, 6);
  draw(input.subtitle, font, 10, 14);

  for (const section of input.sections) {
    ensure(40);
    y -= 6;
    draw(section.heading, bold, 13, 6);
    for (const line of section.lines) draw(line, font, 10.5, 3, 8);
  }

  const summary = await doc.save();
  if (input.evidence.length === 0) return summary;

  // Evidence behind the summary, one labelled section per file.
  const evidencePdf = await PDFDocument.load(await buildEvidencePackagePdf(input.evidence));
  const merged = await PDFDocument.load(summary);
  const pages = await merged.copyPages(evidencePdf, evidencePdf.getPageIndices());
  pages.forEach((p) => merged.addPage(p));
  return merged.save();
}
