import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BookOpen, Copy, Sparkles } from "lucide-react";
import { getErrorMessage } from "@/lib/error-message";
import {
  listKnowledge,
  listSupportCustomers,
  supportAction,
  type KnowledgeEntry,
  type SupportCustomer,
} from "@/lib/support-console";

type Answer = {
  answer?: string;
  customerDraft?: string | null;
  sources?: string[];
  escalate?: boolean;
  escalateTo?: string | null;
};

// Ask the AI anything about the platform, policies or one customer. It
// answers only from the approved knowledge base and what this staff member
// can see; a customer-facing draft is never sent from here.
export function SupportAiWorkspace({ initialProfileId }: { initialProfileId?: string | null }) {
  const [customers, setCustomers] = useState<SupportCustomer[]>([]);
  const [profileId, setProfileId] = useState(initialProfileId ?? "");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [kb, setKb] = useState<KnowledgeEntry[]>([]);
  useEffect(() => {
    listSupportCustomers()
      .then(setCustomers)
      .catch(() => setCustomers([]));
    listKnowledge()
      .then((k) => setKb(k.filter((x) => x.active)))
      .catch(() => setKb([]));
  }, []);
  async function ask() {
    setBusy(true);
    setAnswer(null);
    try {
      setAnswer(await supportAction<Answer>("ai_ask", { question, profileId: profileId || null }));
    } catch (e) {
      toast.error(getErrorMessage(e, "AI couldn't answer."));
    } finally {
      setBusy(false);
    }
  }
  const copy = (s: string) =>
    navigator.clipboard
      .writeText(s)
      .then(() => toast.success("Copied"))
      .catch(() => toast.error("Couldn't copy"));
  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="card-elev grid content-start gap-3 p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Sparkles className="h-4 w-4 text-accent" aria-hidden /> Ask Corvus AI
        </h2>
        <select
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={profileId}
          onChange={(e) => setProfileId(e.target.value)}
          aria-label="About a customer (optional)"
        >
          <option value="">General question (no customer)</option>
          {customers.map((c) => (
            <option key={c.profileId} value={c.profileId}>
              {c.name ?? c.email}
              {c.company ? ` — ${c.company}` : ""}
            </option>
          ))}
        </select>
        <textarea
          className="min-h-[110px] rounded-md border border-input bg-background px-3 py-2 text-sm"
          placeholder={
            'e.g. "Why can\'t this customer file yet?" or "How do I explain the 60-day notice?"'
          }
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          aria-label="Question"
        />
        <button
          type="button"
          className="btn-accent w-fit text-sm"
          disabled={busy || question.trim().length < 3}
          onClick={ask}
        >
          {busy ? "Thinking…" : "Ask"}
        </button>
        {answer && (
          <div className="grid gap-3 text-sm">
            <div className="rounded-md bg-accent/5 p-3">
              <p className="whitespace-pre-wrap">{answer.answer}</p>
              {!!answer.sources?.length && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Based on: {answer.sources.join(", ")}
                </p>
              )}
            </div>
            {answer.escalate && (
              <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">
                This needs specialist judgment — escalate to{" "}
                {answer.escalateTo?.replace(/_/g, " ") ?? "a specialist"}.
              </p>
            )}
            {answer.customerDraft && (
              <div className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
                  Draft for the customer — review before using
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-accent"
                    onClick={() => copy(answer.customerDraft!)}
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden /> Copy
                  </button>
                </div>
                <p className="mt-1 whitespace-pre-wrap">{answer.customerDraft}</p>
              </div>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          The AI answers only from the approved knowledge base and the customer data you can see.
          Nothing is sent to a customer from here — paste a draft into a ticket reply to review and
          send it.
        </p>
      </section>
      <aside className="card-elev p-5">
        <h3 className="flex items-center gap-2 font-semibold">
          <BookOpen className="h-4 w-4" aria-hidden /> Knowledge base
        </h3>
        <p className="text-xs text-muted-foreground">
          Approved FAQs, instructions and policies (Super Admins edit these).
        </p>
        <ul className="mt-3 grid gap-2 text-sm">
          {kb.map((k) => (
            <li key={k.id}>
              <details>
                <summary className="cursor-pointer">
                  <span className="mr-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase">
                    {k.kind}
                  </span>
                  {k.title}
                </summary>
                <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{k.body}</p>
              </details>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
