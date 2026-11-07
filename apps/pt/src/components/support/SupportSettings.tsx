import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/error-message";
import {
  listDiscountPolicies,
  listKnowledge,
  listPermissions,
  listTeam,
  listTemplates,
  saveDiscountPolicy,
  saveKnowledge,
  saveTemplate,
  setPermission,
  setSupervisor,
  type DiscountPolicy,
  type KnowledgeEntry,
  type SupportPermission,
  type SupportTemplate,
  type TeamMember,
} from "@/lib/support-console";

const input = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";

// Super Admin only: what Support may do, who supervises, and the approved
// content the AI and the emails use.
export function SupportSettings() {
  const [perms, setPerms] = useState<SupportPermission[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [kb, setKb] = useState<KnowledgeEntry[]>([]);
  const [tpls, setTpls] = useState<SupportTemplate[]>([]);
  const [policies, setPolicies] = useState<DiscountPolicy[]>([]);
  const load = useCallback(() => {
    const err = (e: unknown) => toast.error(getErrorMessage(e, "Couldn't load settings."));
    listPermissions().then(setPerms).catch(err);
    listTeam().then(setTeam).catch(err);
    listKnowledge().then(setKb).catch(err);
    listTemplates().then(setTpls).catch(err);
    listDiscountPolicies().then(setPolicies).catch(err);
  }, []);
  useEffect(() => load(), [load]);
  const run = (p: Promise<unknown>, ok: string) =>
    p
      .then(() => (toast.success(ok), load()))
      .catch((e) => toast.error(getErrorMessage(e, "Couldn't save.")));

  return (
    <div className="mt-6 grid gap-4">
      <section className="card-elev p-5">
        <h3 className="font-semibold">What Support may do</h3>
        <p className="text-xs text-muted-foreground">
          Refunds, pricing exceptions and subscription-term overrides always need a Super Admin
          approval. Full card details are never shown.
        </p>
        <ul className="mt-3 grid gap-3">
          {perms.map((p) => (
            <li key={p.key} className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-medium">{p.label}</div>
                <div className="text-xs text-muted-foreground">{p.description}</div>
              </div>
              <label className="flex shrink-0 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={p.enabled}
                  onChange={(e) => void run(setPermission(p.key, e.target.checked), "Saved")}
                />
                {p.enabled ? "On" : "Off"}
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section className="card-elev p-5">
        <h3 className="font-semibold">Supervisors</h3>
        <p className="text-xs text-muted-foreground">
          Supervisors see the whole team&apos;s workload and numbers, assign work and export
          reports. Give someone the Customer Support Admin role first (Admin → Users).
        </p>
        <ul className="mt-3 grid gap-2 text-sm">
          {team
            .filter((m) => !m.superAdmin)
            .map((m) => (
              <li key={m.id} className="flex items-center justify-between">
                {m.name}
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={m.supervisor}
                    onChange={(e) => void run(setSupervisor(m.id, e.target.checked), "Saved")}
                  />
                  Supervisor
                </label>
              </li>
            ))}
          {team.filter((m) => !m.superAdmin).length === 0 && (
            <li className="text-muted-foreground">No Support Admins yet.</li>
          )}
        </ul>
      </section>

      <Editable
        title="Knowledge base (the AI answers only from this)"
        items={kb.map((k) => ({ id: k.id, a: k.title, b: k.body, tag: k.kind, active: k.active }))}
        tags={["faq", "instruction", "policy"]}
        labels={{ a: "Title", b: "Text", tag: "Kind", active: "Active" }}
        onSave={(x) =>
          run(
            saveKnowledge({
              id: x.id,
              title: x.a,
              body: x.b,
              kind: x.tag as KnowledgeEntry["kind"],
              active: x.active,
            }),
            "Saved",
          )
        }
      />

      <Editable
        title="Approved email templates"
        hint="Placeholders: {{first_name}} {{next_step}} {{property_address}} {{issue}} {{link}} {{ticket}}. Only approved templates can be sent."
        items={tpls.map((t) => ({
          id: t.id,
          a: t.name,
          b: t.body,
          c: t.subject,
          tag: t.purpose,
          active: t.approved,
        }))}
        tags={[
          "onboarding",
          "documents",
          "correction",
          "billing",
          "acknowledgement",
          "resolved",
          "other",
        ]}
        labels={{ a: "Name", b: "Body", c: "Subject", tag: "Purpose", active: "Approved" }}
        onSave={(x) =>
          run(
            saveTemplate({
              id: x.id,
              name: x.a,
              body: x.b,
              subject: x.c ?? "",
              purpose: x.tag as SupportTemplate["purpose"],
              approved: x.active,
            }),
            "Saved",
          )
        }
      />

      <Editable
        title="Approved discount policies"
        hint="Each is a Stripe coupon Support may apply when “Apply approved discounts” is on."
        items={policies.map((p) => ({
          id: p.id,
          a: p.label,
          b: p.description ?? "",
          c: p.stripe_coupon_id,
          active: p.active,
        }))}
        labels={{ a: "Label", b: "When it applies", c: "Stripe coupon id", active: "Active" }}
        onSave={(x) =>
          run(
            saveDiscountPolicy({
              id: x.id,
              label: x.a,
              description: x.b,
              stripe_coupon_id: x.c ?? "",
              active: x.active,
            }),
            "Saved",
          )
        }
      />
    </div>
  );
}

type Item = { id?: string; a: string; b: string; c?: string; tag?: string; active: boolean };

function Editable({
  title,
  hint,
  items,
  tags,
  labels,
  onSave,
}: {
  title: string;
  hint?: string;
  items: Item[];
  tags?: string[];
  labels: { a: string; b: string; c?: string; tag?: string; active: string };
  onSave: (x: Item) => Promise<unknown>;
}) {
  const [edit, setEdit] = useState<Item | null>(null);
  return (
    <section className="card-elev p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        <button
          type="button"
          className="btn-outline text-xs"
          onClick={() => setEdit({ a: "", b: "", c: "", tag: tags?.[0], active: true })}
        >
          Add
        </button>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <ul className="mt-3 grid gap-1 text-sm">
        {items.map((x) => (
          <li key={x.id} className="flex items-center justify-between gap-2">
            <span>
              {x.tag && (
                <span className="mr-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase">
                  {x.tag}
                </span>
              )}
              {x.a}
              {!x.active && (
                <span className="ml-1 text-xs text-muted-foreground">
                  ({labels.active.toLowerCase()}: no)
                </span>
              )}
            </span>
            <button
              type="button"
              className="text-xs text-accent underline"
              onClick={() => setEdit(x)}
            >
              Edit
            </button>
          </li>
        ))}
      </ul>
      {edit && (
        <div className="mt-3 grid gap-2 rounded-md border border-border p-3 text-sm">
          <input
            className={input}
            placeholder={labels.a}
            value={edit.a}
            onChange={(e) => setEdit({ ...edit, a: e.target.value })}
            aria-label={labels.a}
          />
          {labels.c && (
            <input
              className={input}
              placeholder={labels.c}
              value={edit.c ?? ""}
              onChange={(e) => setEdit({ ...edit, c: e.target.value })}
              aria-label={labels.c}
            />
          )}
          {tags && (
            <select
              className={input}
              value={edit.tag}
              onChange={(e) => setEdit({ ...edit, tag: e.target.value })}
              aria-label={labels.tag}
            >
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
          <textarea
            className={`${input} min-h-[100px]`}
            placeholder={labels.b}
            value={edit.b}
            onChange={(e) => setEdit({ ...edit, b: e.target.value })}
            aria-label={labels.b}
          />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={edit.active}
              onChange={(e) => setEdit({ ...edit, active: e.target.checked })}
            />{" "}
            {labels.active}
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-accent text-xs"
              disabled={!edit.a.trim() || !edit.b.trim()}
              onClick={() => void onSave(edit).then(() => setEdit(null))}
            >
              Save
            </button>
            <button type="button" className="btn-outline text-xs" onClick={() => setEdit(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
