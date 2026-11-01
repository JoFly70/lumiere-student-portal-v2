/**
 * S32-B staff experience repairs — shell strings. Spread into en.ts / fr.ts.
 * English is the source of truth; French must define every key (vouvoiement, idiomatic Québec/France-neutral).
 */
export const s32StaffShellEn = {
} as const satisfies Record<string, string>;

export const s32StaffShellFr: Record<keyof typeof s32StaffShellEn, string> = {
};
