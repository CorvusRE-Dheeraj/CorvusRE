import { ExternalLink, ScrollText } from "lucide-react";
import { clerkRecordsFor, ownerSearchName } from "@/lib/deed-records";

// The county clerk's official deed records for this owner (see deed-records.ts).
export function DeedRecordsLink({ cad, owner }: { cad: string | null; owner: string | null }) {
  const clerk = clerkRecordsFor(cad);
  if (!clerk) return null;
  const name = ownerSearchName(owner);
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
      <ScrollText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div>
        <a
          href={name ? clerk.searchUrl(name) : clerk.homeUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-accent underline"
        >
          Official deed records — {clerk.clerk} <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
        <p className="text-xs text-muted-foreground">
          {name
            ? `Opens the clerk's search for "${name}": recorded deeds, liens, releases and plats.`
            : "Search the clerk's recorded deeds, liens, releases and plats by owner name."}
        </p>
      </div>
    </div>
  );
}
