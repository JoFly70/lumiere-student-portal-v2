/**
 * S32-B staff experience repairs — dir strings. Spread into en.ts / fr.ts.
 * English is the source of truth; French must define every key (vouvoiement, "étudiant" for student).
 */
export const s32StaffDirEn = {
} as const satisfies Record<string, string>;

export const s32StaffDirFr: Record<keyof typeof s32StaffDirEn, string> = {
};
