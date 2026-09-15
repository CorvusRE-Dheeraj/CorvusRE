import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Phone } from "lucide-react";
import { Field, inputCls, Section } from "@/components/dp-ui";
import { sendInquiry } from "@/lib/inquiries";
import { CONTACT_PHONES } from "@/lib/contact-info";

export const Route = createFileRoute("/contact")({
  head: () => ({ meta: [{ title: "Contact — CorvusDP" }] }),
  component: Contact,
});

function Contact() {
  const [form, setForm] = useState({ name: "", email: "", company: "", message: "" });
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    try {
      await sendInquiry({
        kind: "contact",
        name: form.name,
        email: form.email,
        company: form.company || undefined,
        message: form.message,
      });
      setStatus("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div className="container-page py-16 max-w-xl">
        <span className="badge-soft">Sent</span>
        <h1 className="mt-3 font-serif text-3xl font-semibold">Thanks — we'll be in touch.</h1>
        <p className="mt-2 text-muted-foreground">
          We reply to most messages within one business day.
        </p>
        <CallUsPanel className="mt-6" />
      </div>
    );
  }

  return (
    <div className="container-page py-12 max-w-xl">
      <span className="badge-soft">Contact</span>
      <h1 className="mt-3 font-serif text-3xl font-semibold">Talk to CorvusDP</h1>
      <p className="mt-2 text-muted-foreground">
        Questions about a project, a jurisdiction, or a managed engagement.
      </p>
      <CallUsPanel className="mt-6" />
      <form onSubmit={submit} className="mt-6">
        <Section title="Message">
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" required>
                <input
                  required
                  className={inputCls}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>
              <Field label="Email" required>
                <input
                  required
                  type="email"
                  className={inputCls}
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Company">
              <input
                className={inputCls}
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
              />
            </Field>
            <Field label="How can we help?" required>
              <textarea
                required
                rows={4}
                className={inputCls}
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
              />
            </Field>
          </div>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          <button className="btn-accent mt-5 disabled:opacity-60" disabled={status === "sending"}>
            {status === "sending" ? "Sending…" : "Send message"}
          </button>
        </Section>
      </form>
    </div>
  );
}

function CallUsPanel({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-6 gap-y-2 ${className}`}>
      {CONTACT_PHONES.map((p) => (
        <a
          key={p.href}
          href={p.href}
          className="flex items-center gap-2 text-sm font-medium text-foreground transition-colors hover:text-accent"
        >
          <Phone className="h-4 w-4 text-accent" aria-hidden />
          {p.display}
        </a>
      ))}
    </div>
  );
}
