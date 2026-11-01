/**
 * S32-A student repairs — new strings for the "degree" work stream. Spread into en.ts / fr.ts.
 * French uses vouvoiement and the typographic apostrophe.
 */
export const s32DegreeEn = {
  "s32.cal.requestAppt": "Request an appointment",
  "s32.cal.requestApptHelp": "You can request an orientation session on the Beyond page. Lumière confirms each request, so it is not booked until you hear back.",
} as const;

export const s32DegreeFr: Record<keyof typeof s32DegreeEn, string> = {
  "s32.cal.requestAppt": "Demander un rendez-vous",
  "s32.cal.requestApptHelp": "Vous pouvez demander une séance d’orientation sur la page Au-delà du diplôme. Lumière confirme chaque demande : rien n’est réservé tant que vous n’avez pas de réponse.",
};
