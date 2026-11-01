/**
 * S30 — Fleet AI Copilot, deterministic core (pure). Answers the owner's portfolio questions from REAL records:
 * the Control Center (its exception queue and student rows), the owner's exception state, and the academic calendar.
 *
 * Output separates:
 *   facts        recorded facts, each tied to an evidence tier and to traceable record references [F#]
 *   suggestions  rule-based suggestions, labelled as suggestions (never presented as facts)
 *   drafts       editable message drafts; never sent by the server (requiresReview: true)
 * Student-reported, provider-reported and verified results are never merged: a fact carries its tier.
 * Synthetic demo students are excluded unless includeDemo is set (and are then labelled).
 */
import type { ControlStudentRow, QueueKind } from "@shared/s27-contract";
import type {
  CalendarItem,
  FleetAnswer,
  FleetDraft,
  FleetFact,
  FleetIntent,
  FleetRecordRef,
  FleetSuggestion,
  OpsExceptionView,
  OpsSeverity,
} from "@shared/s30-contract";
import { FLEET_INTENTS } from "@shared/s30-contract";

export interface FleetInput {
  readonly now: Date;
  readonly students: readonly ControlStudentRow[];
  readonly exceptions: readonly OpsExceptionView[];
  readonly calendar: readonly CalendarItem[];
  /** Planned completion target per student (from the published plan), when set. */
  readonly targets: ReadonlyMap<string, string>;
  readonly truncated: boolean;
}

// ── question -> intent (deterministic; EN + FR) ─────────────────────────────

const RULES: ReadonlyArray<[FleetIntent, RegExp]> = [
  ["french_followups", /\b(french|fran[cç]ais|follow[- ]?up|relance|suivi|message|draft|brouillon|r[ée]dige)/i],
  ["support_waiting", /\b(support|ticket|conversation|repl(y|ies)|r[ée]pon(se|dre)|waiting for|en attente de r[ée]ponse|demande)/i],
  ["behind_pace", /\b(behind|pace|falling|rythme|retard sur|en retard|planned pace|cadence)/i],
  ["deadlines_soon", /\b(deadline|due|[ée]ch[ée]ance|approaching|date limite|bient[oô]t)/i],
  ["enrollment_document_issues", /\b(enrol+ment|document|inscription|pi[eè]ce|unresolved|non r[ée]solu|dossier)/i],
  ["no_recent_progress", /\b(no progress|not made progress|inactive|recent(ly)?|progress|progr[eè]s|inactif|aucune activit)/i],
  ["priorities_week", /\b(priorit|this week|cette semaine|highest|plus important|actions?)/i],
  ["attention_today", /\b(attention|today|aujourd|need|besoin|urgent)/i],
];
export function intentFromQuestion(q: string): FleetIntent | null {
  for (const [intent, re] of RULES) if (re.test(q)) return intent;
  return null;
}
export const isFleetIntent = (v: unknown): v is FleetIntent => typeof v === "string" && (FLEET_INTENTS as readonly string[]).includes(v);

// ── helpers ──────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const daysUntil = (today: string, date: string) => Math.round((Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
const SEV_RANK: Record<OpsSeverity, number> = { critical: 0, warning: 1, info: 2 };
const studentHref = (id: string, tab = "overview") => `/admin/students/${encodeURIComponent(id)}?tab=${tab}`;
const KIND_TIER: Partial<Record<QueueKind, FleetFact["tier"]>> = {
  low_grade: "student_reported", inactive: "student_reported", school_result_needed: "student_reported",
  import_review: "provider_reported", document_review: "submitted_evidence", payment_evidence: "submitted_evidence",
};
const ENROLLMENT_KINDS: readonly QueueKind[] = ["document_review", "payment_evidence", "payment_missing", "deadline_soon", "school_result_needed", "import_review"];
const SUPPORT_KINDS: readonly QueueKind[] = ["support_reply", "elective_approval", "session_request"];
const FIRST_NAME = (name: string) => name.trim().split(/\s+/)[0] || name;

class Refs {
  readonly list: FleetRecordRef[] = [];
  private readonly byKey = new Map<string, string>();
  add(key: string, r: Omit<FleetRecordRef, "ref">): string {
    const have = this.byKey.get(key);
    if (have) return have;
    const ref = `F${this.list.length + 1}`;
    this.list.push({ ref, ...r });
    this.byKey.set(key, ref);
    return ref;
  }
}

// ── message drafts (editable; never sent by the server) ─────────────────────

const DRAFTS = {
  fr: {
    inactive: { s: "Petit suivi de votre parcours Lumière", b: "Bonjour {first},\n\nNous n’avons pas vu de nouvelle activité dans votre parcours depuis {since}. Tout va bien ? Si vous avez besoin d’aide pour reprendre le rythme, nous pouvons planifier un court appel cette semaine.\n\nAu plaisir d’avoir de vos nouvelles,\nL’équipe Lumière" },
    deadline: { s: "Rappel : une échéance approche", b: "Bonjour {first},\n\nPetit rappel : « {what} » est prévu pour le {date}. Si quelque chose vous bloque, dites-le-nous et nous trouverons une solution ensemble.\n\nBien cordialement,\nL’équipe Lumière" },
    document: { s: "Votre dossier : un document à finaliser", b: "Bonjour {first},\n\nNous avons bien reçu votre document et nous le vérifions. Nous vous écrirons dès que la vérification sera terminée ; aucune action n’est requise de votre part pour l’instant.\n\nBien cordialement,\nL’équipe Lumière" },
    support: { s: "Suite à votre demande", b: "Bonjour {first},\n\nMerci pour votre message. Nous l’avons bien reçu et nous revenons vers vous très rapidement avec une réponse complète.\n\nBien cordialement,\nL’équipe Lumière" },
    grade: { s: "Votre dernière évaluation", b: "Bonjour {first},\n\nNous avons vu votre dernier résultat déclaré. C’est tout à fait normal d’avoir une évaluation plus difficile : voulez-vous que nous regardions ensemble comment préparer la prochaine ?\n\nBien cordialement,\nL’équipe Lumière" },
    payment: { s: "Votre échéancier de paiement", b: "Bonjour {first},\n\nPetit rappel au sujet de votre échéancier : un versement est arrivé à échéance. Si un ajustement est nécessaire, contactez-nous et nous en discuterons.\n\nBien cordialement,\nL’équipe Lumière" },
    generic: { s: "Un point sur votre parcours", b: "Bonjour {first},\n\nNous faisons un point rapide sur votre parcours Lumière. Avez-vous un moment cette semaine pour en parler ?\n\nBien cordialement,\nL’équipe Lumière" },
  },
  en: {
    inactive: { s: "Checking in on your Lumière journey", b: "Hello {first},\n\nWe have not seen new activity in your plan since {since}. Is everything all right? If it would help to get back on track, we can schedule a short call this week.\n\nWarm regards,\nThe Lumière team" },
    deadline: { s: "Reminder: a deadline is coming up", b: "Hello {first},\n\nA quick reminder: “{what}” is due on {date}. If anything is in the way, let us know and we will work it out together.\n\nWarm regards,\nThe Lumière team" },
    document: { s: "Your file: a document in review", b: "Hello {first},\n\nWe received your document and are reviewing it. We will write as soon as the review is complete; nothing is needed from you for now.\n\nWarm regards,\nThe Lumière team" },
    support: { s: "About your request", b: "Hello {first},\n\nThank you for your message. We have received it and will come back to you shortly with a complete answer.\n\nWarm regards,\nThe Lumière team" },
    grade: { s: "Your latest assessment", b: "Hello {first},\n\nWe saw your latest reported result. A harder assessment is completely normal: would you like to look together at how to prepare for the next one?\n\nWarm regards,\nThe Lumière team" },
    payment: { s: "Your payment schedule", b: "Hello {first},\n\nA quick note about your payment schedule: an instalment has come due. If an adjustment would help, contact us and we will discuss it.\n\nWarm regards,\nThe Lumière team" },
    generic: { s: "A quick check-in", b: "Hello {first},\n\nWe are doing a quick review of your Lumière journey. Do you have a moment this week to talk?\n\nWarm regards,\nThe Lumière team" },
  },
} as const;
type DraftKey = keyof (typeof DRAFTS)["en"];
const DRAFT_FOR_KIND: Partial<Record<QueueKind, DraftKey>> = {
  inactive: "inactive", deadline_soon: "deadline", document_review: "document", support_reply: "support", elective_approval: "support",
  session_request: "support", low_grade: "grade", payment_overdue: "payment", payment_missing: "payment",
};
const fmtDate = (d: string, lang: "en" | "fr") => new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${d.slice(0, 10)}T12:00:00Z`));

export function buildDraft(lang: "en" | "fr", key: DraftKey, student: { id: string; name: string }, vars: { since?: string; what?: string; date?: string }, basedOn: readonly string[]): FleetDraft {
  const t = DRAFTS[lang][key];
  const fill = (s: string) => s.replace("{first}", FIRST_NAME(student.name)).replace("{since}", vars.since ? fmtDate(vars.since, lang) : lang === "fr" ? "quelque temps" : "a while")
    .replace("{what}", vars.what ?? "").replace("{date}", vars.date ? fmtDate(vars.date, lang) : "");
  return { studentId: student.id, studentName: student.name, language: lang, subject: t.s, body: fill(t.b), basedOn, requiresReview: true, sendHref: `/admin/students/${encodeURIComponent(student.id)}?tab=overview` };
}

// ── answer ───────────────────────────────────────────────────────────────────

export function buildFleetAnswer(input: FleetInput, req: { intent: FleetIntent; matchedFrom: FleetAnswer["matchedFrom"]; language: "en" | "fr"; includeDemo: boolean }): Omit<FleetAnswer, "ai"> {
  const today = input.now.toISOString().slice(0, 10);
  const lang = req.language;
  const studentsById = new Map(input.students.map((s) => [s.studentId, s] as const));
  const allowed = (id: string) => { const s = studentsById.get(id); return !!s && (req.includeDemo || !s.isDemo); };
  const refs = new Refs();
  const facts: FleetFact[] = [];
  const suggestions: FleetSuggestion[] = [];
  const drafts: FleetDraft[] = [];
  const totals: Record<string, number> = {};
  const bump = (k: string, n = 1) => { totals[k] = (totals[k] ?? 0) + n; };
  const openEx = input.exceptions.filter((e) => e.state === "open" && allowed(e.studentId));
  const who = (id: string) => { const s = studentsById.get(id)!; return { studentId: id, studentName: s.name, studentCode: s.code, isDemo: s.isDemo }; };
  const exRef = (e: OpsExceptionView) => refs.add(`ex:${e.id}`, { kind: e.kind === "support_reply" ? "ticket" : e.kind === "import_review" ? "import" : "exception", label: e.title, href: e.href });
  const stRef = (id: string) => refs.add(`st:${id}`, { kind: "student", label: studentsById.get(id)?.name ?? id, href: studentHref(id) });
  const calRef = (c: CalendarItem) => refs.add(`cal:${c.id}`, { kind: "calendar", label: c.title, href: c.href });
  const exceptionFact = (e: OpsExceptionView): FleetFact => ({
    ...who(e.studentId), code: `exception.${e.kind}`, params: { at: e.at ? e.at.slice(0, 10) : null, detail: lang === "en" ? e.detail : null },
    severity: e.severity, tier: KIND_TIER[e.kind] ?? "operational", refs: [exRef(e)], action: { code: `action.${e.kind}`, href: e.href },
  });
  const sortEx = (list: OpsExceptionView[]) => [...list].sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || (a.at ?? "9999").localeCompare(b.at ?? "9999") || a.id.localeCompare(b.id));

  const upcoming = input.calendar.filter((c) => allowed(c.studentId) && c.status !== "done" && c.status !== "cancelled");
  const deadlineKinds = new Set(["academic_deadline", "document_deadline", "course_milestone", "program_checkpoint"]);

  switch (req.intent) {
    case "attention_today": {
      for (const e of sortEx(openEx.filter((x) => x.severity !== "info"))) { facts.push(exceptionFact(e)); bump(e.severity); }
      const studentsNeeding = new Set(facts.map((f) => f.studentId));
      bump("students", studentsNeeding.size);
      if (facts.some((f) => f.severity === "critical")) suggestions.push({ code: "start_with_critical", params: { n: facts.filter((f) => f.severity === "critical").length }, refs: facts.filter((f) => f.severity === "critical").slice(0, 5).flatMap((f) => f.refs) });
      break;
    }
    case "no_recent_progress": {
      for (const s of input.students) {
        if (!allowed(s.studentId) || s.program === "none" || s.status.label === "Pre-enrollment") continue;
        const days = s.lastActivityOn ? -daysUntil(today, s.lastActivityOn) : null;
        if (days === null && s.program !== "high_school") continue;
        if (days !== null && days < 7) continue;
        facts.push({ ...who(s.studentId), code: days === null ? "never_logged" : "inactive_days", params: { days, since: s.lastActivityOn }, severity: days === null || days >= 14 ? "warning" : "info",
          tier: "student_reported", refs: [stRef(s.studentId)], action: { code: "action.open_roadmap", href: studentHref(s.studentId, "roadmap") } });
        bump("inactive");
      }
      facts.sort((a, b) => Number(b.params.days ?? 9999) - Number(a.params.days ?? 9999));
      if (facts.length) suggestions.push({ code: "send_checkins", params: { n: facts.length }, refs: facts.slice(0, 5).flatMap((f) => f.refs) });
      break;
    }
    case "deadlines_soon": {
      for (const c of upcoming) {
        if (!deadlineKinds.has(c.kind)) continue;
        const d = daysUntil(today, c.start);
        if (d > 14 || d < -14) continue;
        facts.push({ ...who(c.studentId), code: d < 0 ? "deadline_overdue" : "deadline_in_days", params: { days: Math.abs(d), date: c.start.slice(0, 10), itemKind: c.kind, title: c.titleKey ? null : c.title, titleKey: c.titleKey },
          severity: d < 0 ? "critical" : d <= 3 ? "warning" : "info", tier: c.source === "agreement" || c.source === "calendar_event" || c.source === "checkpoint" ? "operational" : "planned",
          refs: [calRef(c)], action: { code: "action.open_calendar", href: c.href } });
        bump(d < 0 ? "overdue" : "upcoming");
      }
      facts.sort((a, b) => String(a.params.date).localeCompare(String(b.params.date)));
      break;
    }
    case "enrollment_document_issues": {
      for (const e of sortEx(openEx.filter((x) => ENROLLMENT_KINDS.includes(x.kind) && (x.kind !== "deadline_soon" || x.id.endsWith(":prior_schooling_proof") || x.id.endsWith(":language_test"))))) { facts.push(exceptionFact(e)); bump(e.kind); }
      for (const s of input.students) {
        if (!allowed(s.studentId) || s.status.tone !== "gold") continue;
        facts.push({ ...who(s.studentId), code: "pre_enrollment", params: {}, severity: "info", tier: "operational", refs: [stRef(s.studentId)], action: { code: "action.open_file", href: studentHref(s.studentId) } });
        bump("pre_enrollment");
      }
      break;
    }
    case "support_waiting": {
      for (const e of sortEx(openEx.filter((x) => SUPPORT_KINDS.includes(x.kind)))) {
        const waited = e.at ? -daysUntil(today, e.at) : null;
        facts.push({ ...exceptionFact(e), params: { at: e.at ? e.at.slice(0, 10) : null, days: waited, detail: lang === "en" ? e.detail : null } });
        bump(e.kind);
      }
      facts.sort((a, b) => Number(b.params.days ?? 0) - Number(a.params.days ?? 0));
      if (facts.some((f) => Number(f.params.days ?? 0) >= 2)) suggestions.push({ code: "reply_oldest_first", params: { n: facts.filter((f) => Number(f.params.days ?? 0) >= 2).length }, refs: facts.slice(0, 3).flatMap((f) => f.refs) });
      break;
    }
    case "behind_pace": {
      const overdueMilestones = new Map<string, CalendarItem[]>();
      for (const c of input.calendar) if (allowed(c.studentId) && c.kind === "course_milestone" && c.status === "overdue") overdueMilestones.set(c.studentId, [...(overdueMilestones.get(c.studentId) ?? []), c]);
      for (const s of input.students) {
        if (!allowed(s.studentId) || s.program === "none") continue;
        const target = input.targets.get(s.studentId) ?? null;
        const missed = overdueMilestones.get(s.studentId) ?? [];
        const late = target && s.estimatedFinishOn && s.estimatedFinishOn > target;
        const stalled = target && !s.estimatedFinishOn && s.paceLabel !== null;
        if (!late && !stalled && missed.length < 2) continue;
        facts.push({
          ...who(s.studentId), code: late ? "finish_after_target" : stalled ? "no_pace_with_target" : "missed_milestones",
          params: { estimated: s.estimatedFinishOn, target, missed: missed.length, credits: s.creditsConfirmed, required: s.creditsRequired },
          severity: late || missed.length >= 3 ? "warning" : "info", tier: "student_reported",
          refs: [stRef(s.studentId), ...missed.slice(0, 3).map(calRef)], action: { code: "action.open_roadmap", href: studentHref(s.studentId, "roadmap") },
        });
        bump("behind");
      }
      if (facts.length) suggestions.push({ code: "review_plans", params: { n: facts.length }, refs: facts.slice(0, 5).flatMap((f) => f.refs.slice(0, 1)) });
      break;
    }
    case "priorities_week": {
      // Score: critical exception 100, warning 40 (+ age), deadline ≤7 days 60 - days, support waiting ≥2 days 50.
      const scored: Array<{ score: number; fact: FleetFact }> = [];
      for (const e of openEx) {
        if (e.severity === "info" && !SUPPORT_KINDS.includes(e.kind)) continue;
        const age = e.at ? Math.max(0, -daysUntil(today, e.at)) : 0;
        const score = (e.severity === "critical" ? 100 : e.severity === "warning" ? 40 : 20) + Math.min(age, 30) + (SUPPORT_KINDS.includes(e.kind) && age >= 2 ? 30 : 0);
        scored.push({ score, fact: exceptionFact(e) });
      }
      for (const c of upcoming) {
        if (!deadlineKinds.has(c.kind) && c.kind !== "orientation" && c.kind !== "advisor_meeting") continue;
        const d = daysUntil(today, c.start);
        if (d < 0 || d > 7) continue;
        scored.push({ score: 60 - d * 5, fact: { ...who(c.studentId), code: "deadline_in_days", params: { days: d, date: c.start.slice(0, 10), itemKind: c.kind, title: c.titleKey ? null : c.title, titleKey: c.titleKey },
          severity: d <= 2 ? "warning" : "info", tier: "planned", refs: [calRef(c)], action: { code: "action.open_calendar", href: c.href } } });
      }
      scored.sort((a, b) => b.score - a.score || a.fact.studentName.localeCompare(b.fact.studentName));
      for (const s of scored.slice(0, 12)) facts.push(s.fact);
      bump("actions", facts.length);
      bump("candidates", scored.length);
      if (scored.length > 12) suggestions.push({ code: "more_in_queue", params: { n: scored.length - 12 }, refs: [] });
      break;
    }
    case "french_followups": {
      const byStudent = new Map<string, OpsExceptionView>();
      for (const e of sortEx(openEx)) if (DRAFT_FOR_KIND[e.kind] && !byStudent.has(e.studentId)) byStudent.set(e.studentId, e);
      for (const e of [...byStudent.values()].slice(0, 8)) {
        const s = studentsById.get(e.studentId)!;
        const key = DRAFT_FOR_KIND[e.kind]!;
        const fact = exceptionFact(e);
        facts.push(fact);
        const cal = key === "deadline" ? upcoming.find((c) => c.studentId === e.studentId && (c.kind === "academic_deadline" || c.kind === "document_deadline")) : undefined;
        drafts.push(buildDraft("fr", key, { id: s.studentId, name: s.name }, { since: s.lastActivityOn ?? undefined, what: cal ? (cal.titleKey ? (cal.kind === "document_deadline" ? "la preuve de scolarité antérieure" : "le test de langue") : cal.title) : "votre prochaine étape", date: cal?.start ?? e.at ?? undefined }, fact.refs));
      }
      bump("drafts", drafts.length);
      break;
    }
  }

  // Suggested drafts for support replies in the requested language (always editable, never sent).
  if (req.intent === "support_waiting") {
    for (const f of facts.slice(0, 5)) drafts.push(buildDraft(lang, "support", { id: f.studentId, name: f.studentName }, {}, f.refs));
  }
  return {
    intent: req.intent, matchedFrom: req.matchedFrom, language: lang, generatedAt: input.now.toISOString(),
    facts, suggestions, drafts, records: refs.list, totals, truncated: input.truncated,
  };
}

/** Anonymised aggregate payload for the configured model: counts only, no names, codes, ids, titles or dates. */
export function anonymisedAggregates(answer: Omit<FleetAnswer, "ai">): Record<string, number | string> {
  const out: Record<string, number | string> = { question_type: answer.intent, facts: answer.facts.length, students: new Set(answer.facts.map((f) => f.studentId)).size };
  for (const [k, v] of Object.entries(answer.totals)) out[`total_${k}`] = v;
  const bySeverity: Record<string, number> = {};
  const byCode: Record<string, number> = {};
  for (const f of answer.facts) { bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1; byCode[f.code] = (byCode[f.code] ?? 0) + 1; }
  for (const [k, v] of Object.entries(bySeverity)) out[`severity_${k}`] = v;
  for (const [k, v] of Object.entries(byCode)) out[`kind_${k.replace(/[^a-z0-9_]/gi, "_")}`] = v;
  return out;
}
