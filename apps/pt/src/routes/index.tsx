import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Upload,
  Home as HomeIcon,
  Sparkles,
  TrendingDown,
  Scale,
  Briefcase,
  Receipt,
  PiggyBank,
  ArrowRight,
  Plane,
  MapPin,
  Loader2,
} from "lucide-react";
import {
  updateIntake,
  resetIntake,
  cadRecordToIntakePatch,
  classifyAndStoreDocument,
  currency,
  type PropertyKind,
} from "@/lib/intake-store";
import type { CadRecord } from "@/lib/cad-lookup";
import { unifiedPropertySearch, type UnifiedMatch } from "@/lib/unified-search";
import { classifyPropertyCategory } from "@/lib/texas-tax-rates";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { LiveSearchLoader } from "@/components/LiveSearchLoader";
import { SampleNoticeDialog } from "@/components/SampleNoticeDialog";
import { MapPinPicker } from "@/components/MapPinPicker";
import { HeroBackground } from "@/components/HeroBackground";
import { MicButton } from "@/components/MicButton";
import { AnimatedSteps } from "@/components/AnimatedSteps";
import { ScrollReveal } from "@/components/ScrollReveal";
import { ProductPreview } from "@/components/ProductPreview";
import { HouseIllustration } from "@/assets/illustrations/house";
import { WavingRobotIllustration } from "@/assets/illustrations/waving-robot";
import { useFileDrop } from "@/hooks/use-file-drop";
import { ICON_COLORS } from "@/lib/icon-colors";
import { useAuth } from "@/lib/auth";
import { PropertyIds } from "@/components/PropertyIds";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CorvusPT — Texas Property Tax Management, Powered by AI" },
      {
        name: "description",
        content:
          "Upload your Texas appraisal notice or enter your commercial or residential property. AI checks your county value, protest deadline, evidence gaps, and savings opportunity.",
      },
      { property: "og:title", content: "CorvusPT — Texas Property Tax, Powered by AI" },
      {
        property: "og:description",
        content:
          "AI-powered Texas property tax platform: protest, BPP rendition, payments, refunds, and savings tracking in one place.",
      },
    ],
  }),
  component: Home,
});

const STEP_GRADIENTS = [
  "from-sky-500 to-blue-600",
  "from-violet-500 to-fuchsia-600",
  "from-emerald-500 to-teal-600",
];

function Home() {
  const navigate = useNavigate();
  // Already a signed-in user (so already a beta user) — the promo banner's
  // "sign up as a beta user" pitch doesn't apply, and its link goes to
  // /sign-in with no redirect target, which just bounces a signed-in visitor
  // straight back here (looked like the link "did nothing").
  const { user } = useAuth();
  const [address, setAddress] = useState("");
  const [propertyKind, setPropertyKind] = useState<PropertyKind>("commercial");
  const [uploading, setUploading] = useState(false);
  // See the matching state in intake.tsx for why this exists — blocks
  // submitting a Google-sourced address before its Place Details upgrade
  // (real street name, not e.g. "Market Pl Blvd") has landed. Matters just as
  // much here: this is the address that gets carried forward into /intake.
  const [resolvingAddress, setResolvingAddress] = useState(false);
  const [pickingOnMap, setPickingOnMap] = useState(false);
  // Live CAD matches under the address box, debounced — same feature and
  // same cadLookupPreview() call as intake.tsx's own live dropdown (see its
  // comment); this is the OTHER place a user types a property address, and
  // it was missing this entirely until now. Picking a match here skips
  // straight to the Confirm step on /intake instead of re-running the
  // lookup there — see selectLiveMatch below.
  const [liveMatches, setLiveMatches] = useState<UnifiedMatch[]>([]);
  const [liveMatchesLoading, setLiveMatchesLoading] = useState(false);
  const [liveMatchesOpen, setLiveMatchesOpen] = useState(false);
  const liveMatchRequestRef = useRef(0);
  // CorvusPT serves commercial only — but a row doesn't KNOW it's
  // residential until its CAD record resolves, so filtering those rows out
  // entirely made a real suggestion visibly flash in (while still
  // "pending") and then vanish the instant it classified as residential —
  // found live ("I need to see that suggestion, but... gray out the
  // residential ones" instead of hiding them, same treatment as the
  // Residential tab itself above the search box). Every row is kept now;
  // isResidentialMatch below is checked per row at render time instead, to
  // style it grayed-out/unselectable rather than removing it.
  function isResidentialMatch(m: UnifiedMatch): boolean {
    return Boolean(m.record) && classifyPropertyCategory(m.record!.propertyType) === "residential";
  }

  // Lowered from 8 — found live chasing "I want to see ALL the addresses,
  // like Google Maps": Google's own search box starts suggesting after just
  // a few characters, and the old 8-char floor meant the dropdown stayed
  // blank through most of a short address or name. 4 is still long enough
  // to avoid firing a real search on "123" or "wal".
  const MIN_LIVE_SEARCH_LENGTH = 4;
  const LIVE_SEARCH_DEBOUNCE_MS = 500;
  useEffect(() => {
    const q = address.trim();
    if (q.length < MIN_LIVE_SEARCH_LENGTH) {
      setLiveMatches([]);
      setLiveMatchesOpen(false);
      setLiveMatchesLoading(false);
      return;
    }
    const requestId = ++liveMatchRequestRef.current;
    setLiveMatchesLoading(true);
    const controller = new AbortController();
    const t = setTimeout(() => {
      // Streaming, not atomic — found live chasing a real "why does it take
      // 7 seconds to show the Braum's locations I can already see on
      // Google Maps?" report: unifiedPropertySearch now calls back with
      // whatever's been found so far every time a new sub-search resolves,
      // instead of making the caller wait on the slowest one. Each callback
      // just replaces the displayed list wholesale (it's already the full
      // current best list, deduped+filtered) and opens the dropdown on the
      // very first one, so the user sees the fast result immediately and
      // watches slower ones join it, rather than a blank dropdown the whole
      // time. unifiedPropertySearch itself caps the total wait at 3 minutes and
      // discards anything slower than that.
      unifiedPropertySearch(
        q,
        (results) => {
          if (liveMatchRequestRef.current !== requestId) return;
          setLiveMatches(results);
          setLiveMatchesOpen(true);
        },
        controller.signal,
      )
        .then(() => {
          if (liveMatchRequestRef.current !== requestId) return;
          // Nothing ever came in (a genuine zero-match search) — still open
          // the dropdown so it shows the "no matches" row + manual-search
          // fallback button, rather than rendering nothing at all (see the
          // panel's own comment below for why that silence was itself a
          // bug).
          setLiveMatchesOpen(true);
        })
        .catch(() => {
          if (liveMatchRequestRef.current !== requestId) return;
          setLiveMatchesOpen(true);
        })
        .finally(() => {
          if (liveMatchRequestRef.current !== requestId) return;
          setLiveMatchesLoading(false);
        });
    }, LIVE_SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  // Shared by the form's own submit and by picking an address suggestion
  // directly (see onPlaceSelected below) — takes the address as a parameter
  // rather than reading `address` state, since onPlaceSelected already hands
  // over the final resolved value and going through state first would mean
  // waiting an extra render for it to land.
  function goToIntake(addr: string) {
    if (!addr.trim()) return;
    resetIntake();
    updateIntake({ address: addr.trim(), propertyKind });
    navigate({ to: "/intake" });
  }

  // A live match was picked directly — skip the address-validation round
  // trip entirely: store the full real record (same field mapping
  // intake.tsx's applyCadRecord uses) and land straight on /intake's
  // Confirm step, which already resumes there whenever accountNumber+cad
  // are set (see its own mount effect).
  function selectLiveMatch(record: CadRecord) {
    if (classifyPropertyCategory(record.propertyType) === "residential") return;
    setLiveMatchesOpen(false);
    resetIntake();
    updateIntake({ propertyKind });
    updateIntake(cadRecordToIntakePatch(record, record.propertyAddress.trim() || address.trim()));
    navigate({ to: "/intake" });
  }

  // A dropdown row was clicked. Most rows already have a resolved CAD
  // record (selectLiveMatch's fast path above). A row still "pending" or
  // settled at "none" — a real Google-known address we just don't have
  // county parcel data for yet/at all — has no record to jump straight in
  // with, so it falls back to the exact same manual-resolution flow typing
  // a full address and submitting already uses: goToIntake runs the real
  // (non-preview) cadLookup on /intake's mount, which is slower but still
  // works for an address outside this fast preview path.
  function selectMatch(m: UnifiedMatch) {
    if (m.record) {
      selectLiveMatch(m.record);
    } else {
      setLiveMatchesOpen(false);
      goToIntake(m.address);
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (resolvingAddress) return;
    goToIntake(address);
  };

  async function onFile(f: File) {
    setUploading(true);
    try {
      await classifyAndStoreDocument(f);
      navigate({ to: "/document-review" });
    } catch (err) {
      console.error(err);
      toast.error(
        err instanceof Error ? err.message : "Could not read this document. Please try again.",
      );
      setUploading(false);
    }
  }

  const { isDragging, dropHandlers } = useFileDrop(onFile, uploading);

  return (
    <>
      <section className="relative overflow-hidden min-h-[calc(100dvh-4rem)] flex flex-col justify-center">
        <HeroBackground />
        {!user && (
          <div className="beta-flyby-plane" aria-label="Beta signup announcement">
            <Plane className="h-6 w-6 shrink-0 text-accent -rotate-[135deg]" aria-hidden="true" />
            <span className="beta-flyby-rope" aria-hidden="true" />
            <div className="beta-flyby-banner">
              <span className="text-sm font-medium">
                🎉 Sign up as a beta user and get a free property protest evaluation.
              </span>
              <span className="text-sm font-bold">Free to start. No card required.</span>
              <Link
                to="/sign-in"
                className="text-sm font-semibold text-warning underline underline-offset-2"
              >
                Join the beta →
              </Link>
            </div>
          </div>
        )}
        {/* pt-16 (not pt-8) below md — the flyby banner above is absolutely
            positioned at top: 1.5rem and stands ~40px tall, so on a mobile
            viewport (where the heading wraps to more, larger-relative-size
            lines starting right after this padding) an 8-unit gap let the
            banner fly directly across the heading text instead of clearing
            it. md:pt-12 is unchanged — not reported broken there, and this
            reserves real layout space rather than guessing a coordinate. */}
        <div className="container-page pt-16 pb-0 md:pt-12 md:pb-2">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="font-serif text-3xl sm:text-4xl md:text-6xl font-semibold leading-[1.15] md:leading-[1.1]">
              AI Property Tax Management
              <br className="hidden md:block" />{" "}
              <span className="text-emerald-700 dark:text-emerald-400">Protest and Save</span>
            </h1>
            <p className="mt-3 text-lg sm:text-xl font-medium text-foreground/80">
              From Notice to Savings.
            </p>

            <div className="mt-8 flex justify-center" role="radiogroup" aria-label="Property type">
              <div className="inline-flex rounded-full border border-border bg-card p-1 shadow-sm">
                {(["commercial", "residential"] as const).map((kind) =>
                  kind === "residential" ? (
                    <button
                      key={kind}
                      type="button"
                      role="radio"
                      aria-checked={false}
                      disabled
                      title="Residential — coming soon"
                      className="rounded-full px-4 py-1.5 text-sm font-medium capitalize text-muted-foreground/70 cursor-not-allowed"
                    >
                      {kind}
                      <span className="ml-1 text-[10px] font-semibold normal-case">(soon)</span>
                    </button>
                  ) : (
                    <button
                      key={kind}
                      type="button"
                      role="radio"
                      aria-checked={propertyKind === kind}
                      onClick={() => setPropertyKind(kind)}
                      className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
                        propertyKind === kind
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {kind}
                    </button>
                  ),
                )}
              </div>
            </div>

            <div className="relative mt-3">
              {/* AI robot pops up out of the search box's own top-left corner (the
              box is the "doorway" now, not a separate graphic beside it) —
              same one-time emerge animation as before, reused as-is. */}
              <div className="hidden sm:block absolute -top-16 -left-14 z-10" aria-hidden="true">
                <WavingRobotIllustration className="h-24 w-auto hero-mascot-emerge" />
                <div className="hero-bubble absolute -top-4 left-[105%] w-36 text-left">
                  Hi! 👋 Type your address, or upload.
                </div>
              </div>
              <form
                onSubmit={submit}
                className="flex flex-col sm:flex-row sm:items-center gap-2 bg-card p-2 rounded-xl shadow-elev border border-border"
              >
                <AddressAutocomplete
                  value={address}
                  onChange={setAddress}
                  onResolving={setResolvingAddress}
                  onPlaceSelected={goToIntake}
                  placeholder={`Enter a ${propertyKind} property address in Texas`}
                  className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground px-4 py-3 outline-none rounded-lg"
                  ariaLabel={`${propertyKind === "commercial" ? "Commercial" : "Residential"} property address`}
                  // Always on — this component's own plain-text suggestion
                  // list is now fully superseded by the unified live-match
                  // panel below, which already folds Google's own
                  // suggestions INTO its search (see unifiedPropertySearch in
                  // lib/unified-search.ts): each Google candidate is resolved
                  // to a real address and run through CAD lookup, so the one
                  // panel shows real, parcel-grounded results regardless of
                  // whether the match came from the typed text directly or
                  // via a Google-resolved business name.
                  suppressSuggestions
                />
                <MicButton onResult={setAddress} />
                <button
                  type="submit"
                  disabled={resolvingAddress}
                  className="btn-accent !rounded-full disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {resolvingAddress ? "Resolving…" : "Start Free AI Property Review"}
                </button>
              </form>

              {liveMatchesLoading && liveMatches.length === 0 && (
                <LiveSearchLoader className="mt-3 px-1" query={address} />
              )}

              {liveMatchesOpen && (
                <div className="mt-2 max-h-[26rem] overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-card text-left shadow-sm">
                  {liveMatchesLoading && (
                    <div className="border-b border-border px-4 py-2.5">
                      <LiveSearchLoader query={address} />
                    </div>
                  )}
                  {liveMatches.length === 0 && !liveMatchesLoading && (
                    // A settled search that genuinely found nothing at all —
                    // not even a bare Google-known address, since those now
                    // show up as their own "none" row below instead of
                    // being dropped. Still gives a next step rather than
                    // silence.
                    <p className="px-4 py-3 text-sm text-muted-foreground">
                      No matching addresses found for "{address.trim()}".
                    </p>
                  )}
                  {/* Raised from 6 — every real Google match is now its own
                  row (see unifiedPropertySearch), not just the ones that
                  happened to resolve to a CAD record, so there's genuinely
                  more worth showing; the container above scrolls instead of
                  growing the page unboundedly. */}
                  {liveMatches.slice(0, 10).map((m, i) => {
                    const residential = isResidentialMatch(m);
                    // Same grayed-out, non-clickable treatment as a
                    // residential row — found live ("denver walmart" shown
                    // under a "Searching Dallas County records…" spinner for
                    // a real Colorado address): a row we already know is out
                    // of coverage is shown, not hidden, but never
                    // selectable, with its own plain reason instead of
                    // residential's.
                    const disabled = residential || m.cadStatus === "unsupported";
                    return (
                      <button
                        key={m.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => !disabled && selectMatch(m)}
                        title={
                          residential
                            ? "Residential — coming soon"
                            : disabled
                              ? "We don't cover this county yet"
                              : undefined
                        }
                        className={`row-hover block w-full px-4 py-3 text-left ${
                          i > 0 ? "border-t border-border" : ""
                        } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
                      >
                        {/* Shown only for a result found by following a Google
                        suggestion to its real address first (see
                        unifiedPropertySearch) — ties the store/business name
                        the user actually searched for back to the row below
                        it, instead of just a bare address they typed a name
                        to find. */}
                        {m.googleLabel && (
                          <div
                            className={`truncate text-xs font-semibold ${disabled ? "text-muted-foreground" : "text-accent"}`}
                          >
                            {m.googleLabel}
                          </div>
                        )}
                        <div
                          className={`truncate text-sm font-semibold uppercase tracking-tight ${disabled ? "text-muted-foreground" : ""}`}
                        >
                          {m.address}
                        </div>
                        {residential ? (
                          // Shown, not hidden — found live ("I need to see
                          // that suggestion, but it's residential... gray it
                          // out" instead of it flashing in while pending and
                          // vanishing the instant it classifies): same
                          // "(soon)" language as the Residential tab above
                          // the search box, not a silently dropped row.
                          <div className="mt-0.5 truncate text-xs text-muted-foreground">
                            Residential — coming soon
                          </div>
                        ) : m.cadStatus === "unsupported" ? (
                          <div className="mt-0.5 truncate text-xs text-muted-foreground">
                            We don't cover this county yet
                          </div>
                        ) : m.record ? (
                          <div className="mt-0.5 truncate text-xs text-muted-foreground">
                            <PropertyIds
                              accountNumber={m.record.accountNumber}
                              geoId={m.record.geoId}
                            />
                            {" · "}
                            {m.record.cad}
                            {m.record.totalValue != null && <> · {currency(m.record.totalValue)}</>}
                          </div>
                        ) : m.cadStatus === "pending" ? (
                          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Looking up county parcel…
                          </div>
                        ) : (
                          // "none" — a real address (Google found it) with no
                          // county parcel on file for it. Still selectable:
                          // picking it runs the normal, slower manual
                          // resolution flow instead of this fast preview path.
                          <div className="mt-0.5 truncate text-xs text-muted-foreground">
                            No county parcel on file — tap to continue anyway
                          </div>
                        )}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      setLiveMatchesOpen(false);
                      goToIntake(address);
                    }}
                    className="block w-full border-t border-border bg-accent px-4 py-3 text-center text-sm font-semibold text-accent-foreground"
                  >
                    Don't see your address? Click here.
                  </button>
                </div>
              )}
            </div>

            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <label
                className={`btn-outline inline-flex items-center gap-2 cursor-pointer bg-card shadow-elev ${
                  uploading ? "opacity-60 pointer-events-none" : ""
                } ${isDragging ? "ring-2 ring-accent" : ""}`}
                style={{ backgroundColor: "var(--color-card)" }}
                {...dropHandlers}
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,image/*"
                  disabled={uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onFile(f);
                  }}
                />
                {isDragging
                  ? "Drop to upload"
                  : uploading
                    ? "Reading document…"
                    : "Upload Appraisal Notice"}
              </label>
              <button
                type="button"
                onClick={() => setPickingOnMap(true)}
                className="btn-outline inline-flex items-center gap-2 bg-card shadow-elev"
                style={{ backgroundColor: "var(--color-card)" }}
              >
                <MapPin className="h-4 w-4" />
                Don't Know the Address? Pin It on the Map
              </button>
            </div>

            {uploading ? (
              <div className="mt-6 mx-auto max-w-md card-elev p-5 text-left">
                <h3 className="font-serif text-base font-semibold">AI is reading your document…</h3>
                <AnimatedSteps
                  steps={[
                    { label: "OCR & text extraction", status: "done" },
                    { label: "Classifying document type", status: "active" },
                    { label: "Extracting owner, values, and deadlines", status: "active" },
                  ]}
                />
              </div>
            ) : (
              <div className="mt-3 flex justify-center">
                <SampleNoticeDialog triggerClassName="rounded-full bg-card px-3 py-1.5 shadow-elev text-foreground hover:text-accent" />
              </div>
            )}
          </div>
        </div>
      </section>

      {/* From Notice to Savings in 3 Steps — a condensed summary of the full
        6-step breakdown on /how-it-works, not a restatement of it. */}
      <section className="container-page py-14 md:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <span className="badge-soft">How It Works</span>
          <h2 className="mt-3 font-serif text-3xl md:text-4xl font-semibold">
            From Notice to Savings in 3 Steps
          </h2>
        </div>
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {PROCESS_STEPS.map((step, i) => (
            <ScrollReveal key={step.title} delay={i * 150} className="text-center">
              <span className="relative mx-auto grid h-16 w-16 place-items-center">
                {i < PROCESS_STEPS.length - 1 && (
                  <span
                    aria-hidden
                    className="absolute left-full top-1/2 hidden h-0.5 w-[calc(100%+4rem)] -translate-y-1/2 bg-gradient-to-r from-accent/50 to-transparent md:block"
                  />
                )}
                <span
                  className={`relative grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br shadow-md transition-transform hover:-translate-y-1 hover:rotate-3 ${STEP_GRADIENTS[i % STEP_GRADIENTS.length]} text-white`}
                >
                  <step.icon className="h-7 w-7" />
                  <span className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-background text-xs font-bold text-foreground shadow ring-1 ring-border">
                    {i + 1}
                  </span>
                </span>
              </span>
              <h3 className="mt-4 font-serif text-lg font-semibold">{step.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
            </ScrollReveal>
          ))}
        </div>
        <div className="mt-10 text-center">
          <Link
            to="/how-it-works"
            className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
          >
            See the full process <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </section>

      <ProductPreview />

      {/* How CorvusPT Helps You Save — real, existing services only (no stats,
        no testimonials — see plan notes on why those are out of scope). A
        soft brand-gradient wash instead of flat --secondary, per "more
        colorful/bolder" feedback — the section still reads as a quiet
        backdrop for the cards, just this app's own colors instead of gray. */}
      <section className="brand-gradient-soft py-14 md:py-20">
        <div className="container-page">
          <div className="mx-auto max-w-2xl text-center">
            <span className="badge-soft">What You Get</span>
            <h2 className="mt-3 font-serif text-3xl md:text-4xl font-semibold">
              How CorvusPT Helps You Save
            </h2>
          </div>
          <div className="mt-12 grid items-center gap-6 md:grid-cols-3">
            <div className="order-2 grid gap-6 md:order-1">
              {SAVE_FEATURES.slice(0, 2).map((f, i) => (
                <FeatureCard key={f.title} feature={f} delay={i * 150} />
              ))}
            </div>
            <div className="order-1 md:order-2 relative mx-auto grid place-items-center py-8">
              <span className="radiate-ring absolute h-40 w-40 rounded-full border-2 border-accent/30" />
              <span
                className="radiate-ring absolute h-40 w-40 rounded-full border-2 border-accent/30"
                style={{ animationDelay: "1s" }}
              />
              <span
                className="radiate-ring absolute h-40 w-40 rounded-full border-2 border-accent/30"
                style={{ animationDelay: "2s" }}
              />
              <HouseIllustration className="relative h-40 w-auto" />
            </div>
            <div className="order-3 grid gap-6">
              {SAVE_FEATURES.slice(2, 4).map((f, i) => (
                <FeatureCard key={f.title} feature={f} delay={(i + 2) * 150} />
              ))}
            </div>
          </div>
        </div>
      </section>

      {pickingOnMap && (
        <MapPinPicker
          onClose={() => setPickingOnMap(false)}
          onConfirm={(resolvedAddress) => {
            setPickingOnMap(false);
            goToIntake(resolvedAddress);
          }}
        />
      )}
    </>
  );
}

const PROCESS_STEPS = [
  {
    title: "Tell us about your property",
    description:
      "Enter your address or upload a notice — AI matches your county's official record.",
    icon: HomeIcon,
    color: ICON_COLORS[0], // blue — start
  },
  {
    title: "AI reviews your case",
    description:
      "Ten AI modules analyze value, comps, and evidence, while CorvusPT staff handle filing and the county.",
    icon: Sparkles,
    color: ICON_COLORS[1], // violet — AI at work
  },
  {
    title: "Track your savings",
    description: "One dashboard for deadlines, payments, refunds, and savings — always up to date.",
    icon: TrendingDown,
    color: ICON_COLORS[5], // green — done/positive
  },
] as const;

const SAVE_FEATURES = [
  {
    title: "Property Tax Protest",
    description:
      "AI-backed evidence and CorvusPT staff filing to challenge an overvalued assessment.",
    icon: Scale,
    to: "/property-protest",
    color: ICON_COLORS[0],
  },
  {
    title: "BPP Rendition",
    description: "Business personal property accounts tracked and rendered correctly, every year.",
    icon: Briefcase,
    to: "/bpp-rendition",
    color: ICON_COLORS[1],
  },
  {
    title: "Tax Payment Tracking",
    description:
      "Know what's due, when, and what's already been paid — for every property you own.",
    icon: Receipt,
    to: "/tax-payment",
    color: ICON_COLORS[2],
  },
  {
    title: "Property Tax Management",
    description: "One place for deadlines, documents, and savings across your whole portfolio.",
    icon: PiggyBank,
    to: "/property-tax-management",
    color: ICON_COLORS[3],
  },
] as const;

function FeatureCard({
  feature,
  delay,
}: {
  feature: (typeof SAVE_FEATURES)[number];
  delay: number;
}) {
  return (
    <ScrollReveal delay={delay}>
      <Link to={feature.to} className="card-elev flex gap-4 p-5 hover:bg-secondary/40">
        <span
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${feature.color.bg} ${feature.color.text}`}
        >
          <feature.icon className="h-5 w-5" />
        </span>
        <div>
          <h3 className="font-serif text-base font-semibold">{feature.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{feature.description}</p>
        </div>
      </Link>
    </ScrollReveal>
  );
}
