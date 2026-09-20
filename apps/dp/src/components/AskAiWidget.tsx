import { useEffect, useRef, useState } from "react";
import { Sparkles, X, Send, Loader2, Bot } from "lucide-react";
import { useActiveProjectBundle } from "@/hooks/use-project";
import { askAssistant, type AssistantProjectContext, type ChatMessage } from "@/lib/ai";
import { cn } from "@/lib/utils";
import { AskAiMicButton } from "@/components/AskAiMicButton";

// Site-wide chat entry point, mounted once at the root (see __root.tsx) so it
// survives client-side navigation and stays open across pages. On the public
// marketing pages it answers general permitting/design/construction
// questions; once a project exists (dashboard), it's grounded with a small,
// already-loaded summary of that real project — never a fresh DB query of
// its own (see src/lib/ai.ts). A plain fixed-position element (not a portal)
// is safe here since it's a direct sibling of <main>, outside every route's
// own transformed/overflow-clip containers.
const GREETING: ChatMessage = {
  role: "assistant",
  content:
    "Hi — I'm the CorvusDP Assistant. Ask me about permitting, design, or construction, or about your own project once you've run an analysis.",
};

export function AskAiWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { hasProject, project, bundle } = useActiveProjectBundle();

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, open, sending]);

  function buildContext(): AssistantProjectContext | undefined {
    if (!hasProject || !project) return undefined;
    return {
      track: project.track as AssistantProjectContext["track"],
      address: project.address ?? undefined,
      city: project.city ?? undefined,
      county: project.county ?? undefined,
      state: project.state ?? undefined,
      zoningCode: project.zoning ?? undefined,
      feasibilityStatus: project.feasibility_status ?? undefined,
      permitCount: bundle?.permits.length,
      permitNames: bundle?.permits.map((p) => p.name).slice(0, 20),
      complexityLevel: project.complexity_level ?? undefined,
      checklistProgress: bundle
        ? `${bundle.checklist.filter((c) => c.done).length}/${bundle.checklist.length} checklist items done`
        : undefined,
    };
  }

  async function send(override?: string) {
    const text = (override ?? input).trim();
    if (!text || sending) return;
    setError(null);
    setInput("");
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setSending(true);
    try {
      const reply = await askAssistant(next, buildContext());
      setMessages((cur) => [...cur, { role: "assistant", content: reply }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {open && (
        // Anchored directly to the viewport with an explicit width — not a
        // percentage of the toggle button below (see the fixed-position
        // sibling below): a shared flex-row wrapper around both elements
        // previously made this panel's "w-full" resolve against a container
        // that itself shrank to the button's tiny width, collapsing the
        // whole chat panel down to a sliver on anything narrower than a
        // desktop window. Two independent fixed elements have no such
        // ancestor to go wrong.
        //
        // Deliberately card-elev (opaque), not the decorative `glass`
        // treatment used on marketing pages: this floats over real
        // dashboard content (fee tables, permit statuses), and glass's
        // translucent background + blur let that content show through
        // right behind the assistant's own text, hurting legibility on
        // both. A functional overlay needs a solid background regardless
        // of what's behind it.
        <div
          role="dialog"
          aria-label="CorvusDP Assistant"
          className="card-elev fixed inset-x-4 bottom-20 z-50 flex max-h-[75vh] flex-col overflow-hidden sm:inset-x-auto sm:right-6 sm:bottom-24 sm:h-[28rem] sm:w-96"
        >
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 text-accent">
                <Bot className="h-4 w-4" />
              </span>
              <div>
                <div className="text-sm font-semibold leading-tight">CorvusDP Assistant</div>
                <div className="spec-label !text-[0.6rem]">
                  {hasProject ? "Grounded in your active project" : "General guidance"}
                </div>
              </div>
            </div>
            <button
              type="button"
              aria-label="Close assistant"
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div
            ref={listRef}
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3"
          >
            {messages.map((m, i) => (
              <div
                key={i}
                className={cn(
                  "max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed",
                  m.role === "user"
                    ? "ml-auto bg-accent text-accent-foreground"
                    : "mr-auto bg-secondary text-secondary-foreground",
                )}
              >
                {m.content}
              </div>
            ))}
            {sending && (
              <div className="mr-auto flex items-center gap-2 rounded-xl bg-secondary px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
              </div>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="flex items-center gap-2 border-t border-border/60 p-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about permits, design, or your project…"
              className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <AskAiMicButton
              onTranscript={setInput}
              onFinal={(text) => void send(text)}
              disabled={sending}
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              aria-label="Send"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground transition-transform disabled:opacity-50 enabled:hover:-translate-y-0.5"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Close CorvusDP Assistant" : "Open CorvusDP Assistant"}
        className="btn-accent fixed bottom-4 right-4 z-50 h-12 w-12 rounded-full !p-0 shadow-lg sm:bottom-6 sm:right-6 sm:h-14 sm:w-auto sm:rounded-full sm:!px-5"
      >
        {open ? <X className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
        <span className="hidden sm:inline">{open ? "Close" : "Ask AI"}</span>
      </button>
    </>
  );
}
