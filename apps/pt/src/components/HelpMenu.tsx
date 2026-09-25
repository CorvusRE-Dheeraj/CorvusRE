import { OPEN_TOUR_EVENT } from "@/components/WelcomeTour";
import { Link } from "@tanstack/react-router";
import { BookOpen, CalendarCheck, HelpCircle, Sparkles, MessageCircle } from "lucide-react";
import { GLOSSARY } from "@/lib/glossary";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// A "?" button in the header: quick help, ways to reach us, and a plain-English glossary.
export function HelpMenu({ inline }: { inline?: boolean }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        {inline ? (
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-3 py-3 text-left text-sm font-medium transition-colors hover:bg-secondary"
          >
            <HelpCircle className="h-4 w-4" /> Help &amp; glossary
          </button>
        ) : (
          <button
            type="button"
            aria-label="Help and glossary"
            title="Help"
            className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-all hover:bg-secondary hover:text-foreground"
          >
            <HelpCircle className="h-[18px] w-[18px]" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[80vh] w-[22rem] overflow-y-auto p-0">
        <div className="border-b border-border p-4">
          <div className="font-serif text-base font-semibold">Need a hand?</div>
          <div className="mt-2 grid gap-1 text-sm">
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event(OPEN_TOUR_EVENT))}
              className="flex items-center gap-2 rounded-md p-2 text-left hover:bg-secondary"
            >
              <Sparkles className="h-4 w-4 text-amber-700" /> Take the quick tour
            </button>
            <Link
              to="/how-it-works"
              className="flex items-center gap-2 rounded-md p-2 hover:bg-secondary"
            >
              <BookOpen className="h-4 w-4 text-sky-700" /> How it works
            </Link>
            <Link
              to="/contact"
              className="flex items-center gap-2 rounded-md p-2 hover:bg-secondary"
            >
              <CalendarCheck className="h-4 w-4 text-emerald-700" /> Book a meeting with us
            </Link>
            <Link
              to="/contact"
              className="flex items-center gap-2 rounded-md p-2 hover:bg-secondary"
            >
              <MessageCircle className="h-4 w-4 text-violet-700" /> Send us a message
            </Link>
          </div>
        </div>
        <div className="p-4">
          <div className="font-serif text-base font-semibold">
            Texas tax terms, in plain English
          </div>
          <dl className="mt-2 grid gap-2.5 text-sm">
            {GLOSSARY.map(([term, meaning]) => (
              <div key={term}>
                <dt className="font-semibold">{term}</dt>
                <dd className="text-muted-foreground">{meaning}</dd>
              </div>
            ))}
          </dl>
        </div>
      </PopoverContent>
    </Popover>
  );
}
