/**
 * S32-B staff experience repairs — ops strings. Spread into en.ts / fr.ts.
 * English is the source of truth; French must define every key (vouvoiement, idiomatic Québec/France-neutral).
 */
export const s32StaffOpsEn = {
} as const satisfies Record<string, string>;

export const s32StaffOpsFr: Record<keyof typeof s32StaffOpsEn, string> = {
};
