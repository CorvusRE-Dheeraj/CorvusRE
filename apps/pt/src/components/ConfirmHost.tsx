import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Pending = { message: string; resolve: (ok: boolean) => void };
let listener: ((p: Pending) => void) | null = null;

// A friendlier drop-in for window.confirm: `if (!(await confirmDialog("Remove this?"))) return;`
// Falls back to the browser prompt if the host isn't mounted.
export function confirmDialog(message: string): Promise<boolean> {
  if (!listener) return Promise.resolve(window.confirm(message));
  return new Promise((resolve) => listener?.({ message, resolve }));
}

export function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  useEffect(() => {
    listener = setPending;
    return () => {
      listener = null;
    };
  }, []);

  function answer(ok: boolean) {
    pending?.resolve(ok);
    setPending(null);
  }

  return (
    <AlertDialog open={!!pending} onOpenChange={(o) => !o && answer(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you sure?</AlertDialogTitle>
          <AlertDialogDescription className="whitespace-pre-line">
            {pending?.message}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => answer(false)}>Go back</AlertDialogCancel>
          <AlertDialogAction onClick={() => answer(true)}>Yes, continue</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
