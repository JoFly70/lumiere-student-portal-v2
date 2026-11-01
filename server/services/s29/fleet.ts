/**
 * S29 — Fleet AI Copilot (admin only): portfolio-wide questions over the SAME attention items as the Control Center.
 *
 * 1. Deterministic first: the question is classified (EN/FR keywords) into an intent; the answer is built from the
 *    persisted attention items with traceable references [A1]... linking to the student dossiers. Student-reported
 *    claims and institution-verified outcomes are labelled; demo students are excluded unless asked.
 * 2. Drafts (follow-up messages) are produced from fixed EN/FR templates over recorded facts — never sent, never
 *    saved; a human copies them into the support desk.
 * 3. Optional AI narrative (Muse Spark Contributor, pinned model, budget-guarded): it receives ONLY aggregate counts
 *    per category / priority / age bucket — no names, codes, ids, dates of birth, documents, messages or any
 *    combination that identifies a student. If that cannot answer the question, the deterministic answer stands.
 */
import type { AttentionItemView, FleetAnswer, FleetDraft, FleetIntent, FleetReference } from "@shared/s29-contract";
import { loadAssistantConfig, estimateCostUsd, type AssistantConfig } from "../academic-assistant/config";
import { callMuseSpark, ProviderError, type FetchLike } from "../academic-assistant/meta-adapter";
import { currentMonth, usdToMicro, type BudgetStore } from "../academic-assistant/budget";
import { logger } from "../../lib/logger";
import { formatDate } from "./templates";

type Lang = "en" | "fr";

const INTENT_RULES: Array<{ intent: FleetIntent; re: RegExp }> = [
  { intent: "draft_followups", re: /\b(draft|prepare|write|rédige|prépar|écri|message|relance|follow[- ]?up)/i },
  { intent: "documents_blocking", re: /\b(document|pièce|papier|enrol|inscri|holding|bloqu)/i },
  { intent: "support_waiting", re: /\b(support|ticket|assistance|demande|waiting longest|attend.*longtemps|longest)/i },
  { intent: "no_recent_progress", re: /\b(progress|progrès|progression|inactive|inactif|not reported|pas.*(déclaré|signalé)|recently|récemment)/i },
  { intent: "week_priorities", re: /\b(this week|cette semaine|week|semaine|priorit|most important|plus important)/i },
  { intent: "attention_today", re: /\b(today|aujourd|attention|need|besoin|urgent)/i },
];

export function classifyIntent(question: string): FleetIntent {
  for (const r of INTENT_RULES) if (r.re.test(question)) return r.intent;
  return "overview";
}

const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 } as const;

function selectItems(intent: FleetIntent, items: readonly AttentionItemView[], now: Date): AttentionItemView[] {
  const open = items.filter((i) => i.status === "open");
  const byAge = (a: AttentionItemView, b: AttentionItemView) => (a.arisenAt ?? a.detectedAt).localeCompare(b.arisenAt ?? b.detectedAt);
  const byPri = (a: AttentionItemView, b: AttentionItemView) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byAge(a, b);
  const weekEnd = now.getTime() + 7 * 86_400_000;
  const dueWithinWeek = (i: AttentionItemView) => {
    const d = i.reason.facts.dueOn ?? i.reason.facts.slotAt ?? i.reason.facts.plannedOn;
    return typeof d === "string" && Date.parse(d) <= weekEnd;
  };
  switch (intent) {
    case "no_recent_progress": return open.filter((i) => i.kind === "inactive").sort(byAge);
    case "documents_blocking": return open.filter((i) => i.kind === "document_review" || (i.kind === "deadline_soon") || i.kind === "import_verification").sort(byPri);
    case "support_waiting": return open.filter((i) => i.kind === "support_reply").sort(byAge);
    case "draft_followups": return open.filter((i) => ["deadline_soon", "payment_overdue", "inactive", "checkpoint_soon", "orientation_upcoming"].includes(i.kind) && i.studentId).sort(byPri);
    case "week_priorities": return open.filter((i) => i.priority === "urgent" || i.priority === "high" || dueWithinWeek(i)).sort(byPri);
    case "attention_today": return open.filter((i) => i.priority === "urgent" || i.priority === "high").sort(byPri);
    default: return [...open].sort(byPri);
  }
}

const KIND_LABEL: Record<string, { en: string; fr: string }> = {
  document_review: { en: "documents to review", fr: "documents à vérifier" },
  payment_evidence: { en: "payment proofs to review", fr: "preuves de paiement à vérifier" },
  payment_overdue: { en: "instalments due or overdue", fr: "versements dus ou en retard" },
  payment_missing: { en: "signed, no payment recorded", fr: "signé, aucun paiement enregistré" },
  deadline_soon: { en: "file deadlines", fr: "échéances du dossier" },
  inactive: { en: "no recent progress logged", fr: "aucun progrès récent enregistré" },
  low_grade: { en: "low student-reported scores", fr: "scores déclarés faibles" },
  school_result_needed: { en: "courses awaiting the school's result", fr: "cours en attente du résultat de l’école" },
  elective_approval: { en: "elective requests", fr: "demandes de cours au choix" },
  session_request: { en: "session requests", fr: "demandes de séance" },
  support_reply: { en: "support tickets waiting on staff", fr: "demandes d’assistance en attente de l’équipe" },
  checkpoint_missed: { en: "missed checkpoints", fr: "points d’étape dépassés" },
  checkpoint_soon: { en: "upcoming checkpoints", fr: "points d’étape à venir" },
  orientation_upcoming: { en: "orientation sessions coming up", fr: "séances d’orientation à venir" },
  import_verification: { en: "imported results to verify", fr: "résultats importés à vérifier" },
  notification_failed: { en: "failed email deliveries", fr: "envois de courriel échoués" },
};
const PRIORITY_LABEL = { urgent: { en: "urgent", fr: "urgente" }, high: { en: "high", fr: "élevée" }, normal: { en: "normal", fr: "normale" }, low: { en: "low", fr: "faible" } } as const;

function provenanceOf(i: AttentionItemView): FleetReference["provenance"] {
  if (i.kind === "low_grade" || i.kind === "school_result_needed" || i.kind === "import_verification") return "student_reported";
  return "fact";
}

function ageText(i: AttentionItemView, now: Date, lang: Lang): string {
  const at = i.arisenAt ?? i.detectedAt;
  const days = Math.max(0, Math.floor((now.getTime() - Date.parse(at)) / 86_400_000));
  if (Date.parse(at) > now.getTime()) {
    const ahead = Math.ceil((Date.parse(at) - now.getTime()) / 86_400_000);
    return lang === "fr" ? `dans ${ahead} j` : `in ${ahead} d`;
  }
  return lang === "fr" ? (days === 0 ? "aujourd’hui" : `depuis ${days} j`) : (days === 0 ? "today" : `${days} d ago`);
}

const INTRO: Record<FleetIntent, { en: (n: number) => string; fr: (n: number) => string }> = {
  attention_today: { en: (n) => (n ? `${n} item(s) need your attention today (urgent or high priority).` : "Nothing urgent or high priority is open today."), fr: (n) => (n ? `${n} élément(s) demandent votre attention aujourd’hui (priorité urgente ou élevée).` : "Rien d’urgent ni de prioritaire n’est ouvert aujourd’hui.") },
  no_recent_progress: { en: (n) => (n ? `${n} student(s) have no progress logged within the configured threshold.` : "Every active student has logged progress within the threshold."), fr: (n) => (n ? `${n} élève(s) n’ont enregistré aucun progrès dans le délai configuré.` : "Chaque élève actif a enregistré un progrès dans le délai.") },
  documents_blocking: { en: (n) => (n ? `${n} document item(s) are holding up files (reviews, file deadlines, imported results to verify).` : "No document is holding up a file right now."), fr: (n) => (n ? `${n} élément(s) documentaires bloquent des dossiers (vérifications, échéances, résultats importés à vérifier).` : "Aucun document ne bloque de dossier pour le moment.") },
  week_priorities: { en: (n) => (n ? `Your ${n} most important item(s) this week, highest priority first.` : "Nothing important is due this week."), fr: (n) => (n ? `Vos ${n} éléments les plus importants cette semaine, par priorité.` : "Rien d’important n’est prévu cette semaine.") },
  support_waiting: { en: (n) => (n ? `${n} support ticket(s) are waiting on staff, longest wait first.` : "No support ticket is waiting on staff."), fr: (n) => (n ? `${n} demande(s) d’assistance attendent l’équipe, la plus ancienne d’abord.` : "Aucune demande d’assistance n’attend l’équipe.") },
  draft_followups: { en: (n) => (n ? `${n} follow-up draft(s) prepared from recorded facts. Review, edit and send them yourself; nothing was sent.` : "No student currently has an approaching deadline or follow-up to draft."), fr: (n) => (n ? `${n} brouillon(s) de relance préparés à partir des faits enregistrés. Relisez, modifiez et envoyez-les vous-même ; rien n’a été envoyé.` : "Aucun élève n’a actuellement d’échéance proche ni de relance à rédiger.") },
  overview: { en: (n) => `${n} open item(s) across the portfolio, highest priority first.`, fr: (n) => `${n} élément(s) ouverts dans l’ensemble des dossiers, par priorité.` },
};

export function draftFor(i: AttentionItemView, lang: Lang): FleetDraft | null {
  if (!i.studentId || !i.studentName) return null;
  const first = i.studentName.split(" ")[0] ?? i.studentName;
  const f = i.reason.facts;
  const due = typeof f.dueOn === "string" ? formatDate(f.dueOn, lang) : typeof f.plannedOn === "string" ? formatDate(String(f.plannedOn), lang) : typeof f.slotAt === "string" ? formatDate(String(f.slotAt), lang, "UTC", true) : "";
  const since = typeof f.since === "string" ? formatDate(f.since, lang) : "";
  const T = {
    en: {
      deadline_soon: [`Upcoming deadline in your file`, `Hello ${first},\n\nA quick reminder: a deadline in your Lumière file is on ${due}. You can see what is needed in your Flight Deck. If anything is unclear, just reply here and we will help.\n\nWarm regards,\nThe Lumière team`],
      payment_overdue: [`Your payment schedule`, `Hello ${first},\n\nAccording to your payment schedule, an instalment is due on ${due}. If you have already paid, you can send the proof from Billing. Do not hesitate to write to us with any question.\n\nWarm regards,\nThe Lumière team`],
      inactive: [`Checking in on your progress`, `Hello ${first},\n\nWe have not seen new work logged since ${since}. How are things going? When you are ready, log your latest lesson or exam in your Roadmap, and tell us if we can help you plan the next steps.\n\nWarm regards,\nThe Lumière team`],
      checkpoint_soon: [`Your upcoming checkpoint`, `Hello ${first},\n\nYour next checkpoint with the Lumière team is planned for ${due}. You can prepare from your Flight Deck.\n\nWarm regards,\nThe Lumière team`],
      orientation_upcoming: [`Your orientation session`, `Hello ${first},\n\nThis is a reminder of your orientation session on ${due}. Bring your questions — we look forward to it.\n\nWarm regards,\nThe Lumière team`],
    },
    fr: {
      deadline_soon: [`Échéance à venir dans votre dossier`, `Bonjour ${first},\n\nPetit rappel : une échéance de votre dossier Lumière est prévue le ${due}. Vous trouverez ce qui est nécessaire dans votre tableau de bord. Si quelque chose n’est pas clair, répondez simplement ici et nous vous aiderons.\n\nBien cordialement,\nL’équipe Lumière`],
      payment_overdue: [`Votre échéancier de paiement`, `Bonjour ${first},\n\nSelon votre échéancier, un versement est prévu le ${due}. Si vous avez déjà payé, vous pouvez envoyer la preuve depuis Facturation. N’hésitez pas à nous écrire pour toute question.\n\nBien cordialement,\nL’équipe Lumière`],
      inactive: [`Un point sur votre progression`, `Bonjour ${first},\n\nNous n’avons pas vu de nouveau travail enregistré depuis le ${since}. Comment cela se passe-t-il ? Quand vous serez prêt(e), enregistrez votre dernière leçon ou votre dernier examen dans votre Feuille de route, et dites-nous si nous pouvons vous aider à planifier la suite.\n\nBien cordialement,\nL’équipe Lumière`],
      checkpoint_soon: [`Votre prochain point d’étape`, `Bonjour ${first},\n\nVotre prochain point d’étape avec l’équipe Lumière est prévu le ${due}. Vous pouvez vous y préparer depuis votre tableau de bord.\n\nBien cordialement,\nL’équipe Lumière`],
      orientation_upcoming: [`Votre séance d’orientation`, `Bonjour ${first},\n\nCeci est un rappel de votre séance d’orientation le ${due}. Préparez vos questions — nous nous en réjouissons.\n\nBien cordialement,\nL’équipe Lumière`],
    },
  } as const;
  const t = (T[lang] as Record<string, readonly [string, string]>)[i.kind];
  if (!t) return null;
  return { studentId: i.studentId, studentName: i.studentName, language: lang, subject: t[0], body: t[1], basedOn: [i.key] };
}

/** Aggregate-only context for the AI (no identifiers of any kind). Counts under 3 are bucketed to "1-2". */
export function aggregateContext(items: readonly AttentionItemView[], now: Date): string {
  const open = items.filter((i) => i.status === "open" && !i.isDemo);
  const bucket = (n: number) => (n === 0 ? "0" : n < 3 ? "1-2" : String(n));
  const byKind = new Map<string, { total: number; urgent: number; high: number; over7d: number }>();
  for (const i of open) {
    const k = byKind.get(i.kind) ?? { total: 0, urgent: 0, high: 0, over7d: 0 };
    k.total += 1;
    if (i.priority === "urgent") k.urgent += 1;
    if (i.priority === "high") k.high += 1;
    if (now.getTime() - Date.parse(i.arisenAt ?? i.detectedAt) > 7 * 86_400_000) k.over7d += 1;
    byKind.set(i.kind, k);
  }
  const lines = [...byKind.entries()].sort().map(([k, v]) => `- ${KIND_LABEL[k]?.en ?? k}: ${bucket(v.total)} open (urgent ${bucket(v.urgent)}, high ${bucket(v.high)}, older than 7 days ${bucket(v.over7d)})`);
  return lines.length ? lines.join("\n") : "- no open items";
}

export interface FleetDeps {
  readonly budget: BudgetStore;
  readonly fetchImpl?: FetchLike;
  readonly config?: () => AssistantConfig;
  readonly now?: () => Date;
  /** Opt-in AI narrative (aggregate-only). */
  readonly useAi?: boolean;
}

export async function answerFleet(input: { question: string; language: Lang; includeDemo: boolean }, items: readonly AttentionItemView[], deps: FleetDeps): Promise<FleetAnswer> {
  const now = deps.now?.() ?? new Date();
  const lang = input.language;
  const intent = classifyIntent(input.question);
  const pool = items.filter((i) => input.includeDemo || !i.isDemo);
  const chosen = selectItems(intent, pool, now).slice(0, 25);
  const references: FleetReference[] = chosen.map((i, n) => ({
    ref: `A${n + 1}`, key: i.key, studentId: i.studentId, studentName: i.studentName, isDemo: i.isDemo,
    label: `${i.studentName ?? (lang === "fr" ? "Opérations" : "Operations")}${i.isDemo ? " (demo)" : ""} — ${KIND_LABEL[i.kind]?.[lang] ?? i.kind}`,
    href: i.href, provenance: provenanceOf(i),
  }));
  const lines = chosen.map((i, n) => {
    const prov = provenanceOf(i) === "student_reported" ? (lang === "fr" ? " · déclaré, non officiel" : " · student-reported, not official") : "";
    return { text: `${i.studentName ?? "—"}${i.isDemo ? " (demo)" : ""}: ${KIND_LABEL[i.kind]?.[lang] ?? i.kind} · ${lang === "fr" ? "priorité" : "priority"} ${PRIORITY_LABEL[i.priority][lang]} · ${ageText(i, now, lang)}${prov}`, refs: [`A${n + 1}`] };
  });
  const drafts = intent === "draft_followups" ? chosen.map((i) => draftFor(i, lang)).filter((d): d is FleetDraft => !!d).slice(0, 10) : [];
  const count = intent === "draft_followups" ? drafts.length : chosen.length;
  const privacy = lang === "fr"
    ? "Réponse calculée à partir des dossiers sur le serveur. L’IA, si elle est utilisée, ne reçoit que des totaux anonymes par catégorie : aucun nom, code, identifiant, document ni message."
    : "Answer computed from the records on the server. The AI, when used, receives only anonymous totals per category: no names, codes, ids, documents or messages.";
  const base: FleetAnswer = {
    intent, summary: INTRO[intent][lang](count), lines, references, drafts,
    ai: { mode: "not_requested", text: null }, privacy, requiresHumanApproval: true, generatedAt: now.toISOString(),
  };
  if (!deps.useAi) return base;

  const cfg = (deps.config ?? loadAssistantConfig)();
  if (!cfg.liveEnabled || !cfg.hasApiKey || !cfg.liveRoles.has("admin")) return { ...base, ai: { mode: "unavailable", reason: !cfg.hasApiKey ? "not_configured" : "disabled", text: null } };
  const maxOut = 500;
  const month = currentMonth(now);
  const reserve = usdToMicro(estimateCostUsd(1500, maxOut));
  try {
    if (!(await deps.budget.reserve(month, reserve, usdToMicro(cfg.monthlyBudgetUsd)))) return { ...base, ai: { mode: "unavailable", reason: "budget_exhausted", text: null } };
  } catch {
    return { ...base, ai: { mode: "unavailable", reason: "budget_exhausted", text: null } };
  }
  const system = lang === "fr"
    ? "Vous êtes l’assistant d’exploitation de Lumière. Vous ne recevez que des totaux anonymes. Donnez en français, en moins de 120 mots, un ordre de priorité et deux ou trois conseils d’organisation. Ne mentionnez aucun élève, n’inventez aucun chiffre ni résultat, ne prétendez rien avoir envoyé ou modifié."
    : "You are Lumière's operations assistant. You only receive anonymous totals. In English, under 120 words, give an order of priority and two or three organising tips. Never mention a student, never invent numbers or results, never claim to have sent or changed anything.";
  try {
    const out = await callMuseSpark([
      { role: "developer", content: `${system}\n\nTotals:\n${aggregateContext(pool, now)}` },
      { role: "user", content: `Question category: ${intent.replace(/_/g, " ")}` },
    ], { maxOutputTokens: maxOut, timeoutMs: Math.max(cfg.timeoutMs, 30000), fetchImpl: deps.fetchImpl, model: cfg.model, apiBase: cfg.apiBase });
    try { await deps.budget.settle(month, reserve, usdToMicro(estimateCostUsd(out.promptTokens, out.completionTokens))); } catch { /* conservative */ }
    return { ...base, ai: { mode: "live", text: out.text.slice(0, 1500), model: { requested: cfg.model, served: out.servedModel } } };
  } catch (err) {
    logger.warn("Fleet copilot provider call failed", { kind: err instanceof ProviderError ? err.kind : "unknown" });
    if (err instanceof ProviderError && err.usage) { try { await deps.budget.settle(month, reserve, usdToMicro(estimateCostUsd(err.usage.promptTokens, err.usage.completionTokens))); } catch { /* keep */ } }
    return { ...base, ai: { mode: "unavailable", reason: "provider_error", text: null } };
  }
}
