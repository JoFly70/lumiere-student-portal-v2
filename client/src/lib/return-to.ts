/**
 * S32-B (SA-19): return to the page the person opened after they sign in.
 * ProtectedRoute remembers the attempted path in sessionStorage; the login page restores it once, if the signed-in
 * role may open it. Same-origin paths only (validated by `safeReturnPath`); never a query-string `next=` parameter,
 * so there is no open redirect. Storage failures are ignored (the role home is used).
 */
import { RETURN_TO_STORAGE_KEY, returnPathForRole, safeReturnPath } from "@shared/staff-links";

export function rememberReturnPath(path: string, storage?: Pick<Storage, "setItem">): void {
  const safe = safeReturnPath(path);
  if (!safe) return;
  try { (storage ?? sessionStorage).setItem(RETURN_TO_STORAGE_KEY, safe); } catch { /* storage blocked */ }
}

/** Reads and clears the remembered path; returns it only when `role` can open it. */
export function takeReturnPath(role: string | null | undefined, storage?: Pick<Storage, "getItem" | "removeItem">): string | null {
  try {
    const s = storage ?? sessionStorage;
    const raw = s.getItem(RETURN_TO_STORAGE_KEY);
    s.removeItem(RETURN_TO_STORAGE_KEY);
    return returnPathForRole(raw, role);
  } catch {
    return null;
  }
}

export function forgetReturnPath(storage?: Pick<Storage, "removeItem">): void {
  try { (storage ?? sessionStorage).removeItem(RETURN_TO_STORAGE_KEY); } catch { /* storage blocked */ }
}
