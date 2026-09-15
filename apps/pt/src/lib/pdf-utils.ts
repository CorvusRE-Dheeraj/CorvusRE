import { PDFDocument } from "pdf-lib";

export type FirstPage = {
  dataUrl: string;
  mimeType: string;
  pageCount: number;
};

// Splits off just page 1 of a PDF so the validation pass can check "is this even
// a Texas CAD notice" without paying for a full OCR/extraction pass over every
// page of a large or irrelevant upload. Image uploads are already a single page.
export async function getFirstPage(file: File): Promise<FirstPage> {
  if (!/pdf/i.test(file.type)) {
    const dataUrl = await fileToDataUrl(file);
    return { dataUrl, mimeType: file.type, pageCount: 1 };
  }

  const bytes = await file.arrayBuffer();
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pageCount = source.getPageCount();

  const firstPageDoc = await PDFDocument.create();
  const [copiedPage] = await firstPageDoc.copyPages(source, [0]);
  firstPageDoc.addPage(copiedPage);
  const firstPageBytes = await firstPageDoc.save();

  return {
    dataUrl: `data:application/pdf;base64,${bytesToBase64(firstPageBytes)}`,
    mimeType: "application/pdf",
    pageCount,
  };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Failed to read file"));
    r.readAsDataURL(file);
  });
}
