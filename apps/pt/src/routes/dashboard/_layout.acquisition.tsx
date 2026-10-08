import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Calculator, Loader2, Search } from "lucide-react";
import { PageHero } from "@/components/PageHero";
import { cadLookup } from "@/lib/cad-lookup";
import {
  acquisitionForecast,
  DEFAULT_GROWTH_PCT,
  MAX_HOLD,
  type Scenario,
} from "@/lib/acquisition-forecast";

export const Route = createFileRoute("/dashboard/_layout/acquisition")({
  component: AcquisitionForecastPage,
});

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${usd(Math.abs(n))}`;
const num = (s: string) => {
  const n = Number(s.replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const SCENARIOS: { id: Scenario; label: string }[] = [
  { id: "low", label: "Low" },
  { id: "likely", label: "Likely" },
  { id: "high", label: "High" },
];

const nextQuarter = () => {
  const d = new Date();
  d.setMonth(d.getMonth() + 3, 1);
  return d.toISOString().slice(0, 10);
};

// Acquisition property-tax forecast (lib/acquisition-forecast.ts): the taxes
// a buyer is likely to pay after closing, for underwriting before the deal.
function AcquisitionForecastPage() {
  const [address, setAddress] = useState("");
  const [looking, setLooking] = useState(false);
  const [record, setRecord] = useState<{
    cad: string | null;
    propertyType: string | null;
    address: string;
  } | null>(null);
  const [currentValue, setCurrentValue] = useState("");
  const [taxYear, setTaxYear] = useState(String(new Date().getFullYear()));
  const [price, setPrice] = useState("");
  const [closing, setClosing] = useState(nextQuarter());
  const [hold, setHold] = useState("5");
  const [growth, setGrowth] = useState(String(DEFAULT_GROWTH_PCT));
  const [rate, setRate] = useState("");
  const [noi, setNoi] = useState("");

  async function lookUp() {
    if (!address.trim()) return;
    setLooking(true);
    try {
      const r = await cadLookup(address.trim());
      const rec = r.matched === true ? r.record : r.matched === "multiple" ? r.options[0] : null;
      if (!rec || rec.totalValue == null) {
        toast.error("No county record found for that address — enter the values below instead.");
        return;
      }
      setRecord({
        cad: rec.cad ?? null,
        propertyType: rec.propertyType ?? null,
        address: rec.propertyAddress,
      });
      setCurrentValue(String(rec.totalValue));
      if (rec.taxYear) setTaxYear(String(rec.taxYear));
      if (r.matched === "multiple")
        toast.info("That address has more than one county account — the first is shown.");
    } catch {
      toast.error("The county lookup didn't respond. Try again, or enter the values below.");
    } finally {
      setLooking(false);
    }
  }

  const forecast = useMemo(() => {
    const cv = num(currentValue);
    const pp = num(price);
    const ty = num(taxYear);
    if (!cv || !pp || !ty || !/^\d{4}-\d{2}-\d{2}$/.test(closing)) return null;
    const r = num(rate);
    return acquisitionForecast({
      cad: record?.cad ?? null,
      propertyType: record?.propertyType ?? null,
      currentValue: cv,
      currentTaxYear: ty,
      purchasePrice: pp,
      closingDate: closing,
      holdYears: num(hold) ?? 5,
      growthPct: num(growth) ?? DEFAULT_GROWTH_PCT,
      taxRate: r && r > 0 ? r / 100 : null,
      noi: num(noi),
    });
  }, [currentValue, price, taxYear, closing, hold, growth, rate, noi, record]);

  const field = "rounded-md border border-input bg-background px-3 py-2 text-sm";

  return (
    <div className="grid gap-6">
      <PageHero
        icon={Calculator}
        title="Acquisition Tax Forecast"
        tone="indigo"
        subtitle="Before you buy: what the property taxes are likely to be once the appraisal district reacts to the sale, over your hold."
      />

      <section className="card-elev grid gap-4 p-5">
        <div>
          <label htmlFor="acq-address" className="text-sm font-semibold">
            Property (optional)
          </label>
          <div className="mt-1 flex flex-wrap gap-2">
            <input
              id="acq-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void lookUp()}
              placeholder="Address of the property you're considering"
              className={`${field} min-w-0 flex-1 basis-64`}
            />
            <button
              type="button"
              onClick={lookUp}
              disabled={looking || !address.trim()}
              className="btn-outline inline-flex items-center gap-1.5 text-sm disabled:opacity-60"
            >
              {looking ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Search className="h-4 w-4" aria-hidden="true" />
              )}
              Look up the county value
            </button>
          </div>
          {record && (
            <p className="mt-1 text-xs text-muted-foreground">
              {record.address} · {record.cad ?? "County"}
              {record.propertyType ? ` · ${record.propertyType}` : ""}
            </p>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ["Current county value", currentValue, setCurrentValue, "$", "decimal"],
              ["Value's tax year", taxYear, setTaxYear, "2026", "numeric"],
              ["Purchase price", price, setPrice, "$", "decimal"],
              ["Closing date", closing, setClosing, "YYYY-MM-DD", "text"],
              ["Hold (years)", hold, setHold, `1-${MAX_HOLD}`, "numeric"],
              ["Market growth (% a year)", growth, setGrowth, "3", "decimal"],
              ["Tax rate (%, optional)", rate, setRate, "county average", "decimal"],
              ["Underwritten NOI (optional)", noi, setNoi, "$", "decimal"],
            ] as const
          ).map(([label, value, set, ph, mode]) => (
            <label key={label} className="grid gap-1 text-sm">
              <span className="text-muted-foreground">{label}</span>
              <input
                type={label === "Closing date" ? "date" : "text"}
                value={value}
                onChange={(e) => set(e.target.value)}
                placeholder={ph}
                inputMode={mode}
                className={field}
              />
            </label>
          ))}
        </div>
      </section>

      {forecast ? (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            <div className="card-elev p-4">
              <div className="text-xs text-muted-foreground">
                Likely taxes, {forecast.years[0].year} (first full year)
              </div>
              <div className="mt-1 font-serif text-2xl font-semibold">
                {usd(forecast.years[0].tax.likely)}
              </div>
              <div className="text-xs text-muted-foreground">
                Range {usd(forecast.years[0].tax.low)}–{usd(forecast.years[0].tax.high)}
              </div>
            </div>
            <div className="card-elev p-4">
              <div className="text-xs text-muted-foreground">vs the seller&apos;s current bill</div>
              <div
                className={`mt-1 font-serif text-2xl font-semibold ${forecast.firstYearChange.likely > 0 ? "text-destructive" : "text-success"}`}
              >
                {signed(forecast.firstYearChange.likely)}
              </div>
              <div className="text-xs text-muted-foreground">
                Seller&apos;s bill about {usd(forecast.sellerTax)} a year
                {forecast.noiImpact?.likelyPct != null
                  ? ` · NOI ${forecast.noiImpact.likelyPct > 0 ? "+" : ""}${forecast.noiImpact.likelyPct}%`
                  : ""}
              </div>
            </div>
            <div className="card-elev p-4">
              <div className="text-xs text-muted-foreground">
                Taxes over the {forecast.years.length}-year hold (likely)
              </div>
              <div className="mt-1 font-serif text-2xl font-semibold">
                {usd(forecast.holdTotal.likely)}
              </div>
              <div className="text-xs text-muted-foreground">
                Closing year {forecast.closingYear.year}: your share about{" "}
                {usd(forecast.closingYear.buyerShare)} ({forecast.closingYear.buyerDays} days)
              </div>
            </div>
          </section>

          {forecast.belowValue && (
            <p className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm">
              {forecast.belowValue.note}
            </p>
          )}

          <section className="card-elev overflow-x-auto p-4">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">Year</th>
                  {SCENARIOS.map((s) => (
                    <th key={s.id} className="py-1 pr-3 text-right">
                      {s.label}: value / taxes
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {forecast.years.map((y) => (
                  <tr key={y.year} className="border-t border-border">
                    <td className="py-1.5 pr-3 font-medium">{y.year}</td>
                    {SCENARIOS.map((s) => (
                      <td
                        key={s.id}
                        className={`py-1.5 pr-3 text-right ${s.id === "likely" ? "font-semibold" : "text-muted-foreground"}`}
                      >
                        {usd(y.value[s.id])} / {usd(y.tax[s.id])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="mt-3 grid gap-0.5 text-xs text-muted-foreground">
              {SCENARIOS.map((s) => (
                <li key={s.id}>
                  <span className="font-medium text-foreground">{s.label}:</span>{" "}
                  {forecast.scenarioBasis[s.id]}.
                </li>
              ))}
            </ul>
          </section>

          <section className="text-xs text-muted-foreground">
            <div className="font-semibold text-foreground">Assumptions</div>
            <ul className="mt-1 grid gap-0.5">
              <li>
                · Typical appraisal level: {forecast.ratioPct}% ({forecast.ratioSource}).
              </li>
              {forecast.assumptions.map((a) => (
                <li key={a}>· {a}</li>
              ))}
            </ul>
          </section>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Enter the county&apos;s current value, its tax year, the purchase price and the closing
          date to see the forecast.
        </p>
      )}
    </div>
  );
}
