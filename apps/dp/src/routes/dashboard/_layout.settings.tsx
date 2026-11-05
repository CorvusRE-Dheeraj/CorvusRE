import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import {
  getMyProfile,
  updateMyProfile,
  updateNotificationPrefs,
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationPrefs,
} from "@/lib/profile";
import { Section, Field, inputCls, Loading } from "@/components/dp-ui";

export const Route = createFileRoute("/dashboard/_layout/settings")({
  head: () => ({ meta: [{ title: "Settings — CorvusDP" }] }),
  component: Settings,
});

const PREF_LABELS: [keyof NotificationPrefs, string][] = [
  ["email", "Email"],
  ["sms", "SMS"],
  ["in_app", "In-app notifications"],
  ["weekly", "Weekly project updates"],
  ["permit_status", "Permit status updates"],
];

function Settings() {
  const { user } = useAuth();
  const [form, setForm] = useState({ firstName: "", lastName: "", phone: "", companyName: "" });
  const [email, setEmail] = useState("");
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<"profile" | "prefs" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    getMyProfile(user.id)
      .then((p) => {
        setForm({
          firstName: p.firstName ?? "",
          lastName: p.lastName ?? "",
          phone: p.phone ?? "",
          companyName: p.companyName ?? "",
        });
        setEmail(p.email);
        setPrefs(p.notificationPrefs);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load profile."))
      .finally(() => setLoading(false));
  }, [user]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError(null);
    setSaved(null);
    try {
      await updateMyProfile(user.id, form);
      setSaved("profile");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    }
  }

  async function savePrefs(next: NotificationPrefs) {
    setPrefs(next);
    if (!user) return;
    try {
      await updateNotificationPrefs(user.id, next);
      setSaved("prefs");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    }
  }

  if (loading) return <Loading />;

  return (
    <div className="grid gap-5">
      <Section title="Profile">
        <form onSubmit={saveProfile} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name">
              <input
                className={inputCls}
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              />
            </Field>
            <Field label="Last name">
              <input
                className={inputCls}
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              />
            </Field>
            <Field label="Phone">
              <input
                className={inputCls}
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
            <Field label="Company">
              <input
                className={inputCls}
                value={form.companyName}
                onChange={(e) => setForm({ ...form, companyName: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Email">
            <input className={inputCls} value={email} disabled />
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {saved === "profile" && <p className="text-sm text-accent">Saved.</p>}
          <button className="btn-accent w-fit">Save changes</button>
        </form>
      </Section>

      <Section
        title="Notification preferences"
        subtitle="Email and in-app are both live; SMS is saved but not yet wired to a carrier."
      >
        <div className="grid gap-2 text-sm">
          {PREF_LABELS.map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={prefs[key]}
                onChange={(e) => savePrefs({ ...prefs, [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
        </div>
        {saved === "prefs" && <p className="mt-2 text-sm text-accent">Preferences saved.</p>}
      </Section>

      <Section
        title="Projects"
        subtitle="Open, rename, complete or delete your permitting and design projects."
        right={
          <Link to="/dashboard/projects" className="btn-outline text-sm">
            Manage projects
          </Link>
        }
      >
        <p className="text-sm text-muted-foreground">
          Your projects now have their own page — also in the account menu under Projects.
        </p>
      </Section>
    </div>
  );
}
