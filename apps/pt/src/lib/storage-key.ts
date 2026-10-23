// A file name made safe for a Supabase Storage key. Storage rejects keys with
// accents, en dashes, %, brackets and other characters common in real file
// names ("Notice (2026) – final.pdf", "Café façade.jpg") with "Invalid key",
// which made those uploads fail. The original name is still stored and shown;
// only the storage path uses this.
export function storageSafeName(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1) : "";
  const clean = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "") // drop accents: é → e
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "");
  const b = clean(base).slice(0, 120) || "file";
  const e = clean(ext).slice(0, 10);
  return e ? `${b}.${e}` : b;
}
