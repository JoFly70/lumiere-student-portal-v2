/**
 * S32-B (SA-35): one minimum length for every NEW password (invitation sign-up and password reset), enforced by the
 * server and mirrored by the forms. Existing passwords keep working at sign-in; the rule applies when one is set.
 */
export const MIN_PASSWORD_LENGTH = 10;

export function passwordTooShort(password: string): boolean {
  return password.length < MIN_PASSWORD_LENGTH;
}
