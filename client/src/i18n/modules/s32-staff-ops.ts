/**
 * S32-B staff experience repairs — ops strings. Spread into en.ts / fr.ts.
 * English is the source of truth; French must define every key (vouvoiement, idiomatic Québec/France-neutral).
 */
export const s32StaffOpsEn = {
  "s32.ops.n.noStaffInbox": "Staff have no in-portal inbox, so there is no read state.",
} as const satisfies Record<string, string>;

export const s32StaffOpsFr: Record<keyof typeof s32StaffOpsEn, string> = {
  "s32.ops.n.noStaffInbox": "Le personnel n’a pas de boîte de réception dans le portail ; il n’y a donc pas d’état de lecture.",
};
