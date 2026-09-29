import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Sparkles, X, Send, Mic, Volume2, VolumeX, Phone, Mail } from "lucide-react";
import { toast } from "sonner";
import { askRouter } from "@/lib/ask-router";
import { askAboutDocument } from "@/lib/document-ai";
import { buildUserContext } from "@/lib/ai-context";
import { useAuth } from "@/lib/auth";
import { useSpeechInput } from "@/hooks/use-speech-input";
import { useSpeechOutput } from "@/hooks/use-speech-output";
import { listProperties } from "@/lib/properties";
import { looksLikeReminderRequest, parseReminderRequest, addReminder } from "@/lib/reminders";
import { notifyStaff } from "@/lib/staff-notification";
import { createSupportEscalation, type TranscriptTurn } from "@/lib/support-escalations";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { MarkdownLite } from "@/components/MarkdownLite";
import { getErrorMessage } from "@/lib/error-message";

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  destination?: string | null;
  image?: { src: string; alt: string; caption: string };
};

// A different first name each session, so the bot reads as one particular
// support associate rather than a generic "AI" — reused for every answer
// this session so it doesn't change mid-conversation.
const ASSOCIATE_NAMES = ["Jordan", "Riley", "Casey", "Morgan", "Taylor", "Avery", "Sam", "Drew"];
const ASSOCIATE_NAME_KEY = "corvuspt.supportAssociateName";

function pickAssociateName(): string {
  try {
    const saved = sessionStorage.getItem(ASSOCIATE_NAME_KEY);
    if (saved && ASSOCIATE_NAMES.includes(saved)) return saved;
  } catch {
    // storage blocked — fine, just picks fresh below
  }
  const name = ASSOCIATE_NAMES[Math.floor(Math.random() * ASSOCIATE_NAMES.length)];
  try {
    sessionStorage.setItem(ASSOCIATE_NAME_KEY, name);
  } catch {
    // storage blocked — the name just won't be remembered on reopen
  }
  return name;
}

// The address every "Email us" answer gives out — the same inbox the /contact
// form and every staff notification already land in (staff-notification.ts'
// STAFF_EMAIL). One real, monitored inbox, not a new alias nobody reads yet.
const SUPPORT_EMAIL = "properties@srclandbuilding.com";

// A handful of common "how do I…" questions get a real screenshot of exactly
// where to click, on top of whatever the AI says — matched against the
// user's own question text, not the AI's answer, so it's exact and doesn't
// depend on the model mentioning the right page. Deliberately small: only
// topics worth a dedicated image, not a substitute for the AI answer itself.
const SUPPORT_TOPICS: { match: RegExp; image: string; alt: string; caption: string }[] = [
  {
    match: /\badd(ing)?\s+(a\s+|another\s+)?propert(y|ies)\b|\bnew\s+propert(y|ies)\b/i,
    image: "add-property.png",
    alt: "The Add another property button on the Properties page",
    caption: "Here's where to add one:",
  },
  {
    match: /\bupload(ing)?\b.*\b(notice|document|evidence|file)s?\b|\b(notice|document)s?\b.*\bupload/i,
    image: "upload-documents.png",
    alt: "The document upload area",
    caption: "Here's where to upload it:",
  },
  {
    match: /\bfile\b.*\bprotest\b|\bstart\b.*\bprotest\b|\bhow\s+do\s+i\s+protest\b|\bprotest\s+my\s+propert/i,
    image: "file-protest.png",
    alt: "The Protest My Property button",
    caption: "Here's where to start a protest:",
  },
  {
    match: /\bcase\s+status\b|\bview\s+(my\s+)?case\b|\bwhere.{0,15}\bmy\s+(case|protest)\b|\btrack\b.*\b(case|protest)\b/i,
    image: "view-case.png",
    alt: "The View Case button on a property's row",
    caption: "Here's where to check it:",
  },
];

function findSupportTopic(question: string): ChatMessage["image"] {
  const t = SUPPORT_TOPICS.find((t) => t.match.test(question));
  if (!t) return undefined;
  return { src: `${import.meta.env.BASE_URL}support/${t.image}`, alt: t.alt, caption: t.caption };
}

// Floating, site-wide chat that actually answers questions (via the same
// Gemini-backed answer engine used in document-review's "Ask AI" modal), with a
// "Continue to X" link from route-intent attached to each answer. A signed-in
// user's own properties/protests are included as context, and prior turns in
// this conversation are folded into that same context string so follow-up
// questions ("what about the second one?") resolve correctly — there's no
// separate multi-turn API, ask-about-document just sees the running transcript.
//
// This is also CorvusPT's front line of customer support until there's a
// real support team: it answers in a warm, first-person "support associate"
// voice (see personaName below and ask-about-document's SUPPORT_STYLE), and
// once someone's had at least one answer, offers a real escalation — a call
// (reported to staff, a real support_escalations row + notifyStaff) or the
// support email — rather than leaving them stuck with just the AI.
export function AskAiWidget() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [asking, setAsking] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [associateName] = useState(pickAssociateName);
  const [escalated, setEscalated] = useState<"call" | "email" | null>(null);
  const [escalating, setEscalating] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Read the answer aloud. On when the toggle is on, or (either way) when
  // the question was just asked by voice — so a spoken question gets a
  // spoken answer without a separate opt-in.
  const tts = useSpeechOutput();
  const askedByVoice = useRef(false);
  function maybeSpeak(text: string) {
    if (tts.enabled || askedByVoice.current) tts.speak(text);
  }
  // Voice input — fills the box as you speak, then auto-sends when you stop
  // talking so a spoken question is fully hands-free.
  const speech = useSpeechInput(setQuery, {
    onFinal: (text) => {
      askedByVoice.current = true;
      void runSubmit(text);
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, asking]);

  function reset() {
    setQuery("");
    setMessages([]);
    setAsking(false);
    setEscalated(null);
  }

  function close() {
    setOpen(false);
    reset();
    tts.cancel();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void runSubmit(query);
  }

  async function runSubmit(raw: string) {
    const q = raw.trim();
    if (!q || asking) return;
    setQuery("");
    setMessages((prev) => [...prev, { role: "user", text: q }]);
    setAsking(true);
    try {
      // "remind me to …" / "save this date" → create a real reminder that
      // shows on the Calendar, instead of just answering. Only spends the
      // parse call when the message actually looks like one.
      if (user && looksLikeReminderRequest(q)) {
        try {
          const props = await listProperties(user.id).catch(() => []);
          const parsed = await parseReminderRequest(
            q,
            props.map((p) => ({ id: p.id, address: p.address })),
          );
          if (parsed.isReminder && parsed.remindOn) {
            await addReminder(user.id, {
              remindOn: parsed.remindOn,
              note: parsed.note || q,
              propertyId: parsed.propertyId,
              source: "assistant",
            });
            const when = new Date(`${parsed.remindOn}T00:00:00`).toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            });
            {
              const line = `Saved a reminder for ${when}: ${parsed.note || q}. It's on your Calendar.`;
              setMessages((prev) => [
                ...prev,
                { role: "assistant", text: line, destination: "/dashboard/calendar" },
              ]);
              maybeSpeak(line);
            }
            return;
          }
          if (parsed.isReminder && !parsed.remindOn) {
            const line = "I can save that reminder — what date should it be for?";
            setMessages((prev) => [...prev, { role: "assistant", text: line }]);
            maybeSpeak(line);
            return;
          }
        } catch {
          // Parsing/saving failed — fall through to a normal answer.
        }
      }

      const accountContext = user ? await buildUserContext(user.id).catch(() => "") : "";
      const transcript = messages
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`)
        .join("\n");
      const context = [accountContext, transcript].filter(Boolean).join("\n\n") || undefined;

      // personaName always on here — this widget IS the support bot, and its
      // own SUPPORT_STYLE already reads naturally whether typed or spoken, so
      // there's no separate "conversational" mode to choose on top of it.
      const [answerRes, routeRes] = await Promise.allSettled([
        askAboutDocument({ question: q, context, personaName: associateName }),
        askRouter(q),
      ]);
      const answer =
        answerRes.status === "fulfilled"
          ? answerRes.value.answer
          : "Sorry, I couldn't process that — mind trying again?";
      const destination = routeRes.status === "fulfilled" ? routeRes.value.destination : null;
      const image = findSupportTopic(q);
      setMessages((prev) => [...prev, { role: "assistant", text: answer, destination, image }]);
      maybeSpeak(answer);
    } finally {
      setAsking(false);
      askedByVoice.current = false;
    }
  }

  // "Still need help?" — offered once there's been at least one real answer,
  // so it never shows before the bot has actually tried to help. A "call"
  // escalation is a real, admin-visible ticket plus a staff email; "email"
  // just hands over the address (the DB row is best-effort tracking only —
  // the actual email comes from the user's own client with their own
  // attachments, so a failed write here must never block that answer).
  async function escalate(method: "call" | "email") {
    if (!user || escalating) return;
    setEscalating(true);
    try {
      const lastQuestion = [...messages].reverse().find((m) => m.role === "user")?.text ?? "";
      const transcript: TranscriptTurn[] = messages.map(({ role, text }) => ({ role, text }));
      if (method === "call") {
        await createSupportEscalation({
          userId: user.id,
          contactMethod: "call",
          summary: lastQuestion,
          transcript,
        });
        await notifyStaff({
          subject: "CorvusPT support escalation — call requested",
          message:
            `A user asked ${associateName} (Ask AI) to have support call them back.\n\n` +
            `User: ${user.email}\n\nConversation:\n` +
            transcript.map((t) => `${t.role === "user" ? "User" : associateName}: ${t.text}`).join("\n"),
          replyToEmail: user.email ?? undefined,
        }).catch(() => {
          // The DB row above is the real record either way — a notification
          // hiccup shouldn't make the widget claim the report failed.
        });
        const line =
          "I've reported this to our support team. Someone from the team will get back to you within 48 business hours.";
        setMessages((prev) => [...prev, { role: "assistant", text: line }]);
        maybeSpeak(line);
      } else {
        await createSupportEscalation({
          userId: user.id,
          contactMethod: "email",
          summary: lastQuestion,
          transcript,
        }).catch(() => {
          // Tracking only — the address still needs to be given either way.
        });
        const line = `You can reach us directly at ${SUPPORT_EMAIL} — just include a description of the issue and any relevant screenshots so the team can look into it.`;
        setMessages((prev) => [...prev, { role: "assistant", text: line }]);
        maybeSpeak(line);
      }
      setEscalated(method);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not reach support right now — please try again."));
    } finally {
      setEscalating(false);
    }
  }

  return (
    <div className="print:hidden fixed bottom-5 right-5 z-40">
      {open && (
        <div className="mb-3 w-96 max-w-[calc(100vw-2.5rem)] card-elev p-4 shadow-lg flex flex-col">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-medium text-sm">
              <Sparkles className="h-4 w-4 text-accent" />
              Ask AI — {associateName} from Support
            </div>
            <button
              onClick={close}
              aria-label="Close Ask AI"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {messages.length === 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Hi, I'm {associateName} from Corvus support 👋 What can I help you with — a
              question, or something not working right?
            </p>
          )}

          {messages.length > 0 && (
            <div ref={scrollRef} className="mt-3 max-h-80 overflow-y-auto grid gap-2 pr-1">
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div
                    key={i}
                    className="ml-auto max-w-[85%] rounded-md bg-accent text-accent-foreground px-3 py-2 text-sm"
                  >
                    {m.text}
                  </div>
                ) : (
                  <div
                    key={i}
                    className="mr-auto max-w-[90%] rounded-md bg-secondary/50 px-3 py-2 text-sm"
                  >
                    <MarkdownLite text={m.text} />
                    {m.image && (
                      <div className="mt-2">
                        <p className="text-xs font-medium text-muted-foreground">
                          {m.image.caption}
                        </p>
                        <img
                          src={m.image.src}
                          alt={m.image.alt}
                          className="mt-1 w-full rounded-md border border-border"
                        />
                      </div>
                    )}
                    {m.destination && (
                      <Link
                        to={m.destination}
                        onClick={close}
                        className="btn-primary btn-primary-hover mt-2 inline-flex text-xs py-1.5"
                      >
                        Continue to this page
                      </Link>
                    )}
                  </div>
                ),
              )}
              {asking && (
                <div className="mr-auto rounded-md bg-secondary/50 px-3 py-2 text-sm text-muted-foreground">
                  {associateName} is looking into that…
                </div>
              )}
              {user &&
                !asking &&
                !escalated &&
                messages.some((m) => m.role === "assistant") && (
                  <div className="mr-auto max-w-[90%] rounded-md border border-dashed border-border px-3 py-2 text-xs">
                    <p className="text-muted-foreground">Still stuck? I can get a real person on it.</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => void escalate("call")}
                        disabled={escalating}
                        className="btn-outline inline-flex items-center gap-1 py-1 text-xs disabled:opacity-60"
                      >
                        <Phone className="h-3 w-3" /> Talk to someone
                      </button>
                      <button
                        type="button"
                        onClick={() => void escalate("email")}
                        disabled={escalating}
                        className="btn-outline inline-flex items-center gap-1 py-1 text-xs disabled:opacity-60"
                      >
                        <Mail className="h-3 w-3" /> Email us
                      </button>
                    </div>
                  </div>
                )}
            </div>
          )}

          <form onSubmit={submit} className="mt-3 flex items-center gap-2">
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                askedByVoice.current = false;
              }}
              placeholder={
                speech.listening
                  ? "Listening…"
                  : messages.length === 0
                    ? "Describe the situation…"
                    : "Ask a follow-up…"
              }
              disabled={asking}
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the input only mounts when the user opens this on-demand chat panel, so focusing it is expected, not a surprise focus jump.
              autoFocus
              className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
            />
            {tts.supported && (
              <button
                type="button"
                onClick={() => {
                  if (tts.enabled || tts.speaking) {
                    tts.setEnabled(false);
                  } else {
                    tts.setEnabled(true);
                  }
                }}
                aria-label={tts.enabled ? "Turn off read-aloud" : "Read answers aloud"}
                title={tts.enabled ? "Read-aloud on" : "Read answers aloud"}
                className={`rounded-md px-2.5 py-1.5 transition-colors ${
                  tts.enabled
                    ? "bg-accent/15 text-accent"
                    : "border border-input text-muted-foreground hover:text-foreground"
                } ${tts.speaking ? "animate-pulse" : ""}`}
              >
                {tts.enabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </button>
            )}
            {speech.supported && (
              <button
                type="button"
                onClick={() => {
                  if (!speech.listening) askedByVoice.current = true;
                  speech.toggle();
                }}
                disabled={asking}
                aria-label={speech.listening ? "Stop listening" : "Speak your question"}
                title={speech.listening ? "Stop listening" : "Speak your question"}
                className={`rounded-md px-2.5 py-1.5 transition-colors disabled:opacity-50 ${
                  speech.listening
                    ? "bg-destructive/15 text-destructive animate-pulse"
                    : "border border-input text-muted-foreground hover:text-foreground"
                }`}
              >
                <Mic className="h-4 w-4" />
              </button>
            )}
            <button
              type="submit"
              disabled={asking || !query.trim()}
              aria-label="Send"
              className="btn-accent px-2.5 py-1.5 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close Ask AI" : "Open Ask AI"}
            className="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-violet-600 via-purple-700 to-indigo-700 text-white shadow-lg shadow-violet-700/25 transition-all hover:opacity-95 hover:scale-105 active:scale-95"
          >
            {open ? <X className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
          </button>
        </TooltipTrigger>
        {!open && <TooltipContent side="left">Ask AI anything</TooltipContent>}
      </Tooltip>
    </div>
  );
}
