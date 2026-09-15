import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Phone } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getMyProfile } from "@/lib/profile";
import { notifyStaff } from "@/lib/staff-notification";
import { ScrollReveal } from "@/components/ScrollReveal";

const PHONE_DISPLAY = "(469) 501-9362";
const PHONE_TEL = "+14695019362";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact Us — CorvusPT" },
      {
        name: "description",
        content: "Talk to CorvusPT about your Texas property tax questions.",
      },
      { property: "og:title", content: "Contact CorvusPT" },
      { property: "og:description", content: "Reach the CorvusPT property tax team." },
    ],
  }),
  component: Contact,
});

function Contact() {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Signed-in users already have a name/email on file — asking for it again
  // on the contact form is redundant. `null` while unresolved (still
  // loading, or not signed in) means "show the fields"; once loaded, the
  // fields are skipped and this is used to fill the submission instead.
  const [knownContact, setKnownContact] = useState<{ name: string; email: string } | null>(null);

  useEffect(() => {
    if (!user) {
      setKnownContact(null);
      return;
    }
    getMyProfile(user.id)
      .then((profile) => {
        const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
        setKnownContact({ name: fullName, email: profile.email || user.email || "" });
      })
      .catch((err) => {
        // Falls back to showing the fields (same as signed-out) rather than
        // blocking the form on a failed profile fetch.
        console.error("Could not load your profile for the contact form:", err);
      });
  }, [user]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      const contactName = knownContact?.name || name;
      const contactEmail = knownContact?.email || email;
      await notifyStaff({
        subject: "New CorvusPT.ai contact form submission",
        replyToEmail: contactEmail,
        replyToName: contactName || undefined,
        message: `${message}\n\nFrom: ${contactName || "(no name given)"} <${contactEmail}>`,
      });
      setSent(true);
      toast.success("Message sent.");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not send your message. Please try again.";
      setError(message);
      toast.error(message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <div className="container-page pt-16 max-w-2xl">
        <span className="badge-soft">Contact</span>
        <h1 className="mt-3 text-4xl md:text-5xl font-semibold">Talk to a human.</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Managed protests, portfolios, and BPP for multiple entities — we'll help you get started.
        </p>
      </div>

      <div className="container-page pb-16 max-w-2xl">
        <ScrollReveal>
          <a
            href={`tel:${PHONE_TEL}`}
            className="card-elev mb-8 flex items-center justify-between gap-4 p-6 transition-all hover:-translate-y-0.5 hover:shadow-elev"
          >
            <div className="flex items-center gap-4">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/15 text-accent">
                <Phone className="h-5 w-5" />
              </span>
              <div>
                <h3 className="font-semibold">Prefer to talk now?</h3>
                <p className="text-sm text-muted-foreground">Call us at {PHONE_DISPLAY}</p>
              </div>
            </div>
            <span className="btn-primary btn-primary-hover shrink-0">Call us</span>
          </a>
        </ScrollReveal>
        {sent ? (
          <div className="mt-8 card-elev p-6">
            <h3 className="font-semibold text-lg">Thanks — we'll be in touch.</h3>
            <p className="text-muted-foreground mt-1">
              A CorvusPT specialist will reach out within one business day.
            </p>
          </div>
        ) : (
          <ScrollReveal delay={100} className="mt-8">
            <form onSubmit={onSubmit} className="grid gap-4">
              {knownContact ? (
                <p className="text-sm text-muted-foreground">
                  Contacting as{" "}
                  <span className="font-medium text-foreground">
                    {knownContact.name || knownContact.email}
                  </span>
                  {knownContact.name && ` (${knownContact.email})`}.
                </p>
              ) : (
                <>
                  <label className="grid gap-1 text-sm">
                    <span className="font-medium">
                      Name<span className="text-destructive"> *</span>
                    </span>
                    <input
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="rounded-md border border-input bg-background px-3 py-2"
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span className="font-medium">
                      Email<span className="text-destructive"> *</span>
                    </span>
                    <input
                      required
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="rounded-md border border-input bg-background px-3 py-2"
                    />
                  </label>
                </>
              )}
              <label className="grid gap-1 text-sm">
                <span className="font-medium">
                  How can we help?<span className="text-destructive"> *</span>
                </span>
                <textarea
                  rows={5}
                  required
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="rounded-md border border-input bg-background px-3 py-2"
                />
              </label>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <button
                disabled={sending}
                className="btn-primary btn-primary-hover w-fit disabled:opacity-60"
              >
                {sending ? "Sending…" : "Send message"}
              </button>
            </form>
          </ScrollReveal>
        )}
      </div>
    </div>
  );
}
