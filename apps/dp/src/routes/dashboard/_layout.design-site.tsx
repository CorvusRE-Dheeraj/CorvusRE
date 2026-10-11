import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { designSiteAnalysis } from "@/lib/design-workspace";
import { availabilityLabel } from "@/lib/constraints";
import { scopeLabel } from "@/lib/design";
import { Section, Pill, Loading } from "@/components/dp-ui";
import {
  useActiveDesignRequest,
  EmptyDesign,
  designSubtitle,
  downloadText,
  fileSlug,
} from "@/components/design-workspace";

export const Route = createFileRoute("/dashboard/_layout/design-site")({
  head: () => ({ meta: [{ title: "Design Site Data — CorvusDP" }] }),
  component: DesignSite,
});

const AVAIL_TONE = {
  likely_available: "green",
  verify: "amber",
  likely_constrained: "red",
} as const;

function DesignSite() {
  const { loading, dr, brief } = useActiveDesignRequest();
  const site = useMemo(() => (dr ? designSiteAnalysis(dr) : null), [dr]);
  if (loading) return <Loading />;
  if (!dr || !brief || !site) return <EmptyDesign />;

  const c = site.constraints;
  const program: [string, string | null][] = [
    ["Location", dr.address ?? dr.city],
    ["County", dr.county],
    ["Project type", scopeLabel((dr.scope ?? undefined) as never)],
    ["Sector", dr.sector],
    ["Site area", dr.site_area],
    ["Building area", dr.building_area ? `${dr.building_area} sf` : null],
    ["Floors", dr.floors],
  ];

  function download() {
    downloadText(
      `design-site-data-${fileSlug(dr!)}.txt`,
      [
        `CorvusDP — Design Site Data`,
        `Generated ${new Date().toLocaleString()}`,
        ``,
        `PROJECT`,
        ...program.map(([k, v]) => `  ${k}: ${v ?? "—"}`),
        `  Jurisdiction: ${site!.jurisdiction.authority} (${site!.jurisdiction.level.toUpperCase()})`,
        ``,
        `REQUIREMENTS`,
        `  Rooms / spaces: ${dr!.rooms ?? "—"}`,
        `  Functional: ${dr!.functional_requirements ?? "—"}`,
        `  Special: ${dr!.special_requirements ?? "—"}`,
        ``,
        `UTILITIES`,
        ...c.utilities.map((u) => `  ${u.name}: ${availabilityLabel(u.status)} — ${u.note}`),
        ``,
        `CONSTRAINTS`,
        ...c.constraints.map((x) => `  [${x.severity}] ${x.title}: ${x.detail}`),
        ``,
        `CRITICAL WARNINGS`,
        ...(c.criticalWarnings.length ? c.criticalWarnings.map((w) => `  - ${w}`) : ["  (none)"]),
        ``,
        c.disclaimer,
      ].join("\n"),
    );
  }

  return (
    <div className="grid gap-5">
      <Section
        title="Site Data"
        subtitle={designSubtitle(dr)}
        right={
          <button className="btn-outline text-sm" onClick={download}>
            Download site data
          </button>
        }
      >
        <dl className="grid gap-3 sm:grid-cols-3">
          {program.map(([k, v]) => (
            <div key={k} className="rounded-lg border border-border p-3">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">{k}</dt>
              <dd className={`mt-1 text-sm font-medium ${k === "Sector" ? "capitalize" : ""}`}>
                {v || "—"}
              </dd>
            </div>
          ))}
          <div className="rounded-lg border border-border p-3">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Jurisdiction</dt>
            <dd className="mt-1 text-sm font-medium">
              {site.jurisdiction.authority}{" "}
              <span className="text-muted-foreground">
                ({site.jurisdiction.level.toUpperCase()})
              </span>
            </dd>
          </div>
        </dl>
      </Section>

      <Section title="Program & requirements" subtitle="What the design has to accommodate.">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ["Rooms / spaces", dr.rooms],
            ["Functional requirements", dr.functional_requirements],
            ["Special requirements", dr.special_requirements],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-border p-3 text-sm">
              <div className="font-medium">{k}</div>
              <p className="mt-1 whitespace-pre-line text-muted-foreground">
                {v || "Not provided"}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Utilities & site constraints"
        subtitle="What the site brings to the design — the same checks the permitting analysis runs for this location."
      >
        {c.criticalWarnings.length > 0 && (
          <div className="mb-4 rounded-lg border border-red-400/40 bg-red-400/10 p-3 text-sm">
            <div className="font-semibold">Critical warnings</div>
            <ul className="mt-1 grid gap-1">
              {c.criticalWarnings.map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="text-sm font-semibold">Utilities</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {c.utilities.map((u) => (
            <div key={u.name} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{u.name}</span>
                <Pill tone={AVAIL_TONE[u.status]}>{availabilityLabel(u.status)}</Pill>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{u.note}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 text-sm font-semibold">Property constraints</div>
        <ul className="mt-2 grid gap-2">
          {c.constraints.map((x) => (
            <li key={x.title} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex items-center gap-2">
                <Pill
                  tone={
                    x.severity === "critical" ? "red" : x.severity === "watch" ? "amber" : "gray"
                  }
                >
                  {x.severity}
                </Pill>
                <span className="font-medium">{x.title}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{x.detail}</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">{c.disclaimer}</p>
      </Section>
    </div>
  );
}
