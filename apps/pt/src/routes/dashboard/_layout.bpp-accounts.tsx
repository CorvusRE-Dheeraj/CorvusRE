import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  listBppAccounts,
  addBppAccount,
  deleteBppAccount,
  bppNeedsProtest,
  setBppAutoRefile,
  type BppAccountRecord,
} from "@/lib/bpp-accounts";
import {
  getMyBilling,
  startBppCheckout,
  cancelBppSubscription,
  resumeBppSubscription,
  bracketForBppValue,
  bppMonthlyPrice,
  TIER_LABEL,
  type BillingInfo,
  type Tier,
} from "@/lib/billing";
import { stripeConfigured } from "@/lib/stripe";
import { listProtests, type ProtestRecord } from "@/lib/protests";
import { Skeleton } from "@/components/ui/skeleton";
import { BppRenditionEditor } from "@/components/BppRenditionEditor";
import { BppProtestFlow } from "@/components/BppProtestFlow";
import { ComingSoonLock } from "@/components/ComingSoonLock";
import { PageHero, heroButton, heroButtonGhost } from "@/components/PageHero";
import { Briefcase as HeroBppIcon } from "lucide-react";

export const Route = createFileRoute("/dashboard/_layout/bpp-accounts")({
  component: BppAccounts,
});

// Still under active development — gray out (see AppShell.tsx's own
// `locked: true` for this tab) and block direct access too, not just the
// nav link, so there's no way to reach real BPP operations while this is
// true. Flip back to false (and AppShell's matching flag) once it's ready.
const LOCKED = true;

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function money(n: number | null): string {
  return n != null ? `$${n.toLocaleString("en-US")}` : "—";
}

function BppAccounts() {
  if (LOCKED) {
    return (
      <ComingSoonLock
        title="BPP Accounts"
        description="Track your Business Personal Property renditions, deadlines, and protests."
      />
    );
  }
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<BppAccountRecord[]>([]);
  const [protests, setProtests] = useState<ProtestRecord[]>([]);
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [businessName, setBusinessName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [cad, setCad] = useState("");
  const [locationAddress, setLocationAddress] = useState("");

  const [renditionAccount, setRenditionAccount] = useState<BppAccountRecord | null>(null);
  const [protestAccount, setProtestAccount] = useState<BppAccountRecord | null>(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([listBppAccounts(user.id), listProtests(user.id), getMyBilling(user.id)])
      .then(([acc, pr, b]) => {
        setAccounts(acc);
        setProtests(pr);
        setBilling(b);
      })
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : "Could not load BPP accounts."),
      )
      .finally(() => setLoading(false));
  }, [user]);

  const isBeta = billing?.plan === "beta";

  function isPaid(a: BppAccountRecord): boolean {
    return isBeta || a.subscriptionStatus === "active";
  }

  function updateAccount(updated: BppAccountRecord) {
    setAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    setRenditionAccount((prev) => (prev && prev.id === updated.id ? updated : prev));
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !businessName.trim()) return;
    setSaving(true);
    try {
      const created = await addBppAccount(user.id, {
        businessName: businessName.trim(),
        accountNumber: accountNumber.trim() || undefined,
        cad: cad.trim() || undefined,
        locationAddress: locationAddress.trim() || undefined,
      });
      setAccounts((prev) => [created, ...prev]);
      setBusinessName("");
      setAccountNumber("");
      setCad("");
      setLocationAddress("");
      setShowForm(false);
      toast.success("BPP account added.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add this BPP account.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Remove this BPP account?")) return;
    setDeletingId(id);
    try {
      await deleteBppAccount(id);
      setAccounts((prev) => prev.filter((a) => a.id !== id));
      toast.success("BPP account removed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove this BPP account.");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSubscribe(account: BppAccountRecord, tier: Tier) {
    setBusyId(account.id);
    try {
      await startBppCheckout(account.id, tier, { newTab: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start checkout.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleCancel(account: BppAccountRecord) {
    const ok = window.confirm(
      `Cancel the subscription for ${account.businessName}? It ends immediately.`,
    );
    if (!ok) return;
    setBusyId(account.id);
    try {
      await cancelBppSubscription(account.id);
      updateAccount({
        ...account,
        subscriptionStatus: "canceled",
        cancelAtPeriodEnd: false,
        cancelAt: null,
      });
      toast.success("Subscription canceled.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not cancel this subscription.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleResume(account: BppAccountRecord) {
    setBusyId(account.id);
    try {
      await resumeBppSubscription(account.id);
      updateAccount({ ...account, cancelAtPeriodEnd: false, cancelAt: null });
      toast.success("Subscription resumed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not resume this subscription.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleAutoRefile(account: BppAccountRecord, enabled: boolean) {
    setBusyId(account.id);
    try {
      const updated = await setBppAutoRefile(account.id, enabled);
      updateAccount(updated);
      toast.success(enabled ? "Auto re-file turned on." : "Auto re-file turned off.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update auto re-file.");
    } finally {
      setBusyId(null);
    }
  }

  const protestByAccountId = new Map(
    protests.filter((p) => p.bppAccountId).map((p) => [p.bppAccountId as string, p]),
  );

  return (
    <div>
      <PageHero
        icon={HeroBppIcon}
        title="BPP Accounts"
        tone="sky"
        subtitle="Tax accounts for business equipment and inventory (BPP). These are separate from the real estate you own."
      >
        <Link to="/dashboard/bpp-intake" className={heroButton}>
          Guided Intake (AI reads a document)
        </Link>
        <button onClick={() => setShowForm((v) => !v)} className={heroButtonGhost}>
          {showForm ? "Cancel" : "Add Manually"}
        </button>
      </PageHero>

      {showForm && (
        <form onSubmit={handleAdd} className="card-elev mt-6 grid gap-3 p-6 sm:grid-cols-2">
          <input
            required
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="Business name *"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm sm:col-span-2"
          />
          <input
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder="CAD account number (optional)"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <input
            value={cad}
            onChange={(e) => setCad(e.target.value)}
            placeholder="County / CAD (optional)"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <input
            value={locationAddress}
            onChange={(e) => setLocationAddress(e.target.value)}
            placeholder="Business location address (optional)"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm sm:col-span-2"
          />
          <button type="submit" disabled={saving} className="btn-accent w-fit disabled:opacity-60">
            {saving ? "Saving…" : "Save BPP Account"}
          </button>
        </form>
      )}

      <div className="mt-6">
        {loading ? (
          <div className="grid gap-4">
            {[0, 1].map((i) => (
              <div key={i} className="card-elev flex items-start justify-between gap-4 p-5">
                <div className="grid gap-2">
                  <Skeleton className="h-5 w-48" />
                  <Skeleton className="h-4 w-64" />
                </div>
                <Skeleton className="h-8 w-20 shrink-0" />
              </div>
            ))}
          </div>
        ) : accounts.length > 0 ? (
          <div className="grid gap-4">
            {accounts.map((a) => {
              const paid = isPaid(a);
              const bracket = bracketForBppValue(a.renderedValue);
              const needsProtest = bppNeedsProtest(a);
              const existingProtest = protestByAccountId.get(a.id);
              return (
                <div key={a.id} className="card-elev row-hover grid gap-4 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h3 className="font-semibold">{a.businessName}</h3>
                      <p className="text-muted-foreground text-sm">
                        {[
                          a.cad,
                          a.accountNumber ? `Acct ${a.accountNumber}` : null,
                          a.locationAddress,
                        ]
                          .filter(Boolean)
                          .join(" • ") || "No additional details"}
                      </p>
                    </div>
                    {!isBeta && (
                      <span
                        className={`badge-soft ${a.subscriptionStatus === "active" ? "" : "bg-secondary text-muted-foreground"}`}
                      >
                        {a.subscriptionStatus === "active"
                          ? a.cancelAtPeriodEnd
                            ? "Canceling"
                            : "Active"
                          : "Not subscribed"}
                      </span>
                    )}
                  </div>

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-secondary/40 p-3 text-xs sm:grid-cols-4">
                    <div>
                      <dt className="text-muted-foreground">Rendered Value</dt>
                      <dd className="font-medium">{money(a.renderedValue)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">County's Notice Value</dt>
                      <dd className="font-medium">{money(a.noticeValue)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Rendition Deadline</dt>
                      <dd className="font-medium">
                        {fmtDate(a.renditionDeadline)}
                        {a.renditionFiledAt && " (filed)"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Protest Deadline</dt>
                      <dd className="font-medium">{fmtDate(a.protestDeadline)}</dd>
                    </div>
                  </dl>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => setRenditionAccount(a)}
                      className="btn-outline py-1.5 text-sm"
                    >
                      {a.renditionSignedAt ? "View Rendition" : "File Rendition (Form 50-144)"}
                    </button>

                    {!isBeta && a.subscriptionStatus !== "active" && stripeConfigured && (
                      <>
                        <button
                          disabled={busyId === a.id}
                          onClick={() => handleSubscribe(a, "owner_managed")}
                          className="btn-primary btn-primary-hover py-1.5 text-sm disabled:opacity-60"
                        >
                          Subscribe — {TIER_LABEL.owner_managed} ($
                          {bppMonthlyPrice("owner_managed", bracket)}/mo)
                        </button>
                        <button
                          disabled={busyId === a.id}
                          onClick={() => handleSubscribe(a, "corvusrf_managed")}
                          className="btn-outline py-1.5 text-sm disabled:opacity-60"
                        >
                          Subscribe — {TIER_LABEL.corvusrf_managed} ($
                          {bppMonthlyPrice("corvusrf_managed", bracket)}/mo)
                        </button>
                      </>
                    )}

                    {!isBeta && a.subscriptionStatus === "active" && (
                      <>
                        {a.cancelAtPeriodEnd ? (
                          <button
                            disabled={busyId === a.id}
                            onClick={() => handleResume(a)}
                            className="btn-outline py-1.5 text-sm disabled:opacity-60"
                          >
                            {busyId === a.id ? "Resuming…" : "Resume Subscription"}
                          </button>
                        ) : (
                          <button
                            disabled={busyId === a.id}
                            onClick={() => handleCancel(a)}
                            className="btn-outline text-warning-foreground py-1.5 text-sm disabled:opacity-60"
                          >
                            {busyId === a.id ? "Canceling…" : "Cancel Subscription"}
                          </button>
                        )}
                      </>
                    )}

                    {existingProtest ? (
                      <span className="badge-soft">Protest requested</span>
                    ) : (
                      needsProtest && (
                        <button
                          disabled={!paid}
                          title={
                            paid ? undefined : "Subscribe to this BPP account to file a protest."
                          }
                          onClick={() => setProtestAccount(a)}
                          className="btn-accent py-1.5 text-sm disabled:opacity-50"
                        >
                          File Protest
                        </button>
                      )
                    )}

                    <button
                      disabled={deletingId === a.id}
                      onClick={() => handleDelete(a.id)}
                      className="btn-outline text-destructive ml-auto py-1.5 text-sm disabled:opacity-60"
                    >
                      {deletingId === a.id ? "Removing…" : "Delete"}
                    </button>
                  </div>

                  {existingProtest?.status === "resolved" && (
                    <div className="flex items-start gap-2.5 rounded-md border border-border p-3 text-sm">
                      <input
                        id={`auto-refile-${a.id}`}
                        type="checkbox"
                        className="mt-0.5"
                        checked={!!a.autoRefile}
                        disabled={busyId === a.id}
                        onChange={(e) => handleToggleAutoRefile(a, e.target.checked)}
                      />
                      <label htmlFor={`auto-refile-${a.id}`}>
                        <span className="font-medium">Auto re-file next year</span>
                        <span className="block text-xs text-muted-foreground">
                          When on, CorvusPT automatically starts next year&apos;s protest once a new
                          notice value disagrees with what was rendered — no action needed beyond
                          signing the actual protest when it's ready. Off by default.
                        </span>
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="card-elev p-8 text-center">
            <h3 className="font-serif text-xl font-semibold">No BPP accounts yet.</h3>
            <p className="text-muted-foreground mt-1">
              Add a business personal property account to start tracking its rendition.
            </p>
          </div>
        )}
      </div>

      {renditionAccount && (
        <BppRenditionEditor
          account={renditionAccount}
          open
          onClose={() => setRenditionAccount(null)}
          onUpdate={updateAccount}
        />
      )}

      {user && protestAccount && (
        <BppProtestFlow
          userId={user.id}
          account={protestAccount}
          userEmail={user.email}
          open
          isPaid={isPaid(protestAccount)}
          onOpenChange={(o) => !o && setProtestAccount(null)}
          onDone={(protest) => setProtests((prev) => [protest, ...prev])}
        />
      )}
    </div>
  );
}
