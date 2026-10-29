/**
 * Classifier for synthetic / test / demo accounts so operational screens can hide them by default.
 * Pure and dependency-free: shared by the server (analytics) and the client (admin lists).
 */
export interface SyntheticAccountInput {
  email?: string | null;
  name?: string | null;
  preferred_name?: string | null;
  first_name?: string | null;
}

const EMAIL_SUFFIX = /\.(invalid|test|example)$/i;
const EMAIL_EXAMPLE_HOST = /@example\./i;
const NAME_PREFIX_STRICT = /^\s*(?:DEMO|QA|TEST)(?![a-z])|^\s*S2\d(?!\d)/i;
const SYNTHETIC_WORD = /SYNTHETIC/i;

export function isSyntheticAccount(x: SyntheticAccountInput | null | undefined): boolean {
  if (!x) return false;
  const email = (x.email ?? "").trim();
  if (email && (EMAIL_SUFFIX.test(email) || EMAIL_EXAMPLE_HOST.test(email))) return true;
  for (const n of [x.name, x.preferred_name, x.first_name]) {
    if (!n) continue;
    if (NAME_PREFIX_STRICT.test(n) || SYNTHETIC_WORD.test(n)) return true;
  }
  return false;
}

/**
 * Strict marker for provisioned demo students (preferred_name "DEMO-S26-FR", "DEMO-MIRROR-<code>", "DEMO-S27-P8"):
 * "DEMO" followed by a separator. A real name that merely starts with those letters ("Demont") does not match.
 * Used where a wrong answer would hide a real student from counts or expose a session, so it is deliberately narrow.
 */
export const DEMO_PREFERRED_NAME = /^DEMO[-_ ]/i;
export const isDemoPreferredName = (name: string | null | undefined): boolean => DEMO_PREFERRED_NAME.test(name ?? "");
