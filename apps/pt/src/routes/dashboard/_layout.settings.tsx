import { TextSizeControl } from "@/components/TextSizeControl";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import {
  getMyProfile,
  updateMyProfile,
  updateNotificationPrefs,
  deleteMyAccount,
  DEFAULT_NOTIFICATION_PREFS,
  DEADLINE_REMINDER_OFFSETS,
  type NotificationPrefs,
} from "@/lib/profile";
import {
  setAllEvidenceReminderFrequency,
  type ReminderFrequency,
} from "@/lib/protest-form-submissions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { PageHero } from "@/components/PageHero";
import { Settings as HeroSettingsIcon } from "lucide-react";
import { PageSkeleton } from "@/components/PageSkeleton";

export const Route = createFileRoute("/dashboard/_layout/settings")({
  component: Settings,
});

function Settings() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPrefs>(
    DEFAULT_NOTIFICATION_PREFS,
  );
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    if (!user) return;
    getMyProfile(user.id)
      .then((p) => {
        setEmail(p.email);
        setFirstName(p.firstName ?? "");
        setLastName(p.lastName ?? "");
        setPhone(p.phone ?? "");
        setCompanyName(p.companyName ?? "");
        setNotificationPrefs(p.notificationPrefs);
      })
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : "Could not load your profile."),
      )
      .finally(() => setLoading(false));
  }, [user]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    try {
      await updateMyProfile(user.id, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || null,
        companyName: companyName.trim() || null,
      });
      toast.success("Profile updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save your profile.");
    } finally {
      setSaving(false);
    }
  }

  // Applies immediately to every existing case, not just future ones — a
  // customer switching to Weekly (or Off) means it right now, not "starting
  // with my next case." The same switch this email's own unsubscribe link
  // flips (see supabase/pt/functions/unsubscribe-evidence-reminders).
  async function handleReminderFrequencyChange(frequency: ReminderFrequency) {
    if (!user) return;
    const prev = notificationPrefs;
    setNotificationPrefs({ ...prev, evidenceReminders: frequency });
    setSavingPrefs(true);
    try {
      await updateNotificationPrefs(user.id, { evidenceReminders: frequency });
      await setAllEvidenceReminderFrequency(user.id, frequency);
      toast.success("Notification preferences updated.");
    } catch (err) {
      setNotificationPrefs(prev);
      toast.error(err instanceof Error ? err.message : "Could not save your preference.");
    } finally {
      setSavingPrefs(false);
    }
  }

  // Every protest deadline, ARB hearing, tax date, and personal reminder —
  // see send-deadline-reminders. SMS can't actually be turned on without a
  // phone number on file (checked here, not just disabled in the JSX, since
  // the checkbox's own onChange is the only path that sets it true).
  async function handleHourAlertChange(value: boolean) {
    if (!user) return;
    const prev = notificationPrefs;
    setNotificationPrefs({ ...prev, deadlineHourAlert: value });
    setSavingPrefs(true);
    try {
      await updateNotificationPrefs(user.id, { deadlineHourAlert: value });
      toast.success("Notification preferences updated.");
    } catch (err) {
      setNotificationPrefs(prev);
      toast.error(err instanceof Error ? err.message : "Could not save your preference.");
    } finally {
      setSavingPrefs(false);
    }
  }

  async function handleDeadlineReminderChange(channel: "email" | "sms", value: boolean) {
    if (!user) return;
    if (channel === "sms" && value && !phone.trim()) {
      toast.error("Add a phone number above first, then turn on SMS reminders.");
      return;
    }
    const prev = notificationPrefs;
    const next =
      channel === "email"
        ? { ...prev, deadlineRemindersEmail: value }
        : { ...prev, deadlineRemindersSms: value };
    setNotificationPrefs(next);
    setSavingPrefs(true);
    try {
      await updateNotificationPrefs(
        user.id,
        channel === "email" ? { deadlineRemindersEmail: value } : { deadlineRemindersSms: value },
      );
      toast.success("Notification preferences updated.");
    } catch (err) {
      setNotificationPrefs(prev);
      toast.error(err instanceof Error ? err.message : "Could not save your preference.");
    } finally {
      setSavingPrefs(false);
    }
  }

  // Which of the 30/15/7/3/2/0-days-out points to actually fire at, across
  // whichever channel(s) are on above — unrelated to email/sms themselves,
  // so this can be toggled even with both channels off (it'll just have
  // nothing to apply to until one's turned back on).
  async function handleReminderOffsetToggle(offset: number, checked: boolean) {
    if (!user) return;
    const prev = notificationPrefs;
    const nextOffsets = checked
      ? [...prev.deadlineReminderOffsets, offset].sort((a, b) => b - a)
      : prev.deadlineReminderOffsets.filter((o) => o !== offset);
    setNotificationPrefs({ ...prev, deadlineReminderOffsets: nextOffsets });
    setSavingPrefs(true);
    try {
      await updateNotificationPrefs(user.id, { deadlineReminderOffsets: nextOffsets });
      toast.success("Notification preferences updated.");
    } catch (err) {
      setNotificationPrefs(prev);
      toast.error(err instanceof Error ? err.message : "Could not save your preference.");
    } finally {
      setSavingPrefs(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!user?.email) return;
    if (newPassword !== confirmNewPassword) {
      toast.error("New passwords don't match.");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }
    setChangingPassword(true);
    try {
      // Supabase's updateUser() doesn't require the current password by
      // default, so re-verify it here first — otherwise anyone with a
      // left-open or hijacked session could lock the real owner out just by
      // setting a new password without ever knowing the old one.
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (reauthError) throw new Error("Current password is incorrect.");
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;
      toast.success("Password updated.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update your password.");
    } finally {
      setChangingPassword(false);
    }
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    try {
      await deleteMyAccount();
      // Navigate away from /dashboard/* and WAIT for it to finish before signing
      // out — otherwise the dashboard layout's own "no user -> /sign-in" guard,
      // still mounted while this promise is in flight, reacts to the auth state
      // change first and wins the race to /sign-in instead of landing on "/".
      await nav({ to: "/" });
      await supabase.auth.signOut();
      toast.success("Your account has been deleted.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete your account.");
      setDeleting(false);
    }
  }

  return (
    // Centered, not left-stuck — every card below used to carry its own
    // independent max-w-xl with no mx-auto, which left a form-width column
    // pinned to the left edge and a large dead zone of empty space on wider
    // screens. One shared max-w here, centered once, makes every card line
    // up to the same width and the whole page read as one balanced column.
    <div className="mx-auto max-w-2xl">
      <PageHero
        icon={HeroSettingsIcon}
        title="Settings"
        tone="slate"
        subtitle="Update your name, contact details and preferences."
      />

      {loading ? (
        <PageSkeleton rows={2} />
      ) : (
        <form onSubmit={handleSave} className="mt-6 card-elev p-6 grid gap-4">
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">Email</span>
            <input
              disabled
              value={email}
              className="mt-1 w-full rounded-md border border-input bg-secondary/40 px-3 py-2 text-sm text-muted-foreground"
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                First name<span className="text-destructive"> *</span>
              </span>
              <input
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                Last name<span className="text-destructive"> *</span>
              </span>
              <input
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
          </div>
          <label className="grid gap-1">
            {/* Optional here too, matching sign-up's own "(optional)" phone
                field — this was marked required, which blocked saving ANY
                profile edit (even just fixing a typo in your name) for any
                account that signed up without a phone, since sign-up itself
                never requires one. */}
            <span className="text-xs font-medium text-muted-foreground">
              Phone <span className="font-normal">(optional)</span>
            </span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              Company name (optional)
            </span>
            <input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="btn-primary btn-primary-hover w-fit disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </form>
      )}

      {!loading && (
        <form onSubmit={handleChangePassword} className="mt-8 card-elev p-6 grid gap-4">
          <div>
            <h2 className="font-semibold">Change Password</h2>
            <p className="text-sm text-muted-foreground">Update the password you sign in with.</p>
          </div>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              Current password<span className="text-destructive"> *</span>
            </span>
            <input
              required
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                New password<span className="text-destructive"> *</span>
              </span>
              <input
                required
                type="password"
                minLength={6}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                Confirm new password<span className="text-destructive"> *</span>
              </span>
              <input
                required
                type="password"
                minLength={6}
                autoComplete="new-password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={changingPassword}
            className="btn-primary btn-primary-hover w-fit disabled:opacity-60"
          >
            {changingPassword ? "Updating…" : "Update Password"}
          </button>
        </form>
      )}

      {!loading && <TextSizeControl />}

      {!loading && (
        <div className="mt-8 card-elev p-6">
          <h2 className="font-semibold">Notification Preferences</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            How often you get reminded when a case still needs evidence submitted. Applies across
            every property and BPP account, right away.
          </p>
          <label className="mt-4 grid gap-1 max-w-xs">
            <span className="text-xs font-medium text-muted-foreground">Evidence reminders</span>
            <select
              value={notificationPrefs.evidenceReminders}
              disabled={savingPrefs}
              onChange={(e) => handleReminderFrequencyChange(e.target.value as ReminderFrequency)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="off">Off</option>
            </select>
          </label>
        </div>
      )}

      {!loading && (
        <div className="mt-8 card-elev p-6">
          <h2 className="font-semibold">Deadline &amp; Hearing Reminders</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every protest deadline, ARB hearing, informal review, tax date, and personal reminder on
            your Calendar gets a reminder 30, 15, 7, 3, and 2 days before, and the day of, by
            whichever channel(s) you turn on below — all six are on by default, but you can turn any
            of them off. You also get a short alert about an hour before a hearing or informal
            review starts, and an hour before a deadline day closes (5 PM Central).
          </p>
          <div className="mt-4 grid gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={notificationPrefs.deadlineRemindersEmail}
                disabled={savingPrefs}
                onChange={(e) => handleDeadlineReminderChange("email", e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Email reminders
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={notificationPrefs.deadlineRemindersSms}
                disabled
                onChange={(e) => handleDeadlineReminderChange("sms", e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              SMS reminders
              <span className="text-xs">— coming soon</span>
            </label>
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={notificationPrefs.deadlineHourAlert}
              disabled={savingPrefs}
              onChange={(e) => handleHourAlertChange(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            Alert me about an hour before (email and on-screen)
          </label>
          <p className="mt-5 text-xs font-medium text-muted-foreground">When to remind me</p>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            {DEADLINE_REMINDER_OFFSETS.map((offset) => (
              <label key={offset} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={notificationPrefs.deadlineReminderOffsets.includes(offset)}
                  disabled={savingPrefs}
                  onChange={(e) => handleReminderOffsetToggle(offset, e.target.checked)}
                  className="h-4 w-4 rounded border-input"
                />
                {offset === 0 ? "Day of" : `${offset} days before`}
              </label>
            ))}
          </div>
        </div>
      )}

      {!loading && (
        <div className="mt-8 card-elev p-6">
          <h2 className="font-semibold">Legal</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The documents you accepted when creating your account.
          </p>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <Link
              to="/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline underline-offset-2"
            >
              Terms of Service
            </Link>
            <Link
              to="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline underline-offset-2"
            >
              Privacy Policy
            </Link>
          </div>
        </div>
      )}

      {!loading && (
        <div className="mt-8 card-elev border-destructive/30 p-6">
          <h2 className="font-semibold text-destructive">Danger Zone</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Permanently delete your account and everything under it — properties, BPP accounts,
            documents, and protest history. This cannot be undone.
          </p>
          <button
            onClick={() => setDeleteOpen(true)}
            className="btn-outline mt-4 border-destructive/40 text-destructive hover:bg-destructive/10"
          >
            Delete Account
          </button>
        </div>
      )}

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setDeleteConfirmText("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This permanently deletes your account, every property, BPP account, document, and
              protest case on file. There is no way to recover this data afterward.
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              Type DELETE to confirm
            </span>
            <input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              autoFocus
            />
          </label>
          <div className="mt-2 flex justify-end gap-2">
            <button onClick={() => setDeleteOpen(false)} className="btn-outline">
              Cancel
            </button>
            <button
              disabled={deleteConfirmText !== "DELETE" || deleting}
              onClick={handleDeleteAccount}
              className="btn-primary bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Permanently Delete Account"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
