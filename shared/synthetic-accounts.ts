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
