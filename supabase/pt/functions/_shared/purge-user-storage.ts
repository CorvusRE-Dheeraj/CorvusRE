// Deleting an auth.users row cascades every app table that references it
// (properties, protests, documents, bpp_accounts, profiles, …) — but NOT the
// objects in the private `documents` storage bucket. Those are only reachable
// through public.documents.storage_path, and once that row is cascaded away
// the file is orphaned in the bucket with nothing left pointing at it.
//
// That silently broke the promise both delete paths make. The self-serve
// dialog says: "This permanently deletes your account, every property, BPP
// account, document, and protest case on file. There is no way to recover
// this data afterward." The admin panel's confirm says the same. Reproduced
// live before this fix: an account with one uploaded document was deleted
// through the real Settings flow — auth.users row gone, documents row gone,
// and the file itself still sitting in the bucket.
//
// These are appraisal notices, signed service agreements and protest
// evidence — real tax records with names, addresses and values on them — so
// leaving them behind is a data-retention problem, not just untidiness.
//
// Call this BEFORE auth.admin.deleteUser(), while the documents rows still
// exist to read the paths from.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function purgeUserDocumentFiles(adminClient: any, userId: string): Promise<number> {
  const { data, error } = await adminClient
    .from("documents")
    .select("storage_path")
    .eq("user_id", userId);
  if (error || !data?.length) return 0;

  const paths = data
    .map((d: { storage_path: string | null }) => d.storage_path)
    .filter((p: string | null): p is string => typeof p === "string" && p.length > 0);
  if (!paths.length) return 0;

  // The storage API caps how many objects one remove() call takes; chunk so a
  // heavy account still gets fully cleaned instead of silently half-cleaned.
  let removed = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const { error: rmErr } = await adminClient.storage.from("documents").remove(chunk);
    // Best-effort: a storage failure must not block the account deletion
    // itself (the user asked to be deleted, and the DB rows are what gate
    // access) — it's logged for follow-up instead.
    if (rmErr) console.error("Could not remove document files during account deletion:", rmErr);
    else removed += chunk.length;
  }
  return removed;
}
