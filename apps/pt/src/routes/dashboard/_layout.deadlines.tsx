import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { currency } from "@/lib/intake-store";
import { useAuth } from "@/lib/auth";
import { listProperties, markPropertyPaid, type PropertyRecord } from "@/lib/properties";
import { listProtests, type ProtestRecord } from "@/lib/protests";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/dashboard/_layout/deadlines")({
  component: Deadlines,
});

function Deadlines() {
  const { user } = useAuth();
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [protests, setProtests] = useState<ProtestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([listProperties(user.id), listProtests(user.id)])
      .then(([props, prot]) => {
        setProperties(props);
        setProtests(prot);
      })
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, [user]);

  async function handleMarkPaid(propertyId: string) {
    setMarkingPaidId(propertyId);
    try {
      const updated = await markPropertyPaid(propertyId);
      setProperties((prev) => prev.map((p) => (p.id === propertyId ? updated : p)));
      toast.success("Marked as paid.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update this bill.");
    } finally {
      setMarkingPaidId(null);
    }
  }

  const deadlines = properties
    .filter((p) => !!p.protestDeadline)
    .map((p) => {
      const deadline = new Date(p.protestDeadline as string);
      const daysLeft = Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      return { property: p, deadline, daysLeft };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const bills = properties
    .filter((p) => !!p.paymentDueDate)
    .map((p) => {
      const dueDate = new Date(p.paymentDueDate as string);
      const daysLeft = Math.ceil((dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      return { property: p, dueDate, daysLeft, isPaid: !!p.paidAt };
    })
    .sort((a, b) => Number(a.isPaid) - Number(b.isPaid) || a.daysLeft - b.daysLeft);

  const hearings = protests
    .filter((pr) => pr.status === "hearing_scheduled" && !!pr.hearingDate)
    .map((pr) => {
      const property = properties.find((p) => p.id === pr.propertyId);
      const hearingDate = new Date(pr.hearingDate as string);
      const daysLeft = Math.ceil((hearingDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      return { property, hearingDate, daysLeft };
    })
    .filter(
      (h): h is { property: PropertyRecord; hearingDate: Date; daysLeft: number } => !!h.property,
    )
    .sort((a, b) => a.daysLeft - b.daysLeft);

  if (loading) {
    return (
      <div className="grid gap-8">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Deadlines</h1>
          <p className="text-muted-foreground text-sm">Protest deadlines, ARB hearings, and tax bills, in one place.</p>
        </div>
        <div className="grid gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="card-elev p-4 flex items-center justify-between gap-2">
              <div className="grid gap-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="h-6 w-24 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Deadlines</h1>
        <p className="text-muted-foreground text-sm">Protest deadlines, ARB hearings, and tax bills, in one place.</p>
      </div>

      <section>
        <h2 className="font-semibold">Protest Deadlines</h2>
        <div className="mt-3">
          {deadlines.length > 0 ? (
            <div className="grid gap-3">
              {deadlines.map(({ property, deadline, daysLeft }) => (
                <div
                  key={property.id}
                  className="card-elev p-4 flex items-center justify-between flex-wrap gap-2"
                >
                  <div>
                    <div className="font-medium">{property.address}</div>
                    <div className="text-xs text-muted-foreground">
                      Protest deadline: {deadline.toLocaleDateString()}
                    </div>
                  </div>
                  <span className={`badge-soft ${daysLeft <= 7 ? "text-destructive" : ""}`}>
                    {daysLeft < 0
                      ? "Deadline passed"
                      : daysLeft === 0
                        ? "Due today"
                        : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="card-elev p-6 text-center text-sm text-muted-foreground">
              No notifications. Upload an appraisal notice with a protest deadline and it'll show up here.
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="font-semibold">Upcoming Hearings</h2>
        <div className="mt-3">
          {hearings.length > 0 ? (
            <div className="grid gap-3">
              {hearings.map(({ property, hearingDate, daysLeft }) => (
                <div
                  key={property.id}
                  className="card-elev p-4 flex items-center justify-between flex-wrap gap-2"
                >
                  <div>
                    <div className="font-medium">{property.address}</div>
                    <div className="text-xs text-muted-foreground">
                      ARB hearing: {hearingDate.toLocaleDateString()}
                    </div>
                  </div>
                  <span className={`badge-soft ${daysLeft <= 7 ? "text-destructive" : ""}`}>
                    {daysLeft < 0
                      ? "Hearing passed"
                      : daysLeft === 0
                        ? "Today"
                        : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="card-elev p-6 text-center text-sm text-muted-foreground">
              No hearings scheduled. Once a hearing is scheduled from a case's Case Progress
              section, it'll show up here.
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="font-semibold">Tax Bills</h2>
        <div className="mt-3">
          {bills.length > 0 ? (
            <div className="grid gap-3">
              {bills.map(({ property, dueDate, daysLeft, isPaid }) => (
                <div
                  key={property.id}
                  className="card-elev p-4 flex items-center justify-between flex-wrap gap-2"
                >
                  <div>
                    <div className="font-medium">{property.address}</div>
                    <div className="text-xs text-muted-foreground">
                      Due {dueDate.toLocaleDateString()}
                      {property.taxAmountDue != null ? ` • ${currency(property.taxAmountDue)}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isPaid ? (
                      <span className="badge-soft text-success">Paid</span>
                    ) : (
                      <>
                        <span className={`badge-soft ${daysLeft <= 7 ? "text-destructive" : ""}`}>
                          {daysLeft < 0
                            ? "Overdue"
                            : daysLeft === 0
                              ? "Due today"
                              : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
                        </span>
                        <button
                          disabled={markingPaidId === property.id}
                          onClick={() => handleMarkPaid(property.id)}
                          className="btn-outline text-sm disabled:opacity-60"
                        >
                          {markingPaidId === property.id ? "Saving…" : "Mark as Paid"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="card-elev p-6 text-center text-sm text-muted-foreground">
              No tax bills tracked yet. Upload a tax bill or statement and its due date and amount will
              show up here.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
