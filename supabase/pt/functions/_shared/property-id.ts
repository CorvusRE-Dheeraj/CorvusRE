// Does the search-box text look like a county Property ID or Geographic ID /
// account number rather than an address or owner name? Shared by cad-lookup's
// idSearch and the app's search box. Examples: 34086, 1151895,
// A1246A-000-0023-0000, 0174230307, R123456, 00000143221000000.
// An address ("900 Willowwood") has a space; an owner name has no digit.
export function looksLikePropertyId(text: string): boolean {
  const s = text.trim();
  if (s.length < 4 || s.length > 30) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9.\-]*$/.test(s)) return false;
  const digits = s.replace(/\D/g, "").length;
  return digits >= 4 && digits >= s.replace(/[.\-]/g, "").length / 2;
}

export const ID_SEARCH_TIMEOUT_MS = 5000;
