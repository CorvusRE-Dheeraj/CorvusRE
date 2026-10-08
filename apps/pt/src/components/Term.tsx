import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GLOSSARY_MAP } from "@/lib/glossary";

// Wraps a Texas property-tax word so hovering (or keyboard focus) shows a plain-English meaning.
export function Term({ name, children }: { name: string; children?: ReactNode }) {
  const meaning = GLOSSARY_MAP[name];
  if (!meaning) return <>{children ?? name}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          // Focusable so keyboard users can open the definition too.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          className="cursor-help underline decoration-dotted decoration-muted-foreground/60 underline-offset-2"
        >
          {children ?? name}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{meaning}</TooltipContent>
    </Tooltip>
  );
}
