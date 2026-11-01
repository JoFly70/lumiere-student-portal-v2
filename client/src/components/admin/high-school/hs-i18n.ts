/**
 * S32-B (SA-16): French for the staff High School Pathway screens.
 *
 * Most wording lives in the dictionary (keys "s32dir.hs.*", read with `t`). A part of the screen text is produced by
 * `@/lib/admin-high-school-logic` (status labels, gate reasons, validation messages, guardian guidance, fixed notices).
 * That module is shared with tests and server-facing code and stays English, so `x()` below translates its known
 * output at the display edge. English is returned untouched, so nothing changes for English users. Free text typed by
 * people or sent by the server (notes, event summaries, template/course titles, school names) is data and is never
 * translated.
 */
import { formatCreditsLocale, useT, type Language } from "@/i18n";

const FR: Record<string, string> = {
  // statuses and outcomes (statusLabel output)
  "Planned": "Planifié", "Active": "Actif", "On hold": "En suspens", "Completed": "Terminé", "Withdrawn": "Retiré",
  "Transferred out": "Transféré ailleurs", "Reported": "Déclaré", "Documents requested": "Documents demandés", "Evaluated": "Évalué",
  "Lesson": "Leçon", "Exam": "Examen", "Project": "Projet", "Passed": "Réussi", "Failed": "Échoué", "Retake required": "Reprise requise",
  "Not passed": "Non réussi", "Voided": "Annulé", "Draft": "Brouillon", "Published": "Publié", "Superseded": "Remplacé", "Discarded": "Abandonné",
  "In progress": "En cours", "Eligibility confirmed": "Admissibilité confirmée", "Diploma conferred": "Diplôme décerné",
  "Not started": "Non commencé", "Submitted": "Soumis", "Replaced": "Remplacé", "Removed": "Retiré",
  // labels from the logic module
  "Claimed (not yet sent to the school)": "Déclaré (pas encore transmis à l’école)", "Submitted to school": "Transmis à l’école",
  "Accepted": "Accepté", "Partially accepted": "Partiellement accepté", "Declined": "Refusé",
  "Credit awarded": "Crédit attribué", "Declined by school": "Refusé par l’école",
  "Accepted — credit not yet awarded": "Accepté — crédit pas encore attribué",
  "Partly accepted — credit not yet awarded": "Accepté en partie — crédit pas encore attribué",
  "Submitted to school — not credit": "Transmis à l’école — pas un crédit", "Claimed — not credit": "Déclaré — pas un crédit",
  "Not requested": "Non demandé", "Requested": "Demandé", "Issued by school": "Émis par l’école", "Delivered": "Remis",
  "Unknown": "Inconnu", "Cleared": "Autorisé", "Hold": "Retenue", "Not available": "Non disponible",
  "High school transcript": "Relevé de notes du secondaire", "Diploma": "Diplôme", "Foreign credential evaluation": "Évaluation de diplômes étrangers",
  "Other document": "Autre document", "Document": "Document", "Verified document": "Document vérifié", "Not archived yet": "Pas encore archivé",
  "Task": "Tâche", "Total credits": "Total des crédits","Transfer credit": "Crédit de transfert", "Course result": "Résultat de cours", "Prior study": "Études antérieures", "Course": "Cours",
  "Not assigned": "Non attribué", "Not set": "Non défini",
  "An accredited U.S. online high school": "Une école secondaire en ligne américaine accréditée",
  // fixed notices
  "This record is closed.": "Ce dossier est clos.",
  "Not configured — the school's rules apply": "Non configuré — les règles de l’école s’appliquent",
  "Contacts never receive portal access, whatever their standing. Share information only outside the portal, only within the scope shown.":
    "Les contacts n’ont jamais accès au portail, quel que soit leur statut. Ne communiquez des renseignements qu’en dehors du portail, et uniquement dans la portée indiquée.",
  "A prior-study record or transfer claim is not credit. Credit exists only after the awarding school accepts the claim and staff record an official transfer award with its evaluation as evidence.":
    "Un dossier d’études antérieures ou une demande de transfert ne constitue pas un crédit. Le crédit n’existe qu’une fois la demande acceptée par l’école décernante et une attribution officielle de crédit de transfert enregistrée par le personnel, avec son évaluation comme preuve.",
  // gate reasons and validation messages
  "No changes to save.": "Aucune modification à enregistrer.", "No change from the saved decision.": "Aucun changement par rapport à la décision enregistrée.",
  "No change from the current clearance.": "Aucun changement par rapport à l’autorisation actuelle.", "Unchanged.": "Inchangé.",
  "Select a verified document as evidence.": "Sélectionnez un document vérifié comme preuve.",
  "The selected document is not verified. Verify it in Documents first.": "Le document sélectionné n’est pas vérifié. Vérifiez-le d’abord dans Documents.",
  "Awarded credit must be a multiple of 0.5.": "Le crédit attribué doit être un multiple de 0,5.",
  "Credit has already been awarded for this claim.": "Un crédit a déjà été attribué pour cette demande.",
  "Enter the previous school's name.": "Saisissez le nom de l’école précédente.", "Enter the country.": "Saisissez le pays.",
  "Record the prior school first, then add claims to it.": "Enregistrez d’abord l’école précédente, puis ajoutez-y des demandes.",
  "Enter the course title.": "Saisissez le titre du cours.",
  "Choose the requirement area the claim would count toward.": "Choisissez le domaine d’exigence auquel la demande serait comptée.",
  "Claimed credit must be a multiple of 0.5.": "Le crédit demandé doit être un multiple de 0,5.",
  "Enter a course title.": "Saisissez un titre de cours.", "Choose a requirement area.": "Choisissez un domaine d’exigence.",
  "Credit must be 0.5, 1, 1.5 … (multiples of 0.5).": "Le crédit doit être 0,5, 1, 1,5 … (multiples de 0,5).",
  "The planned end date is before the start date.": "La date de fin prévue précède la date de début.",
  "Choose a curriculum template.": "Choisissez un modèle de programme.",
  "Total required must be a multiple of 0.5 (for example 22).": "Le total exigé doit être un multiple de 0,5 (par exemple 22).",
  "Explain why this student's total differs from the template (at least 5 characters).": "Expliquez pourquoi le total de cet étudiant diffère du modèle (au moins 5 caractères).",
  "A reason is only used together with a total-required override.": "Un motif n’est utilisé qu’avec une dérogation au total exigé.",
  "The target completion date is before the start date.": "La date d’achèvement visée précède la date de début.",
  "Choose a month.": "Choisissez un mois.", "Cumulative credit must be a multiple of 0.5.": "Le crédit cumulatif doit être un multiple de 0,5.",
  "That month already has a milestone.": "Ce mois comporte déjà un jalon.",
  "There is no draft to publish. Create a draft first.": "Il n’y a aucun brouillon à publier. Créez d’abord un brouillon.",
  "Only an administrator can publish the approved roadmap.": "Seul un administrateur peut publier la feuille de route approuvée.",
  "Save your draft changes before publishing.": "Enregistrez les modifications du brouillon avant de publier.", "Working…": "Traitement en cours…",
  "Score must be a whole number from 0 to 100.": "La note doit être un nombre entier de 0 à 100.",
  "No enrollment.": "Aucune inscription.", "Eligibility is already confirmed.": "L’admissibilité est déjà confirmée.", "Admin only.": "Réservé aux administrateurs.",
  "Only an administrator can confer the diploma.": "Seul un administrateur peut décerner le diplôme.", "The diploma is already conferred.": "Le diplôme est déjà décerné.",
  "Confirm graduation eligibility first.": "Confirmez d’abord l’admissibilité à l’obtention du diplôme.",
  "Financial clearance is locked once the diploma is conferred.": "L’autorisation financière est verrouillée une fois le diplôme décerné.",
  "Disclose the school name only after the enrollment is confirmed (active or completed).": "Ne divulguez le nom de l’école qu’une fois l’inscription confirmée (active ou terminée).",
  "Enter the awarding school's name first.": "Saisissez d’abord le nom de l’école décernante.",
  "Disclosure is on, a name is set and the enrollment is confirmed.": "La divulgation est activée, un nom est défini et l’inscription est confirmée.",
  "Disclosure is off, so the school name stays confidential.": "La divulgation est désactivée : le nom de l’école reste confidentiel.",
  "Disclosure is on but no school name is set.": "La divulgation est activée, mais aucun nom d’école n’est défini.",
  "Enter the date the school conferred the diploma.": "Saisissez la date à laquelle l’école a décerné le diplôme.",
  "Select the verified diploma document.": "Sélectionnez le document de diplôme vérifié.",
  "Select the verified transcript document.": "Sélectionnez le relevé de notes vérifié.",
  "Choose the course and the task.": "Choisissez le cours et la tâche.", "Choose the course.": "Choisissez le cours.", "Choose the award.": "Choisissez l’attribution.",
  "Enter the conferral date and the awarding school.": "Saisissez la date de remise du diplôme et l’école décernante.",
  "Select a verified diploma and a verified transcript as evidence.": "Sélectionnez un diplôme vérifié et un relevé de notes vérifié comme preuves.",
  "Only an administrator can import a historical graduate.": "Seul un administrateur peut importer un diplômé historique.",
  "This student already has an open high school program. Close it (withdrawn, transferred out or completed) before starting another.":
    "Cet étudiant a déjà un programme du secondaire en cours. Clôturez-le (retrait, transfert ou fin) avant d’en commencer un autre.",
  "Each month can have only one milestone.": "Chaque mois ne peut avoir qu’un seul jalon.",
  "Monthly milestones must not decrease (they are cumulative).": "Les jalons mensuels ne doivent pas diminuer (ils sont cumulatifs).",
  "Something went wrong. Nothing was saved.": "Une erreur s’est produite. Rien n’a été enregistré.",
  "Only an administrator can do this.": "Seul un administrateur peut effectuer cette action.",
  "This pathway changed since you loaded it. It has been reloaded; review the latest version and try again.":
    "Ce parcours a changé depuis son chargement. Il a été rechargé ; consultez la dernière version et réessayez.",
  "Select a verified document of this student as evidence.": "Sélectionnez un document vérifié de cet étudiant comme preuve.",
  "A configured school policy does not allow this.": "Une politique d’école configurée ne le permet pas.",
  "Graduation requirements are not met yet.": "Les exigences de diplomation ne sont pas encore remplies.",
  "This official record is locked.": "Ce dossier officiel est verrouillé.",
  "Check the highlighted values and try again.": "Vérifiez les valeurs signalées et réessayez.",
  // guardians
  "Verified guardian": "Tuteur vérifié", "Guardian — awaiting verification": "Tuteur — en attente de vérification",
  "Authority revoked": "Autorité révoquée", "Listed parent — no authority": "Parent inscrit — sans autorité",
  "Emergency and scheduling matters": "Urgences et questions d’horaire", "Academic progress": "Progression scolaire",
  "Billing and payments": "Facturation et paiements", "Emergency contact only": "Contact d’urgence seulement",
  "Any student record detail": "Tout détail du dossier de l’étudiant", "Everything except a safety emergency": "Tout, sauf une urgence de sécurité",
  "Academic progress (no academic scope in force)": "Progression scolaire (aucune portée scolaire en vigueur)",
  "Billing and payments (no financial scope in force)": "Facturation et paiements (aucune portée financière en vigueur)",
  "an admin": "un administrateur", "a staff member": "un membre du personnel", "Lumière staff": "Personnel de Lumière",
  "Admin": "Administrateur", "Staff member": "Membre du personnel",
  // policies
  "Maximum attempts per exam": "Nombre maximal de tentatives par examen", "Failed attempts beyond this are refused when staff record them.": "Les échecs au-delà de ce nombre sont refusés à l’enregistrement.",
  "attempts": "tentatives", "Minimum days between exams": "Nombre minimal de jours entre deux examens", "Informational pacing rule for this student.": "Règle de rythme à titre indicatif pour cet étudiant.",
  "days": "jours", "Maximum transfer credit": "Crédit de transfert maximal", "Cap on transfer awards; the school decides acceptance.": "Plafond des attributions de transfert ; l’école décide de l’acceptation.",
  "credits": "crédits", "Passing percentage (staff view only)": "Pourcentage de réussite (vue du personnel seulement)", "Never shown to the student as a rule.": "Jamais présenté à l’étudiant comme une règle.",
  "Maximum exams per week": "Nombre maximal d’examens par semaine", "Informational; shown next to the student's weekly exam count.": "À titre indicatif ; affiché à côté du nombre d’examens hebdomadaires de l’étudiant.",
  "exams": "examens",
  // events (humanize output)
  "credit awarded": "crédit attribué", "credit voided": "attribution de crédit annulée", "enrollment created": "inscription créée", "enrollment updated": "inscription mise à jour",
  "graduation updated": "diplomation mise à jour", "guardian note added": "note sur un tuteur ajoutée", "official result recorded": "résultat officiel enregistré",
  "prior education recorded": "études antérieures enregistrées", "progress reported": "progression déclarée", "roadmap draft saved": "brouillon de feuille de route enregistré",
  "roadmap published": "feuille de route publiée", "transfer claim changed": "demande de transfert modifiée", "access denied": "accès refusé", "transcript requested": "relevé de notes demandé",
  "Student": "Étudiant",
};

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_FR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const MONTH_LONG_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** "Oct 26, 2026" -> "26 oct. 2026" (French). Mirrors formatDate in the logic module for English. */
export function hsDate(language: Language, value: string | null | undefined): string {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  const i = Number(m[2]) - 1;
  const en = MONTHS_EN[i];
  if (!en) return value;
  return language === "fr" ? `${Number(m[3])} ${MONTHS_FR[i]} ${m[1]}` : `${en} ${Number(m[3])}, ${m[1]}`;
}

/** "2026-10" -> "oct. 2026" (French) / "Oct 2026" (English). */
export function hsMonth(language: Language, value: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  const i = m ? Number(m[2]) - 1 : -1;
  const en = MONTHS_EN[i];
  if (!m || !en) return value ?? "—";
  return language === "fr" ? `${MONTHS_FR[i]} ${m[1]}` : `${en} ${m[1]}`;
}

export const hsMonthName = (language: Language, index: number, english: string): string => (language === "fr" ? MONTH_LONG_FR[index] ?? english : english);

/** "1.5" -> "1,5" in French. */
const num = (language: Language, s: string): string => (language === "fr" ? s.replace(".", ",") : s);

/** "1 credit" / "2 credits"; French uses a decimal comma and the singular below 2. */
export function hsCredits(language: Language, half: number): string {
  const n = formatCreditsLocale(half, language);
  if (language === "fr") return `${n} ${half < 4 ? "crédit" : "crédits"}`;
  return `${n} ${half === 2 ? "credit" : "credits"}`;
}

const frCredits = (s: string): string => {
  const v = Number(s);
  return `${s.replace(".", ",")} ${v < 2 ? "crédit" : "crédits"}`;
};

const dateInText = (s: string): string =>
  s.replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{4})\b/g, (_, mo: string, d: string, y: string) => `${d} ${MONTHS_FR[MONTHS_EN.indexOf(mo)]} ${y}`)
    .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})\b/g, (_, mo: string, y: string) => `${MONTHS_FR[MONTHS_EN.indexOf(mo)]} ${y}`);

type Pattern = [RegExp, (m: RegExpExecArray, tr: (s: string) => string) => string];

const PATTERNS: Pattern[] = [
  [/^Add a note of at least (\d+) characters for the record\.$/, (m) => `Ajoutez une note d’au moins ${m[1]} caractères pour le dossier.`],
  [/^At most ([\d.]+) credits were accepted for this claim\.$/, (m) => `Au plus ${frCredits(m[1]!)} ont été acceptés pour cette demande.`],
  [/^Choose how much the school accepted \(up to ([\d.]+) credits\)\.$/, (m) => `Choisissez la part acceptée par l’école (jusqu’à ${frCredits(m[1]!)}).`],
  [/^This evidence must be a (.+)\.$/, (m, tr) => `Cette preuve doit être : ${m[1]!.split(" or ").map(tr).join(" ou ")}.`],
  [/^Fix (\d+) validation problems?(?: before publishing)?\.$/, (m) => `Corrigez ${m[1]} problème${Number(m[1]) === 1 ? "" : "s"} de validation avant de publier.`],
  [/^(\d+) (blocker remains|blockers remain): resolve (?:it|them) first\.$/, (m) => `${m[1]} point bloquant ${Number(m[1]) === 1 ? "subsiste" : "subsistent"} : ${Number(m[1]) === 1 ? "résolvez-le" : "résolvez-les"} d’abord.`],
  [/^This enrollment is (.+): financial clearance is locked\.$/, (m, tr) => `Cette inscription est « ${tr(m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1)).toLowerCase()} » : l’autorisation financière est verrouillée.`],
  [/^The enrollment is (.+)\. The name appears once it is active or completed\.$/, (m, tr) => `L’inscription est « ${tr(m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1)).toLowerCase()} ». Le nom apparaît une fois l’inscription active ou terminée.`],
  [/^Area requirements add up to ([\d.]+) credits, but the total required is ([\d.]+)\.$/, (m) => `Les exigences par domaine totalisent ${frCredits(m[1]!)}, mais le total exigé est de ${m[2]!.replace(".", ",")}.`],
  [/^(.+): ([\d.]+) credits? still to plan\.$/, (m) => `${m[1]} : ${frCredits(m[2]!)} restant à planifier.`],
  [/^(.+): planned ([\d.]+) credits? more than required\.$/, (m) => `${m[1]} : ${frCredits(m[2]!)} planifié${Number(m[2]) < 2 ? "" : "s"} de plus que requis.`],
  [/^“(.+)” ends before it starts\.$/, (m) => `« ${m[1]} » se termine avant de commencer.`],
  [/^“(.+)” is in an area that does not exist\.$/, (m) => `« ${m[1]} » est dans un domaine qui n’existe pas.`],
  [/^Started (.+)$/, (m) => `Débuté le ${dateInText(m[1]!)}`],
  [/^Created (.+)$/, (m) => `Créé le ${dateInText(m[1]!)}`],
  [/^(.+) \(historical graduate\)$/, (m) => `${m[1]} (diplômé historique)`],
  [/^Exception: ([\d.]+) credits — (.+)$/, (m) => `Exception : ${frCredits(m[1]!)} — ${m[2]}`],
  [/^Accepted ([\d.]+) of ([\d.]+) credits$/, (m) => `${m[1]!.replace(".", ",")} sur ${frCredits(m[2]!)} acceptés`],
  [/^(Transfer credit|Course completion) · (.+) · ([\d.]+) credits?$/, (m, tr) => `${m[1] === "Transfer credit" ? "Crédit de transfert" : "Réussite de cours"} · ${tr(m[2]!)} · ${frCredits(m[3]!)}`],
  [/^([\d.]+) credits?$/, (m) => frCredits(m[1]!)],
];

/** Translates one known output string of the logic module; unknown text (data) is returned unchanged. */
export function hsx(language: Language, s: string | null | undefined): string {
  if (!s) return s ?? "";
  if (language !== "fr") return s;
  const exact = FR[s];
  if (exact) return exact;
  const tr = (q: string) => hsx(language, q);
  for (const [re, fn] of PATTERNS) {
    const m = re.exec(s);
    if (m) return fn(m, tr);
  }
  return s;
}

export function useHs() {
  const { t, language, formatCredits } = useT();
  return {
    t,
    language,
    /** Credit amount in half-units with the locale decimal separator ("1,5" in French). */
    fc: formatCredits,
    x: (s: string | null | undefined) => hsx(language, s),
    date: (v: string | null | undefined) => hsDate(language, v),
    month: (v: string | null | undefined) => hsMonth(language, v),
    credits: (half: number) => hsCredits(language, half),
    num: (s: string) => num(language, s),
  };
}
