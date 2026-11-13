import { confirmDialog } from "@/components/ConfirmHost";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Briefcase as HeroBppIcon,
  CalendarClock,
  ClipboardList,
  Eye,
  FileDown,
  FilePen,
  Receipt,
  Send,
  MoreHorizontal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth";
import {
  bppNeedsProtest,
  deleteBppAccount,
  linkBppProperty,
  listBppAccounts,
  setBppAutoRefile,
  signedRenditionUrl,
  updateBppAccount,
  type BppAccountRecord,
} from "@/lib/bpp-accounts";
import {
  RENDITION_STATUS_LABEL,
  SUBMISSION_METHOD_LABEL,
  TX_COUNTIES,
  cadForCounty,
  countyOf,
  daysUntil,
  effectiveRenditionDeadline,
  renditionFieldValues,
  renditionStatus,
  type BppRenditionStatus,
} from "@/lib/bpp-rendition";
import {
  bppMonthlyPrice,
  bracketForBppValue,
  cancelBppSubscription,
  getMyBilling,
  resumeBppSubscription,
  startBppCheckout,
  TIER_LABEL,
  type BillingInfo,
  type Tier,
} from "@/lib/billing";
import { stripeConfigured } from "@/lib/stripe";
import { listProtests, type ProtestRecord } from "@/lib/protests";
import { listProperties, type PropertyRecord } from "@/lib/properties";
import {
  PAY_STATUS_LABEL,
  buildBppTaxRow,
  listCountyTaxSettings,
  type BppTaxRow,
  type CountyTaxSettings,
  type PayStatus,
} from "@/lib/pay-taxes";
import { BPP_RENDITION_SCHEMA, buildPdf, downloadPdf } from "@/lib/protest-documents";
import { getErrorMessage } from "@/lib/error-message";
import { currency } from "@/lib/intake-store";
import { isPaidStatus } from "@/lib/subscription-status";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHero, heroButton } from "@/components/PageHero";
import { BppRenditionEditor } from "@/components/BppRenditionEditor";
import { BppProtestFlow } from "@/components/BppProtestFlow";
import { BppSubmitDialog } from "@/components/BppSubmitDialog";
import { BppTaxInfoDialog } from "@/components/BppTaxInfoDialog";
import { AddBppDialog } from "@/components/AddBppDialog";
import { WorkflowPopup } from "@/components/case/workflow-ui";

export const Route = createFileRoute("/dashboard/_layout/bpp-accounts")({
  component: PersonalPropertyPage,
});

const fmtDate = (iso: string | null | undefined) =>
  iso
    ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";
const money = (n: number | null | undefined) => (n == null ? "—" : currency(n));

const RENDITION_TONE: Record<BppRenditionStatus, string> = {
  not_started: "bg-secondary text-muted-foreground",
  in_progress: "bg-amber-100 text-amber-900",
  ready_to_sign: "bg-sky-100 text-sky-800",
  signed: "bg-violet-100 text-violet-800",
  submitted: "bg-success/15 text-success",
};
const PAY_TONE: Record<PayStatus, string> = {
  unpaid: "bg-secondary text-foreground",
  initiated: "bg-sky-100 text-sky-800",
  partial: "bg-amber-100 text-amber-900",
  paid: "bg-success/15 text-success",
  overdue: "bg-destructive/15 text-destructive",
  verifying: "bg-violet-100 text-violet-800",
};

type Popup =
  | { kind: "details" | "rendition" | "submit" | "instructions" | "tax" | "protest"; id: string }
  | { kind: "add" }
  | null;

// Personal Property: every business personal property (BPP) account — the
// furniture, fixtures, equipment and inventory a business renders each year
// on Form 50-144 — with its rendition, submission and tax bill. Separate from
// the real estate (public.properties), though each can be linked to the
// property it operates at.
function PersonalPropertyPage() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<BppAccountRecord[]>([]);
  const [protests, setProtests] = useState<ProtestRecord[]>([]);
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [settings, setSettings] = useState<CountyTaxSettings[]>([]);
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [popup, setPopup] = useState<Popup>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      listBppAccounts(user.id),
      listProtests(user.id).catch(() => [] as ProtestRecord[]),
      listProperties(user.id).catch(() => [] as PropertyRecord[]),
      listCountyTaxSettings().catch(() => [] as CountyTaxSettings[]),
      getMyBilling(user.id).catch(() => null),
    ])
      .then(([acc, pr, props, s, b]) => {
        setAccounts(acc);
        setProtests(pr);
        setProperties(props);
        setSettings(s);
        setBilling(b);
      })
      .catch((err) =>
        toast.error(getErrorMessage(err, "Could not load your personal property accounts.")),
      )
      .finally(() => setLoading(false));
  }, [user]);

  const today = new Date().toISOString().slice(0, 10);
  const taxRows = useMemo(
    () =>
      new Map(
        accounts.map((a) => [a.id, buildBppTaxRow({ account: a, settings, todayIso: today })]),
      ),
    [accounts, settings, today],
  );
  const update = (a: BppAccountRecord) =>
    setAccounts((prev) => prev.map((x) => (x.id === a.id ? a : x)));
  const current = popup && "id" in popup ? (accounts.find((a) => a.id === popup.id) ?? null) : null;
  const propertyOf = (a: BppAccountRecord | null) =>
    a?.propertyId ? (properties.find((p) => p.id === a.propertyId) ?? null) : null;

  async function downloadRendition(a: BppAccountRecord) {
    setDownloading(a.id);
    try {
      if (a.renditionDocumentPath) {
        window.open(await signedRenditionUrl(a.renditionDocumentPath), "_blank", "noopener");
      } else {
        const bytes = await buildPdf(
          "forms/50-144.pdf",
          BPP_RENDITION_SCHEMA,
          renditionFieldValues(a),
        );
        downloadPdf(bytes, `Form-50-144-${a.businessName || "BPP"}.pdf`);
      }
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not download the rendition."));
    } finally {
      setDownloading(null);
    }
  }

  // summary
  const pending = accounts.filter((a) => !a.renditionFiledAt);
  const nextDeadline = pending.map((a) => effectiveRenditionDeadline(a).date).sort()[0] ?? null;
  const outstanding = [...taxRows.values()].reduce(
    (s, r) => s + (r.status !== "paid" && !r.totalTaxIsEstimate ? (r.outstanding ?? 0) : 0),
    0,
  );

  return (
    <div>
      <PageHero
        icon={HeroBppIcon}
        title="Personal Property"
        tone="sky"
        subtitle="Business personal property (BPP) — furniture, fixtures, equipment and inventory — rendered each year on Form 50-144 and taxed separately from the real estate."
      >
        <button onClick={() => setPopup({ kind: "add" })} className={heroButton}>
          Add Business Personal Property
        </button>
      </PageHero>

      {loading ? (
        <div className="card-elev mt-6 grid gap-3 p-5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <EmptyState onAdd={() => setPopup({ kind: "add" })} />
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="BPP accounts" value={String(accounts.length)} />
            <Tile
              label="Renditions submitted"
              value={`${accounts.length - pending.length} of ${accounts.length}`}
            />
            <Tile
              label="Next rendition deadline"
              value={nextDeadline ? fmtDate(nextDeadline) : "All submitted"}
              hint={nextDeadline ? `${daysUntil(nextDeadline)} days` : undefined}
            />
            <Tile
              label="BPP tax outstanding"
              value={money(outstanding)}
              hint="from bills you've added"
            />
          </div>

          <div className="card-elev mt-4 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">Business Name</th>
                  <th className="px-3 py-2.5 font-semibold">Property Address</th>
                  <th className="px-3 py-2.5 font-semibold">County</th>
                  <th className="px-3 py-2.5 font-semibold">CAD Account Number</th>
                  <th className="px-3 py-2.5 font-semibold">Tax Year</th>
                  <th className="px-3 py-2.5 font-semibold">Rendition Status</th>
                  <th className="px-3 py-2.5 font-semibold">Tax Payment Status</th>
                  <th className="px-3 py-2.5 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const rs = renditionStatus(a);
                  const tr = taxRows.get(a.id)!;
                  const dl = effectiveRenditionDeadline(a);
                  const days = daysUntil(dl.date);
                  return (
                    <tr key={a.id} className="border-t border-border/60 align-top">
                      <td className="max-w-[14rem] px-3 py-3 font-medium">
                        <span className="line-clamp-2">{a.businessName}</span>
                        {a.propertyId && (
                          <span className="block text-[11px] font-normal text-muted-foreground">
                            Linked to a property
                          </span>
                        )}
                      </td>
                      <td className="max-w-[14rem] px-3 py-3">
                        <span className="line-clamp-2">{a.locationAddress ?? "—"}</span>
                      </td>
                      <td className="px-3 py-3">{countyOf(a.cad) || "—"}</td>
                      <td className="px-3 py-3">
                        {a.accountNumber ?? <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-3">{a.taxYear ?? "—"}</td>
                      <td className="px-3 py-3">
                        <span
                          className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${RENDITION_TONE[rs]}`}
                        >
                          {RENDITION_STATUS_LABEL[rs]}
                        </span>
                        {rs !== "submitted" && (
                          <span
                            className={`mt-1 block whitespace-nowrap text-[11px] ${days < 0 ? "text-destructive" : days <= 30 ? "text-warning-foreground" : "text-muted-foreground"}`}
                          >
                            Due {fmtDate(dl.date)}
                            {dl.basis === "extension" ? " (extended)" : ""}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${PAY_TONE[tr.status]}`}
                        >
                          {a.taxAmountDue == null && !a.paidAt
                            ? "No bill yet"
                            : PAY_STATUS_LABEL[tr.status]}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        {/* One clear next step per row; every action in the ⋯ menu. */}
                        <RowActions
                          account={a}
                          paid={tr.status === "paid"}
                          downloading={downloading === a.id}
                          onOpen={(kind) => setPopup({ kind, id: a.id })}
                          onDownload={() => void downloadRendition(a)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Phones: one card per account instead of a wide table. */}
          <div className="mt-4 grid gap-3 md:hidden">
            {accounts.map((a) => {
              const rs = renditionStatus(a);
              const tr = taxRows.get(a.id)!;
              const dl = effectiveRenditionDeadline(a);
              return (
                <div key={a.id} className="card-elev grid gap-3 p-4 text-sm">
                  <div>
                    <div className="font-semibold">{a.businessName}</div>
                    <div className="text-xs text-muted-foreground">
                      {[
                        a.locationAddress,
                        countyOf(a.cad),
                        a.accountNumber ? `Acct ${a.accountNumber}` : null,
                        a.taxYear,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`rounded-full px-2 py-0.5 font-semibold ${RENDITION_TONE[rs]}`}
                    >
                      {RENDITION_STATUS_LABEL[rs]}
                    </span>
                    {rs !== "submitted" && (
                      <span className="text-muted-foreground">Due {fmtDate(dl.date)}</span>
                    )}
                    <span
                      className={`rounded-full px-2 py-0.5 font-semibold ${PAY_TONE[tr.status]}`}
                    >
                      {a.taxAmountDue == null && !a.paidAt
                        ? "No bill yet"
                        : PAY_STATUS_LABEL[tr.status]}
                    </span>
                  </div>
                  <RowActions
                    account={a}
                    paid={tr.status === "paid"}
                    downloading={downloading === a.id}
                    onOpen={(kind) => setPopup({ kind, id: a.id })}
                    onDownload={() => void downloadRendition(a)}
                  />
                </div>
              );
            })}
          </div>
          <DeadlineInfo compact />
        </>
      )}

      {popup?.kind === "add" && user && (
        <AddBppDialog
          userId={user.id}
          existing={accounts}
          properties={properties}
          onClose={() => setPopup(null)}
          onAdded={(created) => setAccounts((prev) => [...created, ...prev])}
        />
      )}
      {current && popup?.kind === "rendition" && (
        <BppRenditionEditor
          account={current}
          property={propertyOf(current)}
          userEmail={user?.email}
          open
          onClose={() => setPopup(null)}
          onUpdate={update}
          onSubmit={() => setPopup({ kind: "submit", id: current.id })}
        />
      )}
      {current && (popup?.kind === "submit" || popup?.kind === "instructions") && (
        <BppSubmitDialog
          account={current}
          instructionsOnly={popup.kind === "instructions"}
          onClose={() => setPopup(null)}
          onUpdate={update}
        />
      )}
      {current && popup?.kind === "tax" && (
        <BppTaxInfoDialog
          row={taxRows.get(current.id) as BppTaxRow}
          onClose={() => setPopup(null)}
          onUpdate={update}
        />
      )}
      {current && popup?.kind === "details" && user && (
        <DetailsDialog
          account={current}
          properties={properties}
          protest={protests.find((p) => p.bppAccountId === current.id) ?? null}
          billing={billing}
          onClose={() => setPopup(null)}
          onUpdate={update}
          onDeleted={() => {
            setAccounts((prev) => prev.filter((x) => x.id !== current.id));
            setPopup(null);
          }}
          onOpen={(kind) => setPopup({ kind, id: current.id })}
        />
      )}
      {current && popup?.kind === "protest" && user && (
        <BppProtestFlow
          userId={user.id}
          account={current}
          userEmail={user.email}
          open
          isPaid={billing?.plan === "beta" || isPaidStatus(current.subscriptionStatus)}
          onOpenChange={(o) => !o && setPopup(null)}
          onDone={(protest) => setProtests((prev) => [protest, ...prev])}
        />
      )}
    </div>
  );
}

function RowActions({
  account: a,
  paid,
  downloading,
  onOpen,
  onDownload,
}: {
  account: BppAccountRecord;
  paid: boolean;
  downloading: boolean;
  onOpen: (kind: "details" | "rendition" | "submit" | "instructions" | "tax") => void;
  onDownload: () => void;
}) {
  const next: {
    label: string;
    icon: typeof Eye;
    kind: "details" | "rendition" | "submit" | "tax";
  } =
    !a.renditionSignedAt && !a.renditionFiledAt
      ? { label: "Fill Rendition", icon: FilePen, kind: "rendition" }
      : a.renditionSignedAt && !a.renditionFiledAt
        ? { label: "Submit Rendition", icon: Send, kind: "submit" }
        : !paid
          ? { label: "Tax Information", icon: Receipt, kind: "tax" }
          : { label: "View Details", icon: Eye, kind: "details" };
  const NextIcon = next.icon;
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => onOpen(next.kind)}
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors hover:border-accent/40 hover:text-accent"
      >
        <NextIcon className="h-3.5 w-3.5 text-accent" /> {next.label}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`More actions for ${a.businessName}`}
          className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem onSelect={() => onOpen("details")}>
            <Eye className="h-4 w-4" /> View Details
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onOpen("rendition")}>
            <FilePen className="h-4 w-4" /> Fill Rendition
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onDownload}>
            <FileDown className="h-4 w-4" /> {downloading ? "Preparing…" : "Download Rendition"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => onOpen(a.renditionSignedAt ? "submit" : "instructions")}
          >
            {a.renditionSignedAt && !a.renditionFiledAt ? (
              <>
                <Send className="h-4 w-4" /> Submit Rendition
              </>
            ) : (
              <>
                <ClipboardList className="h-4 w-4" /> View Submission Instructions
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onOpen("tax")}>
            <Receipt className="h-4 w-4" /> View Tax Information
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ActionBtn({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Eye;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border px-2 py-1 text-xs hover:bg-secondary"
    >
      <Icon className="h-3.5 w-3.5 text-accent" /> {label}
    </button>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card-elev p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

// The typical Texas BPP calendar and what to prepare — counties vary.
function DeadlineInfo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`card-elev mt-6 grid gap-3 p-5 text-sm ${compact ? "" : "sm:grid-cols-2"}`}>
      <div>
        <h3 className="flex items-center gap-2 font-semibold">
          <CalendarClock className="h-4 w-4 text-accent" /> When renditions are due
        </h3>
        <ul className="mt-2 grid gap-1 text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">April 15</span> — the usual Texas deadline
            to file Form 50-144 for property owned on January 1.
          </li>
          <li>
            <span className="font-medium text-foreground">May 15</span> — if you ask the appraisal
            district in writing by April 15, it must extend to this date; it may grant 15 more days
            for good cause.
          </li>
          <li>Late or missing renditions can carry a 10% penalty on the tax.</li>
          <li>Tax bills usually go out in October and are due by January 31.</li>
        </ul>
      </div>
      {!compact && (
        <div>
          <h3 className="flex items-center gap-2 font-semibold">
            <ClipboardList className="h-4 w-4 text-accent" /> What to prepare
          </h3>
          <ul className="mt-2 list-disc grid gap-1 pl-5 text-muted-foreground">
            <li>Business name, location address and the county it&apos;s in</li>
            <li>
              The appraisal district&apos;s BPP account number, if you have one (last year&apos;s
              rendition or notice)
            </li>
            <li>
              A fixed asset list or depreciation schedule — description, year acquired, original
              cost
            </li>
            <li>Inventory on hand on January 1</li>
            <li>Leased or consigned equipment, and any exemptions (e.g. freeport goods)</li>
          </ul>
        </div>
      )}
      <p className={`text-xs text-muted-foreground ${compact ? "" : "sm:col-span-2"}`}>
        Deadlines, forms and submission methods vary by county — each account shows its own
        appraisal district&apos;s instructions, researched from official sources.
      </p>
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <>
      <div className="card-elev mt-6 p-8 text-center">
        <h3 className="font-serif text-xl font-semibold">No business personal property yet</h3>
        <p className="mt-1 text-muted-foreground">
          Add a business from your properties, a document, a CSV, Podio, or by hand — then fill in
          and track its rendition.
        </p>
        <button onClick={onAdd} className="btn-accent mt-4">
          Add Business Personal Property
        </button>
      </div>
      <DeadlineInfo />
    </>
  );
}

const field = "mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm";

function DetailsDialog({
  account: a,
  properties,
  protest,
  billing,
  onClose,
  onUpdate,
  onDeleted,
  onOpen,
}: {
  account: BppAccountRecord;
  properties: PropertyRecord[];
  protest: ProtestRecord | null;
  billing: BillingInfo | null;
  onClose: () => void;
  onUpdate: (a: BppAccountRecord) => void;
  onDeleted: () => void;
  onOpen: (kind: "rendition" | "submit" | "instructions" | "tax" | "protest") => void;
}) {
  const [form, setForm] = useState({
    businessName: a.businessName,
    locationAddress: a.locationAddress ?? "",
    county: countyOf(a.cad),
    accountNumber: a.accountNumber ?? "",
    taxYear: a.taxYear ? String(a.taxYear) : "",
    propertyId: a.propertyId ?? "",
  });
  const [busy, setBusy] = useState(false);
  const isBeta = billing?.plan === "beta";
  const subscribed = isPaidStatus(a.subscriptionStatus);
  const paid = isBeta || subscribed;
  const bracket = bracketForBppValue(a.renderedValue);
  const dl = effectiveRenditionDeadline(a);
  const dirty =
    form.businessName !== a.businessName ||
    form.locationAddress !== (a.locationAddress ?? "") ||
    form.county !== countyOf(a.cad) ||
    form.accountNumber !== (a.accountNumber ?? "") ||
    form.taxYear !== (a.taxYear ? String(a.taxYear) : "") ||
    form.propertyId !== (a.propertyId ?? "");

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (err) {
      toast.error(getErrorMessage(err, "Something went wrong."));
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      if (!form.businessName.trim()) throw new Error("Business name is required.");
      let u = await updateBppAccount(a.id, {
        businessName: form.businessName.trim(),
        locationAddress: form.locationAddress.trim(),
        cad: form.county ? cadForCounty(form.county) : undefined,
        accountNumber: form.accountNumber.trim(),
        taxYear: Number(form.taxYear) || undefined,
      });
      if (form.propertyId !== (a.propertyId ?? ""))
        u = await linkBppProperty(a.id, form.propertyId || null);
      onUpdate(u);
    }, "Saved.");

  return (
    <WorkflowPopup
      open
      onClose={onClose}
      wide
      title={a.businessName}
      description={`Business personal property · added ${fmtDate(a.createdAt)}${a.source ? ` (${a.source})` : ""}`}
    >
      <div className="grid gap-4 text-sm">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs">
            Business Name
            <input
              className={field}
              value={form.businessName}
              onChange={(e) => setForm({ ...form, businessName: e.target.value })}
            />
          </label>
          <label className="text-xs">
            Property / Business Address
            <input
              className={field}
              value={form.locationAddress}
              onChange={(e) => setForm({ ...form, locationAddress: e.target.value })}
            />
          </label>
          <label className="text-xs">
            County
            <select
              className={field}
              value={form.county}
              onChange={(e) => setForm({ ...form, county: e.target.value })}
            >
              <option value="">Select…</option>
              {TX_COUNTIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            CAD Account Number
            <input
              className={field}
              value={form.accountNumber}
              onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
            />
          </label>
          <label className="text-xs">
            Tax Year
            <input
              className={field}
              inputMode="numeric"
              value={form.taxYear}
              onChange={(e) => setForm({ ...form, taxYear: e.target.value.replace(/\D/g, "") })}
            />
          </label>
          <label className="text-xs">
            Linked CorvusPT property
            <select
              className={field}
              value={form.propertyId}
              onChange={(e) => setForm({ ...form, propertyId: e.target.value })}
            >
              <option value="">— none —</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.address}
                </option>
              ))}
            </select>
          </label>
        </div>
        {dirty && (
          <button
            onClick={() => void save()}
            disabled={busy}
            className="btn-accent w-fit py-1 text-xs disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save Changes"}
          </button>
        )}

        <dl className="grid grid-cols-2 gap-3 rounded-md bg-secondary/40 p-3 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Rendition</dt>
            <dd className="font-medium">{RENDITION_STATUS_LABEL[renditionStatus(a)]}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Rendition deadline</dt>
            <dd className="font-medium">
              {fmtDate(dl.date)}
              {dl.basis === "extension"
                ? " (extended)"
                : a.extensionRequestedAt
                  ? " (extension requested)"
                  : ""}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Submitted</dt>
            <dd className="font-medium">
              {a.renditionFiledAt
                ? `${fmtDate(a.renditionFiledAt)}${a.renditionSubmissionMethod ? ` · ${SUBMISSION_METHOD_LABEL[a.renditionSubmissionMethod] ?? a.renditionSubmissionMethod}` : ""}`
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Rendered value</dt>
            <dd className="font-medium">{money(a.renderedValue)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">County&apos;s notice value</dt>
            <dd className="font-medium">{money(a.noticeValue)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Protest deadline</dt>
            <dd className="font-medium">{fmtDate(a.protestDeadline)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">BPP tax due</dt>
            <dd className="font-medium">{money(a.taxAmountDue)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Paid</dt>
            <dd className="font-medium">{a.paidAt ? fmtDate(a.paidAt) : "—"}</dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-2">
          <button onClick={() => onOpen("rendition")} className="btn-outline py-1 text-xs">
            Fill Rendition
          </button>
          <button
            onClick={() => onOpen(a.renditionSignedAt ? "submit" : "instructions")}
            className="btn-outline py-1 text-xs"
          >
            {a.renditionSignedAt ? "Submit / Submission Record" : "Submission Instructions"}
          </button>
          <button onClick={() => onOpen("tax")} className="btn-outline py-1 text-xs">
            Tax Information
          </button>
          {protest ? (
            <span className="badge-soft self-center">Protest requested</span>
          ) : (
            bppNeedsProtest(a) && (
              <button
                disabled={!paid}
                title={paid ? undefined : "Subscribe to this BPP account to file a protest."}
                onClick={() => onOpen("protest")}
                className="btn-accent py-1 text-xs disabled:opacity-50"
              >
                File Protest
              </button>
            )
          )}
        </div>

        {!isBeta && (
          <div className="grid gap-2 border-t border-border pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Subscription ·{" "}
              {subscribed ? (a.cancelAtPeriodEnd ? "Canceling" : "Active") : "Not subscribed"}
            </p>
            <div className="flex flex-wrap gap-2">
              {!subscribed &&
                stripeConfigured &&
                (["owner_managed", "corvusrf_managed"] as Tier[]).map((t) => (
                  <button
                    key={t}
                    disabled={busy}
                    onClick={() => void run(() => startBppCheckout(a.id, t, { newTab: true }))}
                    className="btn-outline py-1 text-xs disabled:opacity-60"
                  >
                    Subscribe — {TIER_LABEL[t]} (${bppMonthlyPrice(t, bracket)}/mo)
                  </button>
                ))}
              {subscribed &&
                (a.cancelAtPeriodEnd ? (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await resumeBppSubscription(a.id);
                        onUpdate({ ...a, cancelAtPeriodEnd: false, cancelAt: null });
                      }, "Subscription resumed.")
                    }
                    className="btn-outline py-1 text-xs"
                  >
                    Resume Subscription
                  </button>
                ) : (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void (async () => {
                        if (
                          !(await confirmDialog(
                            `Cancel the subscription for ${a.businessName}? It ends immediately.`,
                          ))
                        )
                          return;
                        await run(async () => {
                          await cancelBppSubscription(a.id);
                          onUpdate({
                            ...a,
                            subscriptionStatus: "canceled",
                            cancelAtPeriodEnd: false,
                            cancelAt: null,
                          });
                        }, "Subscription canceled.");
                      })()
                    }
                    className="btn-outline py-1 text-xs text-warning-foreground"
                  >
                    Cancel Subscription
                  </button>
                ))}
            </div>
          </div>
        )}

        {protest?.status === "resolved" && (
          <label
            aria-label="Auto re-file next year"
            className="flex items-start gap-2 rounded-md border border-border p-3"
          >
            <input
              type="checkbox"
              className="mt-0.5"
              checked={!!a.autoRefile}
              disabled={busy}
              onChange={(e) =>
                void run(async () => onUpdate(await setBppAutoRefile(a.id, e.target.checked)))
              }
            />
            <span>
              <span className="font-medium">Auto re-file next year</span>
              <span className="block text-xs text-muted-foreground">
                CorvusPT starts next year&apos;s protest once a new notice value disagrees with what
                was rendered — you still sign it. Off by default.
              </span>
            </span>
          </label>
        )}

        <div className="flex justify-end border-t border-border pt-3">
          <button
            disabled={busy || subscribed}
            title={subscribed ? "This account has a subscription — cancel it first" : undefined}
            onClick={() =>
              void (async () => {
                if (
                  !(await confirmDialog(
                    `Remove ${a.businessName} from your personal property accounts?`,
                  ))
                )
                  return;
                await run(async () => {
                  await deleteBppAccount(a.id);
                  onDeleted();
                }, "Removed.");
              })()
            }
            className="text-xs font-medium text-destructive hover:underline disabled:opacity-50"
          >
            Remove account
          </button>
        </div>
      </div>
    </WorkflowPopup>
  );
}
