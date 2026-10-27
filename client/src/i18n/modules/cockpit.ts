/**
 * Flight Deck cockpit, subject details, milestones, next actions (S19). Spread into en.ts / fr.ts.
 * Keys are namespaced "cockpit.*". English is the source of truth; French must define every key.
 */
export const cockpitEn = {
} as const satisfies Record<string, string>;

export const cockpitFr: Record<keyof typeof cockpitEn, string> = {
};
