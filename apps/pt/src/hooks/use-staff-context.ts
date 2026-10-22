import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { getStaffRole, type StaffRole } from "@/lib/marketing";
import { staffDirectory, type Department, type StaffMember } from "@/lib/staff-records";

// ── who am I / who is staff ─────────────────────────────────────────────────
export type StaffContext = {
  me: string | null;
  role: StaffRole | null;
  departments: Department[];
  staff: StaffMember[];
  nameOf: (id: string | null | undefined) => string;
};

export function useStaffContext(): StaffContext {
  const { user } = useAuth();
  const [role, setRole] = useState<StaffRole | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  useEffect(() => {
    if (!user) return;
    void getStaffRole(user.id).then(setRole);
    staffDirectory()
      .then(setStaff)
      .catch(() => setStaff([]));
  }, [user]);
  const departments = useMemo<Department[]>(() => {
    if (!role) return [];
    if (role.isSuperAdmin) return ["marketing", "support", "operations"];
    return [
      ...(role.isMarketingAdmin ? (["marketing"] as const) : []),
      ...(role.isSupportAdmin ? (["support"] as const) : []),
      ...(role.isOperationsAdmin ? (["operations"] as const) : []),
    ];
  }, [role]);
  const nameOf = useCallback(
    (id: string | null | undefined) =>
      id ? (staff.find((s) => s.id === id)?.name ?? "Staff member") : "No owner",
    [staff],
  );
  return { me: user?.id ?? null, role, departments, staff, nameOf };
}
