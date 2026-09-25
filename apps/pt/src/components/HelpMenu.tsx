import { Link } from "@tanstack/react-router";
import { BookOpen, CalendarCheck, HelpCircle, MessageCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// Plain-English meanings for the Texas property-tax words used across the app.
const GLOSSARY: [string, string][] = [
  ["CAD", "Central Appraisal District — the county office that sets your property's value."],
  ["ARB", "Appraisal Review Board — the panel that hears your protest if you can't settle first."],
  ["Protest", "Your formal challenge that the appraised value is too high."],
  [
    "Informal review",
    "A first conversation with the county's appraiser to try to settle the value.",
  ],
  [
    "Formal hearing",
    "Your case in front of the ARB, with evidence, if the informal review doesn't settle it.",
  ],
  [
    "Binding arbitration",
    "An alternative after the ARB, where a neutral arbitrator sets the value.",
  ],
  ["Court appeal", "Taking the ARB's decision to district court instead."],
  [
    "BPP",
    "Business Personal Property — equipment and inventory a business owns, taxed separately.",
  ],
  ["Rendition", "The report you file listing your business personal property and its value."],
];

// A "?" button in the header: quick help, ways to reach us, and a plain-English glossary.
export function HelpMenu() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Help and glossary"
          title="Help"
          className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-all hover:bg-secondary hover:text-foreground"
        >
          <HelpCircle className="h-[18px] w-[18px]" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[80vh] w-[22rem] overflow-y-auto p-0">
        <div className="border-b border-border p-4">
          <div className="font-serif text-base font-semibold">Need a hand?</div>
          <div className="mt-2 grid gap-1 text-sm">
            <Link
              to="/how-it-works"
              className="flex items-center gap-2 rounded-md p-2 hover:bg-secondary"
            >
              <BookOpen className="h-4 w-4 text-sky-600" /> How it works
            </Link>
            <Link
              to="/contact"
              className="flex items-center gap-2 rounded-md p-2 hover:bg-secondary"
            >
              <CalendarCheck className="h-4 w-4 text-emerald-600" /> Book a meeting with us
            </Link>
            <Link
              to="/contact"
              className="flex items-center gap-2 rounded-md p-2 hover:bg-secondary"
            >
              <MessageCircle className="h-4 w-4 text-violet-600" /> Send us a message
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
