import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { getActiveDesignRequest } from "@/lib/design-requests";
import { scopeLabel } from "@/lib/design";

// Shared by every page in the dashboard's Design section — the same "most
// recently touched design request" the Design overview has always shown, under
// the same query key, so switching between Design pages doesn't refetch.
export function useActiveDesignRequest() {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ["design-request", user?.id],
    queryFn: () => getActiveDesignRequest(user!.id),
    enabled: !!user?.id,
  });
  return {
    loading: q.isLoading,
    dr: q.data ?? null,
    brief: q.data?.brief ?? null,
    refetch: q.refetch,
  };
}

export function EmptyDesign() {
  return (
    <div className="card-elev p-8 text-center">
      <h2 className="font-serif text-lg font-semibold">No design brief yet</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Generate one and save it to track it here.
      </p>
      <Link to="/design/analyze" className="btn-accent mt-4 inline-flex">
        Start a Design Brief
      </Link>
    </div>
  );
}

// One-line context so each Design page says which project it's about.
export function designSubtitle(dr: {
  scope: string | null;
  sector: string | null;
  building_area: string | null;
  address: string | null;
  city: string | null;
}): string {
  return `${dr.address ?? dr.city ?? "Design project"} · ${scopeLabel((dr.scope ?? undefined) as never)} · ${dr.sector ?? "commercial"} · ${dr.building_area ?? "?"} sf`;
}

export function downloadText(filename: string, text: string, type = "text/plain") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function fileSlug(dr: { address: string | null }): string {
  return (dr.address ?? "project").replace(/[^\w]+/g, "-").slice(0, 40);
}
