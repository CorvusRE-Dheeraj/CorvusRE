import type { ReactNode } from "react";
import { AlertTriangle, ExternalLink, Landmark, MapPin, RefreshCw } from "lucide-react";
import { researchDate, type CountyResearch, type ResearchItem } from "@/lib/county-research";

// What the centralized county research engine found for one county + topic
// (lib/county-research.ts), shown the same way in every module: statewide
// rules apart from county procedures, forms, fees, deadlines, how to submit,
// contacts, what needs verifying and what wasn't found — each with its
// official source and the date it was read.

function Src({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="ml-1 inline-flex items-center text-accent hover:underline"
      title={url}
    >
      <ExternalLink className="h-3 w-3" aria-label="Source" />
    </a>
  );
}

function Block({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}

function Items({ items }: { items: ResearchItem[] }) {
  return (
    <ul className="grid gap-1">
      {items.map((i, n) => (
        <li key={n} className="leading-snug">
          • {i.text}
          <Src url={i.sourceUrl} />
        </li>
      ))}
    </ul>
  );
}

const METHOD_LABEL: Record<string, string> = {
  online: "Online",
  email: "Email",
  mail: "Mail",
  in_person: "In person",
  other: "Other",
};

export function CountyResearchPanel({
  research,
  loading,
  onRefresh,
  empty = "The official sources couldn't be read just now — try again later, or check the links below.",
}: {
  research: CountyResearch | null;
  loading: boolean;
  onRefresh?: () => void;
  empty?: string;
}) {
  if (loading && !research)
    return (
      <p className="text-sm text-muted-foreground">
        Corvus AI is reading the official county and state sources…
      </p>
    );
  if (!research) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const r = research;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
        <span>
          Researched by Corvus AI from official sources for {r.county} County · retrieved{" "}
          {researchDate(r)}. Not legal advice — confirm before you rely on it.
        </span>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1 font-medium text-accent hover:underline disabled:opacity-60"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} aria-hidden />
            {loading ? "Checking…" : "Check sources again"}
          </button>
        )}
      </div>

      {r.statewide.length > 0 && (
        <Block
          title={
            <span className="inline-flex items-center gap-1">
              <Landmark className="h-3.5 w-3.5" aria-hidden /> Statewide rules (statute /
              Comptroller)
            </span>
          }
        >
          <Items items={r.statewide} />
        </Block>
      )}
      {r.countySpecific.length > 0 && (
        <Block
          title={
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" aria-hidden /> {r.county} County procedures
            </span>
          }
        >
          <Items items={r.countySpecific} />
        </Block>
      )}
      {r.deadlines.length > 0 && (
        <Block title="Deadlines">
          <ul className="grid gap-1">
            {r.deadlines.map((d, i) => (
              <li key={i}>
                <span className="font-medium">{d.event}:</span> {d.rule}
                <Src url={d.sourceUrl} />
              </li>
            ))}
          </ul>
        </Block>
      )}
      {r.fees.length > 0 && (
        <Block title="Fees">
          <ul className="grid gap-1">
            {r.fees.map((f, i) => (
              <li key={i}>
                {f.item}: <span className="font-medium">{f.amount}</span>
                <Src url={f.sourceUrl} />
              </li>
            ))}
          </ul>
        </Block>
      )}
      {r.submission.length > 0 && (
        <Block title="How to submit">
          <ul className="grid gap-1.5">
            {r.submission.map((s, i) => (
              <li key={i}>
                <span className="font-medium">{METHOD_LABEL[s.method] ?? s.method}:</span>{" "}
                {s.detail}
                {s.address && <span className="block text-muted-foreground">{s.address}</span>}
                {s.email && (
                  <a href={`mailto:${s.email}`} className="ml-1 text-accent hover:underline">
                    {s.email}
                  </a>
                )}
                {s.url && (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-1 text-accent hover:underline"
                  >
                    Open →
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Block>
      )}
      {r.forms.length > 0 && (
        <Block title="Official forms">
          <ul className="grid gap-1">
            {r.forms.map((f, i) => (
              <li key={i}>
                <a
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  {f.name}
                </a>
              </li>
            ))}
          </ul>
        </Block>
      )}
      {r.contacts.length > 0 && (
        <Block title="Contacts">
          <ul className="grid gap-1">
            {r.contacts.map((c, i) => (
              <li key={i}>
                {c.name}
                {c.phone && <span className="text-muted-foreground"> · {c.phone}</span>}
                {c.email && (
                  <a href={`mailto:${c.email}`} className="ml-1 text-accent hover:underline">
                    {c.email}
                  </a>
                )}
                <Src url={c.url} />
              </li>
            ))}
          </ul>
        </Block>
      )}
      {(r.verify.length > 0 || r.unavailable.length > 0) && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
          <div className="flex items-center gap-1 font-semibold">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Needs verification
          </div>
          <ul className="mt-1 grid gap-0.5">
            {r.verify.map((v, i) => (
              <li key={`v${i}`}>• {v}</li>
            ))}
            {r.unavailable.map((v, i) => (
              <li key={`u${i}`} className="text-muted-foreground">
                • Not found on the official pages: {v}
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.sources.length > 0 && (
        <Block title="Sources read">
          <ul className="grid gap-0.5 text-xs">
            {r.sources.map((s) => (
              <li key={s.url}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  {s.label}
                </a>{" "}
                <span className="text-muted-foreground">
                  ({s.kind === "statewide" ? "statewide" : "county"})
                </span>
              </li>
            ))}
          </ul>
        </Block>
      )}
    </div>
  );
}
