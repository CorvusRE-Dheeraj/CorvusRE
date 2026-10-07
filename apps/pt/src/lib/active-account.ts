// The owner account a team member is working in (lib/auth.tsx sets it), for
// code outside React that must know — filing, which needs the owner's own
// signature. null in the signed-in user's own account.
let activeWorkspace: { ownerId: string; ownerName: string } | null = null;

export function setActiveWorkspace(w: { ownerId: string; ownerName: string } | null) {
  activeWorkspace = w;
}

export function getActiveWorkspace() {
  return activeWorkspace;
}
