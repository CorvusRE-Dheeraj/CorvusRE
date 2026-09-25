import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
import { useAuth } from "@/lib/auth";
import { listProperties, type PropertyRecord } from "@/lib/properties";
import { listBppAccounts, type BppAccountRecord } from "@/lib/bpp-accounts";
import { listProtests } from "@/lib/protests";
import { computePortfolioSavings, type PortfolioSavings } from "@/lib/portfolio-savings";
import { currency } from "@/lib/intake-store";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHero } from "@/components/PageHero";
import { PiggyBank as HeroSavingsIcon } from "lucide-react";

export const Route = createFileRoute("/dashboard/_layout/savings")({
  component: SavingsPage,
});

function SavingsPage() {
  const { user } = useAuth();
  const [savings, setSavings] = useState<PortfolioSavings | null>(null);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [bppAccounts, setBppAccounts] = useState<BppAccountRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    Promise.all([listProperties(user.id), listBppAccounts(user.id), listProtests(user.id)])
      .then(([props, bpp, protests]) => {
        setProperties(props);
        setBppAccounts(bpp);
        setSavings(computePortfolioSavings(protests, props, bpp));
      })
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : "Could not load your savings history."),
      )
      .finally(() => setLoading(false));
  }, [user]);

  const chartData = savings?.byYear.map((y) => ({ name: String(y.year), value: y.savings })) ?? [];

  return (
    <div>
      <PageHero
        icon={HeroSavingsIcon}
        title="Lifetime Savings"
        tone="emerald"
        subtitle="What you actually saved. Each resolved case compares the original value with the final one, at your county's real tax rate. Nothing here is estimated."
      />

      {loading ? (
        <div className="mt-6 grid gap-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : !savings || savings.resolvedCaseCount === 0 ? (
        <div className="card-elev mt-6 p-8 text-center">
          <h3 className="font-serif text-xl font-semibold">No resolved cases yet.</h3>
          <p className="text-muted-foreground mt-1">
            Once a protest is resolved — an ARB decision, or an accepted settlement — its real
            savings will show up here.
          </p>
          <Link
            to="/dashboard/properties"
            className="btn-primary btn-primary-hover mt-4 inline-block"
          >
            View Properties
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid gap-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="card-elev p-6">
              <div className="text-muted-foreground text-xs uppercase tracking-wide">
                Lifetime savings
              </div>
              <div className="mt-1 font-serif text-3xl font-black">
                {currency(savings.lifetimeSavings)}
              </div>
              <div className="text-muted-foreground text-xs">
                across {savings.resolvedCaseCount} resolved case
                {savings.resolvedCaseCount === 1 ? "" : "s"}
              </div>
            </div>
            <div className="card-elev p-6">
              <div className="text-muted-foreground text-xs uppercase tracking-wide">
                Average per case
              </div>
              <div className="mt-1 font-serif text-3xl font-black">
                {currency(Math.round(savings.lifetimeSavings / savings.resolvedCaseCount))}
              </div>
              <div className="text-muted-foreground text-xs">real estate and BPP combined</div>
            </div>
          </div>

          {chartData.length > 1 && (
            <div className="card-elev p-4">
              <div className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-wide">
                Savings by tax year
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                  <defs>
                    <linearGradient id="savings-bar" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" />
                      <stop offset="100%" stopColor="#0ea5e9" />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    width={64}
                    tickFormatter={(v) => `$${Math.round(v / 1000)}K`}
                  />
                  <Tooltip formatter={(v: number) => currency(v)} />
                  <Bar
                    dataKey="value"
                    fill="url(#savings-bar)"
                    radius={[8, 8, 0, 0]}
                    animationDuration={1000}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="card-elev overflow-x-auto p-4">
            <div className="text-muted-foreground mb-3 text-xs font-semibold uppercase tracking-wide">
              Resolved cases
            </div>
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-border text-muted-foreground border-b text-left text-xs">
                  <th className="pb-2 font-medium">Property / Business</th>
                  <th className="pb-2 font-medium">Tax Year</th>
                  <th className="pb-2 font-medium">Original Value</th>
                  <th className="pb-2 font-medium">Final Value</th>
                  <th className="pb-2 font-medium">Savings</th>
                </tr>
              </thead>
              <tbody>
                {savings.entries.map((e) => (
                  <tr key={e.protestId} className="border-border/60 border-t">
                    <td className="py-2">
                      <Link
                        to={
                          e.subjectKind === "property"
                            ? "/dashboard/case"
                            : "/dashboard/bpp-accounts"
                        }
                        search={
                          e.subjectKind === "property" ? { propertyId: e.subjectId } : undefined
                        }
                        className="hover:underline"
                      >
                        {e.subjectLabel}
                      </Link>
                      <span className="text-muted-foreground ml-1.5 text-xs">
                        {e.subjectKind === "bpp" ? "(BPP)" : ""}
                      </span>
                    </td>
                    <td className="py-2">{e.taxYear ?? "—"}</td>
                    <td className="py-2">{currency(e.originalValue)}</td>
                    <td className="py-2">{currency(e.finalValue)}</td>
                    <td className="text-success py-2 font-medium">{currency(e.actualSavings)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {properties.length + bppAccounts.length > 0 && (
            <p className="text-muted-foreground text-xs">
              Only resolved cases count toward this total — a case still open to appeal or
              arbitration isn't counted until its final value is actually settled.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
