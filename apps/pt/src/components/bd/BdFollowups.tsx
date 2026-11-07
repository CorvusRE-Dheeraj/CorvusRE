import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/error-message";
import { useLiveRefresh } from "@/lib/staff-records";
import {
  listActivities,
  saveActivity,
  ACTIVITY_LABEL,
  type Activity,
  type TeamMember,
} from "@/lib/bd-console";

const inp = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";

// Every scheduled call, meeting, demo, proposal reminder and relationship
// review across accounts — owner, due date, priority, status, outcome.
export function BdFollowups({
  me,
  team,
  onOpportunity,
  onAccount,
}: {
  me: string;
  team: TeamMember[];
  onOpportunity: (id: string) => void;
  onAccount: (id: string) => void;
}) {
  const [rows, setRows] = useState<(Activity & { crm_accounts?: { name: string } | null })[]>([]);
  const [who, setWho] = useState("me");
  const [show, setShow] = useState<"planned" | "done" | "all">("planned");
  const load = useCallback(
    () =>
      listActivities(show === "all" ? {} : { status: show })
        .then(setRows)
        .catch((e) => toast.error(getErrorMessage(e, "Couldn't load follow-ups."))),
    [show],
  );
  useEffect(() => void load(), [load]);
  useLiveRefresh(["bd_activities"], () => void load(), true);
  const list = useMemo(
    () => rows.filter((a) => !who || (who === "me" ? a.owner === me : a.owner === who)),
    [rows, who, me],
  );
  const now = new Date().toISOString();
  return (
    <div className="mt-6">
      <div className="flex flex-wrap gap-2">
        <select
          className={inp}
          value={show}
          onChange={(e) => setShow(e.target.value as typeof show)}
          aria-label="Status"
        >
          <option value="planned">Planned</option>
          <option value="done">Done</option>
          <option value="all">All</option>
        </select>
        <select
          className={inp}
          value={who}
          onChange={(e) => setWho(e.target.value)}
          aria-label="Owner"
        >
          <option value="me">Mine</option>
          <option value="">Everyone</option>
          {team.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <span className="self-center text-xs text-muted-foreground">
          Schedule new follow-ups from an opportunity or account.
        </span>
      </div>
      <div className="card-elev mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-secondary/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5">Due</th>
              <th className="px-3 py-2.5">Activity</th>
              <th className="px-3 py-2.5">Organization</th>
              <th className="px-3 py-2.5">Owner</th>
              <th className="px-3 py-2.5">Priority</th>
              <th className="px-3 py-2.5">Status / outcome</th>
            </tr>
          </thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id} className="border-t border-border/60 align-top">
                <td
                  className={`whitespace-nowrap px-3 py-2 ${a.status === "planned" && a.due_at && a.due_at < now ? "text-destructive" : ""}`}
                >
                  {a.due_at
                    ? new Date(a.due_at).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : "—"}
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="text-left hover:underline"
                    onClick={() =>
                      a.opportunity_id
                        ? onOpportunity(a.opportunity_id)
                        : a.account_id
                          ? onAccount(a.account_id)
                          : undefined
                    }
                  >
                    <span className="mr-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase">
                      {ACTIVITY_LABEL[a.kind]}
                    </span>
                    {a.subject}
                  </button>
                </td>
                <td className="px-3 py-2">{a.crm_accounts?.name ?? "—"}</td>
                <td className="px-3 py-2">
                  <select
                    className={`${inp} text-xs`}
                    value={a.owner ?? ""}
                    onChange={(e) =>
                      void saveActivity({ id: a.id, owner: e.target.value || null }).then(load)
                    }
                    aria-label="Owner"
                  >
                    <option value="">—</option>
                    {team.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">{a.priority}</td>
                <td className="px-3 py-2">
                  {a.status}
                  {a.outcome && <div className="text-xs text-muted-foreground">{a.outcome}</div>}
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  Nothing here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
