/**
 * S32-B staff experience repairs — billing strings. Spread into en.ts / fr.ts.
 * English is the source of truth; French must define every key (vouvoiement, idiomatic Québec/France-neutral).
 */
export const s32StaffBillingEn = {
} as const satisfies Record<string, string>;

export const s32StaffBillingFr: Record<keyof typeof s32StaffBillingEn, string> = {
};
