import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

// Small icon-only copy affordance for values people reference elsewhere
// (account numbers, mostly) — swaps to a checkmark for a moment as its own
// feedback, on top of the toast, since the checkmark is visible right where
// the user's eyes already are without needing to glance at the toast corner.
export function CopyButton({ value, label = "Copied" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(label);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy — your browser blocked clipboard access.");
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? "Copied" : "Copy to clipboard"}
          className="inline-grid h-5 w-5 shrink-0 place-items-center rounded text-muted-foreground transition-all hover:scale-110 hover:text-foreground"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-success animate-in zoom-in-50 duration-200" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied!" : "Copy"}</TooltipContent>
    </Tooltip>
  );
}
