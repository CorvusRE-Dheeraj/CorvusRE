import { useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { getErrorMessage } from "@/lib/error-message";
import { runRules, saveSettings, type MarketingData, type RuleMode } from "@/lib/marketing";
import { RULES, ruleMode } from "@/lib/marketing-crm";

const MODES: { value: RuleMode; label: string }[] = [
  { value: "auto", label: "Update automatically" },
  { value: "suggest", label: "Suggest — staff approve" },
  { value: "off", label: "Off" },
];

// The status rules Corvus AI may apply. Staff decide which run on their own,
// which only suggest, and which are off. Manual changes always win.
export function CrmRules({
  data,
  reload,
  onClose,
}: {
  data: MarketingData;
  reload: () => Promise<void>;
  onClose: () => void;
}) {
  const [rules, setRules] = useState<Record<string, RuleMode>>(
    Object.fromEntries(RULES.map((r) => [r.id, ruleMode(data.settings.rules, r.id)])),
  );
  const [days, setDays] = useState(data.settings.inactiveDays);
  const [notify, setNotify] = useState(data.settings.notifyEmail);
  const [busy, setBusy] = useState(false);

  return (
    <Modal onClose={onClose} wide>
      <form
        className="grid gap-4 p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await saveSettings({
              rules,
              inactiveDays: Math.min(90, Math.max(3, days)),
              notifyEmail: notify,
            });
            const n = await runRules();
            await reload();
            toast.success(
              `Rules saved${n ? ` — ${n} lead${n === 1 ? "" : "s"} updated or flagged` : ""}.`,
            );
            onClose();
          } catch (err) {
            toast.error(getErrorMessage(err, "Couldn't save the rules."));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div>
          <h2 className="font-serif text-xl font-semibold">Status rules</h2>
          <p className="text-sm text-muted-foreground">
            Applied on every Sync, after every send or logged outcome, and hourly. Staff can always
            change a status by hand.
          </p>
        </div>
        <ul className="grid gap-2">
          {RULES.map((r) => (
            <li
              key={r.id}
              className="grid items-center gap-2 rounded-md border border-border p-3 sm:grid-cols-[minmax(0,1fr)_13rem]"
            >
              <div>
                <div className="text-sm font-medium">{r.label}</div>
                <div className="text-xs text-muted-foreground">{r.detail}</div>
              </div>
              <select
                className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                aria-label={`Rule: ${r.label}`}
                value={rules[r.id]}
                onChange={(e) => setRules((x) => ({ ...x, [r.id]: e.target.value as RuleMode }))}
              >
                {MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">
              Quiet period (days) for “No Response” and “Going quiet”
            </span>
            <input
              type="number"
              min={3}
              max={90}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={days}
              onChange={(e) => setDays(Number(e.target.value) || 14)}
            />
          </label>
          <label className="flex items-center gap-2 self-end text-sm">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            Email assigned staff a daily digest of what needs them
          </label>
        </div>
        <p className="text-[11px] text-muted-foreground">
          * Account sign-ups and subscriptions always set Registered / Subscribed. Do Not Contact is
          only lifted by a person.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-outline text-sm">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="btn-primary btn-primary-hover text-sm disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save & run now"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
