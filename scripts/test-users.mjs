// The ONLY email addresses test and probe scripts may use. They're on the
// Resend suppression list, so nothing is ever actually emailed to them —
// never generate random/timestamped test addresses (those can't be
// suppressed). Need more accounts at once? Add a role here AND to the Resend
// suppression list (and the README's "Test accounts" section).
//
//   import { testEmail, freeTestEmail } from "../scripts/test-users.mjs";
//   const email = testEmail("customer");
//   await freeTestEmail(sql, email, (id) => deleteAuthUser(id)); // before creating it
//   ... create the account, run the test, delete the account ...
export const TEST_EMAILS = {
  customer: "qa-customer@corvustest.dev",
  customer2: "qa-customer2@corvustest.dev",
  superadmin: "qa-superadmin@corvustest.dev",
  operations: "qa-operations@corvustest.dev",
  support: "qa-support@corvustest.dev",
  marketing: "qa-marketing@corvustest.dev",
  member: "qa-member@corvustest.dev",
  invitee: "qa-invitee@corvustest.dev",
  lead: "qa-lead@corvustest.dev",
  dp: "qa-dp@corvustest.dev",
};

export function testEmail(role) {
  const email = TEST_EMAILS[role];
  if (!email) {
    throw new Error(
      `Unknown test role "${role}" — use one of ${Object.keys(TEST_EMAILS).join(", ")}`,
    );
  }
  return email;
}

export const isTestEmail = (email) =>
  Object.values(TEST_EMAILS).includes(String(email).toLowerCase());

// The addresses are fixed, so an account left over from an earlier run that
// didn't clean up would block creating it again: delete it first. `sql` runs a
// query (e.g. through the Supabase Management API) and returns rows;
// `deleteUser(id)` removes an auth user (Auth admin API).
export async function freeTestEmail(sql, email, deleteUser) {
  if (!isTestEmail(email)) throw new Error(`${email} isn't one of the fixed test emails`);
  const rows = await sql(`select id from auth.users where lower(email) = lower('${email}')`);
  for (const row of Array.isArray(rows) ? rows : []) await deleteUser(row.id);
}
