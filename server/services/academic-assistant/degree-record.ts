/**
 * S32-A (F03) — "Degree credits", "Degree requirements" and "Next tasks" records for a degree (bachelor's) student.
 *
 * Built server-side from the student's OWN published roadmap (StudentRoadmapView) and canonical degree progress
 * (StudentDegreeProgressView) with the same rules as the Flight Deck (client degree-cockpit-model / degree-journey model;
 * client code is never imported by the server, so the few lines of arithmetic are recomputed here from the shared types):
 *   Earned (accepted by the university) = canonical applied credit only
 *   Planned = credits of active roadmap courses not yet officially accepted (a plan, never earned)
 *   Still open = required - earned - planned (never negative)
 * Provider-reported or student-reported work is never earned. No invented numbers: every figure is read from the views.
 * Deterministic answers only; these records are never sent to a model provider.
 */
import type { StudentRoadmapItemView, StudentRoadmapView } from "@shared/student-roadmap-contract";
import type { StudentDegreeProgressView } from "@shared/student-degree-progress-view";

/** S34 (S33-08): readable, correctly pluralised French/English figures for record answers (numbers are never changed). */
const plural = (n: number, one: string, many: string, zeroIsSingular: boolean): string => `${n} ${(zeroIsSingular ? Math.abs(n) <= 1 : Math.abs(n) === 1) ? one : many}`;
export function fmtDays(n: number, lang: "en" | "fr"): string { return lang === "fr" ? plural(n, "jour", "jours", true) : plural(n, "day", "days", false); }
export function fmtItems(n: number, lang: "en" | "fr"): string { return lang === "fr" ? plural(n, "élément", "éléments", true) : plural(n, "item", "items", false); }
export function fmtMonths(n: number, lang: "en" | "fr"): string { return lang === "fr" ? plural(n, "mois", "mois", true) : plural(n, "month", "months", false); }
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** "2026-11-02" -> "2 novembre 2026" / "November 2, 2026" (UTC so date-only values never shift). Non-ISO input is returned as-is. */
export function fmtDate(iso: string | null, lang: "en" | "fr"): string {
  if (!iso) return "";
  if (!DATE_ONLY.test(iso)) return iso;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const out = new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);
  return lang === "fr" ? out.replace(/^1 /, "1er ") : out;
}


type Lang = "en" | "fr";
export interface DegreeRecordDraft { readonly label: string; readonly title: string; readonly path: string; readonly text: string }

const RESIDENCY_RE = /resid|in[- ]?house|taken (at|with) (the )?(university|school|institution)|from the (university|institution)/i;

function toCents(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!m) return null;
  const cents = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0") || "0");
  return m[1] ? -cents : cents;
}
function fmt(cents: number, lang: Lang): string {
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  if (frac === 0) return String(whole);
  const text = `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
  return lang === "fr" ? text.replace(".", ",") : text;
}
const clip = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);
const active = (i: StudentRoadmapItemView) => i.planStatus === "planned" || i.planStatus === "hold";
const done = (i: StudentRoadmapItemView) => i.stage === "provider_complete" || i.stage === "officially_accepted";

export interface DegreeFiguresLite { required: number | null; earned: number | null; planned: number; open: number | null; overPlanned: boolean }

export function degreeFiguresLite(roadmap: StudentRoadmapView | null, progress: StudentDegreeProgressView | null): DegreeFiguresLite {
  const totals = progress?.state === "COMPOSED" ? progress.totals : null;
  const ladder = roadmap?.foundation.ladder;
  const reqRaw = toCents(totals?.requiredCredits ?? ladder?.required ?? null);
  const required = reqRaw !== null && reqRaw > 0 ? reqRaw : null;
  const earned = toCents(totals?.appliedCredits ?? (roadmap?.foundation.degreeState === "COMPOSED" ? ladder?.applied ?? null : null));
  let planned = 0;
  for (const phase of roadmap?.phases ?? []) for (const item of phase.items) {
    if (!active(item) || item.stage === "officially_accepted") continue;
    const c = toCents(item.credits);
    if (c && c > 0) planned += c;
  }
  const open = required !== null && earned !== null ? Math.max(0, required - earned - planned) : null;
  return { required, earned, planned, open, overPlanned: required !== null && earned !== null && earned + planned > required };
}

export function composeDegreeRecords(roadmap: StudentRoadmapView | null, progress: StudentDegreeProgressView | null, lang: Lang, today: string): DegreeRecordDraft[] {
  const t = (en: string, fr: string) => (lang === "fr" ? fr : en);
  const out: DegreeRecordDraft[] = [];
  const published = roadmap?.state === "PUBLISHED";
  const hasProgram = !!progress && progress.state !== "NO_ACTIVE_PROGRAM";
  if (!published && !hasProgram) return out;

  const f = degreeFiguresLite(published ? roadmap : null, progress);
  const parts: string[] = [];
  if (f.required === null) {
    parts.push(t("The credit total for your degree is not available yet; your Lumière team confirms it.", "Le total de crédits de votre diplôme n’est pas encore disponible; votre équipe Lumière le confirmera."));
  } else {
    parts.push(t(`Your degree requires ${fmt(f.required, lang)} credits.`, `Votre diplôme exige ${fmt(f.required, lang)} crédits.`));
  }
  if (f.earned !== null) {
    parts.push(t(`Earned (accepted by the university): ${fmt(f.earned, lang)}.`, `Acquis (acceptés par l’université) : ${fmt(f.earned, lang)}.`));
  } else {
    parts.push(t("Earned credits cannot be shown yet: the university’s evaluation of your progress is still being reviewed.", "Les crédits acquis ne peuvent pas encore être affichés : l’évaluation de votre progression par l’université est encore en révision."));
  }
  parts.push(t(`Planned (on your roadmap, not yet accepted): ${fmt(f.planned, lang)}.`, `Prévus (à votre feuille de route, pas encore acceptés) : ${fmt(f.planned, lang)}.`));
  if (f.open !== null) parts.push(t(`Still open (not yet earned or planned): ${fmt(f.open, lang)}.`, `Encore ouverts (ni acquis ni prévus) : ${fmt(f.open, lang)}.`));
  if (f.overPlanned) parts.push(t("Your plan covers more credits than the degree needs.", "Votre plan couvre plus de crédits que le diplôme n’en exige."));
  parts.push(t("Planned, provider-reported or self-reported work is not earned: credit becomes earned only when the university accepts it.", "Le travail prévu, déclaré par le fournisseur ou déclaré par vous n’est pas acquis : un crédit n’est acquis qu’une fois accepté par l’université."));
  if (published && roadmap) {
    const grad = roadmap.milestones.filter((m) => m.kind === "graduation" && m.targetDate).map((m) => m.targetDate as string).sort();
    const ends = roadmap.phases.filter((p) => p.items.some(active)).flatMap((p) => p.items.filter(active).map((i) => i.plannedEnd)).filter((d): d is string => !!d).sort();
    const target = grad[grad.length - 1] ?? ends[ends.length - 1] ?? null;
    if (target) parts.push(t(`Your published plan runs until about ${target} (a plan, not a guarantee).`, `Votre plan publié s’étend jusqu’à environ ${target} (un plan, pas une garantie).`));
  }
  out.push({ label: "Degree credits", title: t("Degree credits", "Crédits du diplôme"), path: "/roadmap", text: parts.join(" ") });

  // Requirements: residency and anything not yet satisfied. Amounts only when the canonical engine produced them.
  if (progress?.state === "COMPOSED") {
    const rows = progress.requirements.filter((r) => r.title.trim() || r.code);
    const open = rows.filter((r) => r.status !== "SATISFIED");
    const line = (r: (typeof rows)[number]) => {
      const name = clip(r.title.trim() || (r.code ?? ""), 80);
      const req = r.unit === "credit" ? toCents(r.requiredAmount) : null;
      const app = r.unit === "credit" ? toCents(r.appliedAmount) : null;
      const rem = r.unit === "credit" ? toCents(r.remainingAmount) : null;
      if (r.status === "MANUAL_REVIEW" || r.status === "CONFLICT") return t(`${name}: under review by the university`, `${name} : en révision par l’université`);
      if (req !== null && req > 0 && app !== null) return t(`${name}: ${fmt(app, lang)} of ${fmt(req, lang)} credits earned${rem ? `, ${fmt(rem, lang)} still open` : ""}`, `${name} : ${fmt(app, lang)} sur ${fmt(req, lang)} crédits acquis${rem ? `, ${fmt(rem, lang)} encore ouverts` : ""}`);
      return t(`${name}: not yet met`, `${name} : pas encore remplie`);
    };
    const resid = open.filter((r) => RESIDENCY_RE.test(r.title));
    const rest = open.filter((r) => !RESIDENCY_RE.test(r.title));
    const shown = [...resid, ...rest].slice(0, 6);
    const text = rows.length === 0
      ? t("No degree requirements are listed for you yet.", "Aucune exigence de diplôme n’est encore affichée pour vous.")
      : open.length === 0
        ? t(`${rows.length === 1 ? "The 1 degree requirement is" : `All ${rows.length} degree requirements are`} met according to the university’s evaluation.`, `${rows.length === 1 ? "L’unique exigence du diplôme est remplie" : `Les ${rows.length} exigences du diplôme sont remplies`} selon l’évaluation de l’université.`)
        : t(`Requirements still to meet (${open.length} of ${rows.length}): ${shown.map(line).join("; ")}${open.length > shown.length ? `; and ${open.length - shown.length} more` : ""}. The university decides which credits satisfy each requirement; the figures come from your own roadmap and degree progress.`,
            `Exigences encore à remplir (${open.length} sur ${rows.length}) : ${shown.map(line).join(" ; ")}${open.length > shown.length ? ` ; et ${open.length - shown.length} de plus` : ""}. L’université décide quels crédits satisfont chaque exigence; les chiffres proviennent de votre propre feuille de route et de votre progression.`);
    out.push({ label: "Degree requirements", title: t("Degree requirements", "Exigences du diplôme"), path: "/roadmap", text });
  }

  // Next open work from the published roadmap (courses/tasks the student can act on), earliest dated first.
  if (published && roadmap) {
    const items = [...roadmap.phases].sort((a, b) => a.sequence - b.sequence).flatMap((p) => [...p.items].sort((a, b) => a.sequence - b.sequence)).filter(active);
    const open: { title: string; course: string; due: string | null; overdue: boolean }[] = [];
    for (const item of items) {
      if (!item.canReport || done(item)) continue;
      const overdue = (d: string | null) => !!d && d < today;
      if (item.tasks.length === 0) open.push({ title: clip(item.title, 90), course: clip(item.title, 90), due: item.plannedEnd, overdue: overdue(item.plannedEnd) });
      else for (const k of item.tasks.filter((x) => x.status === "not_started" || x.status === "in_progress")) open.push({ title: clip(k.title, 90), course: clip(item.title, 90), due: k.dueDate, overdue: overdue(k.dueDate) });
    }
    const dated = open.filter((o) => o.due).sort((a, b) => String(a.due).localeCompare(String(b.due)));
    const next = (dated.length ? dated : open).slice(0, 4);
    if (next.length) {
      out.push({ label: "Next tasks", title: t("Next tasks", "Prochaines tâches"), path: "/roadmap", text: t(
        `Your next open tasks: ${next.map((o) => `${o.title}${o.title === o.course ? "" : ` — ${o.course}`}${o.due ? `, planned by ${fmtDate(o.due, "en")}` : ""}${o.overdue ? " (overdue)" : ""}`).join("; ")}.`,
        `Vos prochaines tâches ouvertes : ${next.map((o) => `${o.title}${o.title === o.course ? "" : ` — ${o.course}`}${o.due ? `, prévue d’ici le ${fmtDate(o.due, "fr")}` : ""}${o.overdue ? " (en retard)" : ""}`).join(" ; ")}.`) });
    }
  }
  return out;
}
