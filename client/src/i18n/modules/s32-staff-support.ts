/**
 * S32-B staff experience repairs — support strings. Spread into en.ts / fr.ts.
 * English is the source of truth; French must define every key (vouvoiement, idiomatic Québec/France-neutral).
 */
export const s32StaffSupportEn = {
} as const satisfies Record<string, string>;

export const s32StaffSupportFr: Record<keyof typeof s32StaffSupportEn, string> = {
};
