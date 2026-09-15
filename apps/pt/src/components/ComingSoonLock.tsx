import { Lock } from "lucide-react";

// Full-page "locked, coming soon" state for a dashboard section that's
// temporarily gated off — used instead of deleting the section's real code,
// so re-enabling it later is just removing the LOCKED flag/early-return in
// that route file, not rebuilding anything. Matches the app's existing
// empty-state card styling (see e.g. BPP Accounts'/Tax Bills' own "no
// accounts/bills yet" card) so it doesn't read as a broken page.
export function ComingSoonLock({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h1 className="font-serif text-2xl font-bold">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
      <div className="mt-6 card-elev grid place-items-center gap-2 p-10 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-full bg-secondary/60 text-muted-foreground">
          <Lock className="h-5 w-5" />
        </div>
        <h2 className="text-base font-bold">Coming Soon</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          This section isn't available yet — check back soon.
        </p>
      </div>
    </div>
  );
}
