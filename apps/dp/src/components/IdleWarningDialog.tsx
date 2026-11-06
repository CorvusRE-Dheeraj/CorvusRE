import { useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Shown by AuthProvider (lib/auth.tsx) after 60 minutes without activity:
// the user chooses to stay or sign out; with no answer they are signed out
// when the countdown reaches zero. Same dialog in apps/pt.
export function IdleWarningDialog({
  deadline,
  onStay,
  onSignOut,
  onExpire,
}: {
  /** epoch ms when the automatic sign-out happens */
  deadline: number;
  onStay: () => void;
  onSignOut: () => void;
  onExpire: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const stayRef = useRef<HTMLButtonElement>(null);
  const left = Math.max(0, deadline - now);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (left === 0) onExpire();
  }, [left, onExpire]);

  const secs = Math.ceil(left / 1000);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

  return (
    // Escape counts as "stay" — a key press means the person is here.
    <AlertDialog open onOpenChange={(open) => !open && onStay()}>
      <AlertDialogContent
        // Above every other overlay (the agreements packet and welcome screen
        // are z-[100], the tour z-[200]) — a hidden warning signs people out unseen.
        className="z-[300]"
        overlayClassName="z-[300]"
        onOpenAutoFocus={(e) => {
          // Focus "Stay signed in" (the safe choice), not the first button.
          e.preventDefault();
          stayRef.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>You're about to be signed out</AlertDialogTitle>
          <AlertDialogDescription>
            You haven't been active for 60 minutes, so for your security you'll be signed out in{" "}
            <span className="font-semibold tabular-nums text-foreground">{clock}</span>. Anything
            you've saved stays saved.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <button type="button" className="btn-outline" onClick={onSignOut}>
            Sign out
          </button>
          <button ref={stayRef} type="button" className="btn-accent" onClick={onStay}>
            Stay signed in
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
