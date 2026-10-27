/**
 * Login, invitation signup, password reset, email verification (S19). Spread into en.ts / fr.ts.
 * Keys are namespaced "auth.*". English is the source of truth; French must define every key.
 */
export const authEn = {
} as const satisfies Record<string, string>;

export const authFr: Record<keyof typeof authEn, string> = {
};
