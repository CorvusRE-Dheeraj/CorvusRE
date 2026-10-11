import { useEffect, useRef } from "react";
import { Sparkles } from "lucide-react";

const SEEN_KEY = (userId: string) => `corvuspt.welcomeSeen.${userId}`;
// Same "brand-new account" window auth.tsx uses before asking for the welcome email.
const NEW_ACCOUNT_MS = 24 * 60 * 60 * 1000;

// Shown once, right after sign-up, before anything else (EngagementPacketHost
// renders it ahead of the agreements pop-up). The beta login link it mentions is
// the welcome email's button — see supabase/pt/functions/_shared/welcome-email.ts.
export function shouldShowWelcome(user: { id: string; created_at: string }): boolean {
  if (Date.now() - new Date(user.created_at).getTime() > NEW_ACCOUNT_MS) return false;
  try {
    return localStorage.getItem(SEEN_KEY(user.id)) !== "1";
  } catch {
    return false; // storage blocked — don't risk showing it on every page load
  }
}

export function markWelcomeSeen(userId: string): void {
  try {
    localStorage.setItem(SEEN_KEY(userId), "1");
  } catch {
    // harmless
  }
}

export function WelcomeScreen({ onContinue }: { onContinue: () => void }) {
  // Keyboard focus starts on the one action, as a modal should.
  const continueRef = useRef<HTMLButtonElement>(null);
  useEffect(() => continueRef.current?.focus(), []);
  return (
    <div
      data-blocking-dialog
      role="dialog"
      aria-modal="true"
      aria-labelledby="corvuspt-welcome-title"
      className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-3 sm:p-6"
    >
      <div className="bg-card flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl shadow-elev">
        <div className="brand-gradient px-6 py-6 text-white sm:px-8">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/85">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Welcome to CorvusPT
          </div>
          <h2
            id="corvuspt-welcome-title"
            className="mt-2 font-serif text-2xl font-semibold sm:text-3xl"
          >
            Thank you for signing up. We&rsquo;re glad to have you with us.
          </h2>
        </div>
        <div className="grid gap-4 overflow-y-auto px-6 py-6 text-[15px] leading-relaxed sm:px-8">
          <p>
            You&rsquo;re in control of your property tax protest, but you&rsquo;re not doing it
            alone. CorvusPT gives you AI-powered tools, guidance, and support to help you understand
            your assessment, identify reduction opportunities, organize your evidence, track
            deadlines, and prepare for each step.
          </p>
          <p>
            When something needs your attention, we&rsquo;ll help you understand what to do next and
            why it matters.
          </p>
          <div className="grid gap-2 rounded-lg border border-accent/40 bg-accent/10 p-4 text-sm">
            <p>
              <strong>Your CorvusPT beta login link has been sent to your email.</strong>
            </p>
            <p>
              Your signed documents will be sent to your email. The email will include a link to the
              client portal. Log in to access your property dashboard and get started.
            </p>
          </div>
          <p className="font-serif text-lg font-semibold">
            You manage the protest. CorvusPT helps make it easier.
          </p>
          <div className="flex justify-end">
            <button ref={continueRef} type="button" onClick={onContinue} className="btn-accent">
              Get started
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
