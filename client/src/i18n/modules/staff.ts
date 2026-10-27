/**
 * Staff billing management and document review (S19). Spread into en.ts / fr.ts.
 * Keys are namespaced "staff.*". English is the source of truth; French must define every key.
 */
export const staffEn = {
} as const satisfies Record<string, string>;

export const staffFr: Record<keyof typeof staffEn, string> = {
};
