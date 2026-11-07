import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/error-message";
import {
  listTeam,
  listTemplates,
  saveTemplate,
  setBdSupervisor,
  KIND_LABEL,
  type OpportunityKind,
  type TeamMember,
  type Template,
} from "@/lib/bd-console";

const inp = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";

// Super Admin only: supervisors and the approved proposal templates (product
// description and subscription terms the proposals are built from).
export function BdSettings() {
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [tpls, setTpls] = useState<Template[]>([]);
  const [edit, setEdit] = useState<Partial<Template> | null>(null);
  const load = useCallback(() => {
    listTeam()
      .then(setTeam)
      .catch(() => setTeam([]));
    listTemplates()
      .then(setTpls)
      .catch(() => setTpls([]));
  }, []);
  useEffect(() => load(), [load]);
  return (
    <div className="mt-6 grid gap-4">
      <section className="card-elev p-5 text-sm">
        <h3 className="font-semibold">Supervisors</h3>
        <p className="text-xs text-muted-foreground">
          Supervisors assign accounts and work, see the whole team, export reports and verify a
          signed agreement copy. Give someone the Business Development Admin role first (Admin →
          Users → Staff access).
        </p>
        <ul className="mt-3 grid gap-2">
          {team
            .filter((m) => !m.superAdmin)
            .map((m) => (
              <li key={m.id} className="flex items-center justify-between">
                {m.name}
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={m.supervisor}
                    onChange={(e) =>
                      setBdSupervisor(m.id, e.target.checked)
                        .then(() => (toast.success("Saved"), load()))
                        .catch((err) => toast.error(getErrorMessage(err, "Couldn't save.")))
                    }
                  />
                  Supervisor
                </label>
              </li>
            ))}
          {team.filter((m) => !m.superAdmin).length === 0 && (
            <li className="text-muted-foreground">No Business Development Admins yet.</li>
          )}
        </ul>
      </section>
      <section className="card-elev p-5 text-sm">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Approved proposal templates</h3>
          <button
            type="button"
            className="btn-outline text-xs"
            onClick={() =>
              setEdit({
                name: "",
                kind: "portfolio",
                intro: "",
                product: "",
                terms: "",
                approved: true,
              })
            }
          >
            Add
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          AI drafts keep the product description and terms word for word; anything different is
          flagged and needs approval before sending.
        </p>
        <ul className="mt-3 grid gap-1">
          {tpls.map((t) => (
            <li key={t.id} className="flex justify-between">
              <span>
                {t.name}{" "}
                <span className="text-xs text-muted-foreground">
                  ({KIND_LABEL[t.kind]}
                  {t.approved ? "" : ", not approved"})
                </span>
              </span>
              <button
                type="button"
                className="text-xs text-accent underline"
                onClick={() => setEdit(t)}
              >
                Edit
              </button>
            </li>
          ))}
        </ul>
        {edit && (
          <div className="mt-3 grid gap-2 rounded-md border border-border p-3">
            <input
              className={inp}
              placeholder="Name"
              value={edit.name ?? ""}
              onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              aria-label="Name"
            />
            <select
              className={inp}
              value={edit.kind}
              onChange={(e) => setEdit({ ...edit, kind: e.target.value as OpportunityKind })}
              aria-label="Kind"
            >
              {(Object.keys(KIND_LABEL) as OpportunityKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            <textarea
              className={`${inp} min-h-[60px]`}
              placeholder="Introduction"
              value={edit.intro ?? ""}
              onChange={(e) => setEdit({ ...edit, intro: e.target.value })}
              aria-label="Introduction"
            />
            <textarea
              className={`${inp} min-h-[100px]`}
              placeholder="Approved product description"
              value={edit.product ?? ""}
              onChange={(e) => setEdit({ ...edit, product: e.target.value })}
              aria-label="Product"
            />
            <textarea
              className={`${inp} min-h-[100px]`}
              placeholder="Approved pricing and subscription terms"
              value={edit.terms ?? ""}
              onChange={(e) => setEdit({ ...edit, terms: e.target.value })}
              aria-label="Terms"
            />
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!edit.approved}
                onChange={(e) => setEdit({ ...edit, approved: e.target.checked })}
              />{" "}
              Approved for use
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-accent text-xs"
                disabled={!edit.name?.trim() || !edit.terms?.trim()}
                onClick={() =>
                  saveTemplate(edit as Template)
                    .then(() => (setEdit(null), load()))
                    .catch((e) => toast.error(getErrorMessage(e, "Couldn't save.")))
                }
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
    </div>
  );
}
