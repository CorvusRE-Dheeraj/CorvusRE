// The survey as an image the plan can be laid over: PNG/JPEG straight from
// storage, a PDF's plan page drawn in the browser with pdf.js (loaded only
// when needed). Plus the mapping from plan feet onto the lot outline Corvus AI
// found on that image (survey-reading placement).
import { surveyUrl } from "./design-survey";

export type Placement = {
  page: number;
  box: [number, number, number, number] | null; // ymin, xmin, ymax, xmax — 0..1000
  streetEdge: "top" | "bottom" | "left" | "right" | null;
};
export type SurveyImage = { src: string; width: number; height: number };

const cache = new Map<string, Promise<SurveyImage>>();

function loadImage(src: string): Promise<SurveyImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve({ src, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("Couldn't load the survey image."));
    img.src = src;
  });
}

async function renderPdfPage(url: string, pageNo: number): Promise<SurveyImage> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const task = pdfjs.getDocument({ url });
  const doc = await task.promise;
  const page = await doc.getPage(Math.min(Math.max(1, pageNo), doc.numPages));
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(3, 1800 / base.width) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  await task.destroy();
  return { src: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
}

/** The survey (or the PDF's plan page) as an image, cached per file and page. */
export function surveyImage(
  path: string,
  type: string | null | undefined,
  page = 1,
): Promise<SurveyImage> {
  const key = `${path}#${page}`;
  if (!cache.has(key)) {
    const p = surveyUrl(path).then((url) =>
      type === "application/pdf" ? renderPdfPage(url, page) : loadImage(url),
    );
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return cache.get(key)!;
}

/**
 * Maps plan feet (origin front-left as seen from the street, y toward the
 * rear) to image pixels inside the lot box, whichever edge of the drawing the
 * street is on. A rigid rotation — never mirrored.
 */
export function planToImage(
  placement: Placement,
  img: { width: number; height: number },
  lot: { widthFt: number; depthFt: number },
) {
  const [ymin, xmin, ymax, xmax] = placement.box!;
  const bx0 = (xmin / 1000) * img.width,
    bx1 = (xmax / 1000) * img.width;
  const by0 = (ymin / 1000) * img.height,
    by1 = (ymax / 1000) * img.height;
  const bw = bx1 - bx0,
    bh = by1 - by0;
  const W = lot.widthFt,
    D = lot.depthFt;
  const edge = placement.streetEdge ?? "bottom";
  return (x: number, y: number): [number, number] => {
    switch (edge) {
      case "top": // street at the top, facing down: the lot's left is the image's right
        return [bx1 - (x / W) * bw, by0 + (y / D) * bh];
      case "left": // street on the left, facing right: the lot's left is the image's top
        return [bx0 + (y / D) * bw, by0 + (x / W) * bh];
      case "right": // street on the right, facing left: the lot's left is the image's bottom
        return [bx1 - (y / D) * bw, by1 - (x / W) * bh];
      default: // street at the bottom, facing up
        return [bx0 + (x / W) * bw, by1 - (y / D) * bh];
    }
  };
}
