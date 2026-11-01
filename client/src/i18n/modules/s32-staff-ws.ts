/**
 * S32-B staff experience repairs — ws strings. Spread into en.ts / fr.ts.
 * English is the source of truth; French must define every key (vouvoiement, "étudiant" for student).
 */
export const s32StaffWsEn = {
} as const satisfies Record<string, string>;

export const s32StaffWsFr: Record<keyof typeof s32StaffWsEn, string> = {
};
