/**
 * S26 — Lumière Owner AI panel. Admin only; one selected student; read-only.
 * Talks to POST /api/admin/students/:id/owner-assistant. Live answers cite numbered records;
 * when the provider is unavailable the panel says so and shows the deterministic record
 * summary explicitly labelled "not AI". Drafts are copied by a human into the support desk.
 */
import React, { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BrainCircuit, Copy, FileSearch, Info, Loader2, Send, ShieldCheck } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useT, type TranslationKey } from "@/i18n";
import { StaffNotice, StaffPill, staffBtn, staffField } from "@/components/staff/staff-ui";

type Lang = "en" | "fr";
type Task = "answer" | "draft_reply";
interface SourceRef { ref: string; label: string; path: string }
export interface OwnerAnswer {
  mode: "live" | "unavailable";
  reason?: string;
  task: Task;
  reply: string | null;
  recordSummary: string;
  citations: SourceRef[];
  sources: SourceRef[];
  requiresHumanApproval: true;
  generatedAt: string;
}

const REASON_KEYS = ["disabled", "not_configured", "not_eligible", "budget_exhausted", "provider_error"] as const;
const SUGGESTED_KEYS = ["s32dir.aip.sug.1", "s32dir.aip.sug.2", "s32dir.aip.sug.3"] as const;

export function OwnerAssistantPanel({ studentId, studentLabel }: { studentId: string; studentLabel?: string }) {
  const { t, language: uiLanguage } = useT();
  const [question, setQuestion] = useState("");
  const [language, setLanguage] = useState<Lang>(uiLanguage);
  const [history, setHistory] = useState<{ q: string; task: Task; a: OwnerAnswer }[]>([]);
  const base = `/api/admin/students/${encodeURIComponent(studentId)}/owner-assistant`;
  const status = useQuery<{ mode: "live" | "unavailable"; reason?: string }>({
    queryKey: [base, "status"],
    queryFn: () => api.get(`${base}/status`),
    staleTime: 60_000,
  });
  const ask = useMutation({
    mutationFn: (v: { q: string; task: Task }) => api.post<OwnerAnswer>(base, { question: v.q, language, task: v.task }),
    onSuccess: (a, v) => { setHistory((h) => [...h, { q: v.q, task: v.task, a }]); setQuestion(""); },
  });
  const submit = (task: Task, q = question) => { const t = q.trim(); if (t && !ask.isPending) ask.mutate({ q: t, task }); };

  return (
    <section className="space-y-4" aria-labelledby="owner-ai-heading" data-testid="owner-assistant-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-student-gold/15 text-student-gold-ink"><BrainCircuit className="h-5 w-5" aria-hidden="true" /></span>
          <div>
            <h2 id="owner-ai-heading" className="font-serif text-xl tracking-tight text-student-ink">{t("s32dir.ai.title")}</h2>
            <p className="text-sm text-student-muted">
              {t("s32dir.aip.reads.a")}{studentLabel ? <strong>{studentLabel}</strong> : t("s32dir.aip.reads.thisStudent")}{t("s32dir.aip.reads.b")}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status.data?.mode === "live"
            ? <StaffPill tone="gold" className="whitespace-nowrap" testId="owner-ai-mode">{t("s32dir.aip.live")}</StaffPill>
            : <StaffPill tone="attention" className="whitespace-nowrap" testId="owner-ai-mode">{status.isLoading ? t("s32dir.aip.checking") : t("s32dir.aip.unavailable")}</StaffPill>}
          <label className="sr-only" htmlFor="owner-ai-lang">{t("s32dir.aip.lang")}</label>
          <select id="owner-ai-lang" className={`${staffField} h-9 w-auto`} value={language} onChange={(e) => setLanguage(e.target.value as Lang)} data-testid="owner-ai-language">
            <option value="en">English</option>
            <option value="fr">Français</option>
          </select>
        </div>
      </div>

      {status.data?.mode === "unavailable" && (
        <StaffNotice tone="attention" icon={<Info className="h-4 w-4" />} role="status" testId="owner-ai-unavailable">
          {(REASON_KEYS as readonly string[]).includes(status.data.reason ?? "") ? t(`s32dir.aip.reason.${status.data.reason}` as TranslationKey) : t("s32dir.aip.reason.default")} {t("s32dir.aip.stillSummary")}
        </StaffNotice>
      )}

      <ol className="space-y-4" aria-live="polite" data-testid="owner-ai-history">
        {history.map((h, i) => (
          <li key={i} className="space-y-2">
            <p className="ml-auto max-w-[85%] rounded-lg bg-student-seal px-3 py-2 text-sm text-student-seal-ink">
              {h.task === "draft_reply" ? <span className="mr-1 font-semibold">{t("s32dir.aip.draftTag")}</span> : null}{h.q}
            </p>
            <OwnerAnswerView answer={h.a} />
          </li>
        ))}
      </ol>

      {ask.isError && (
        <StaffNotice tone="urgent" role="alert" testId="owner-ai-error">
          {ask.error instanceof ApiError && ask.error.status === 403
            ? (ask.error.code === "CSRF_TOKEN_INVALID" || ask.error.code === "CSRF_TOKEN_MISSING" ? t("s32dir.aip.err.csrf") : t("s32dir.aip.err.adminOnly"))
            : t("s32dir.aip.err.failed")}
        </StaffNotice>
      )}

      {history.length === 0 && (
        <div className="flex flex-wrap gap-2" aria-label={t("s32dir.aip.suggested")}>
          {SUGGESTED_KEYS.map((k) => (
            <button key={k} type="button" className={`${staffBtn.outline} border text-left text-sm`} onClick={() => submit("answer", t(k))} disabled={ask.isPending}>{t(k)}</button>
          ))}
        </div>
      )}

      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); submit("answer"); }}>
        <label htmlFor="owner-ai-question" className="text-sm font-medium text-student-ink">{t("s32dir.aip.ask.label")}</label>
        <textarea
          id="owner-ai-question"
          className={`${staffField} min-h-[84px]`}
          maxLength={800}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t("s32dir.aip.ask.ph")}
          data-testid="owner-ai-input"
        />
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={`${staffBtn.primary} inline-flex items-center gap-2`} disabled={ask.isPending || !question.trim()} data-testid="owner-ai-ask">
            {ask.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />} {t("s32dir.aip.ask")}
          </button>
          <button type="button" className={`${staffBtn.outline} inline-flex items-center gap-2 border`} disabled={ask.isPending || !question.trim()} onClick={() => submit("draft_reply")} data-testid="owner-ai-draft">
            {t("s32dir.aip.draft")}
          </button>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-student-muted"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> {t("s32dir.aip.privacy")}</p>
      </form>
    </section>
  );
}

export function OwnerAnswerView({ answer }: { answer: OwnerAnswer }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const live = answer.mode === "live" && answer.reply;
  return (
    <div className="max-w-[95%] rounded-lg border border-student-line bg-student-card p-4 text-sm" data-testid="owner-ai-answer" data-mode={answer.mode}>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-student-muted">
        {live ? (answer.task === "draft_reply" ? t("s32dir.aip.ans.draft") : t("s32dir.aip.ans.answer")) : t("s32dir.aip.ans.summary")}
      </p>
      <p className="whitespace-pre-wrap leading-relaxed text-student-ink">{live ? answer.reply : answer.recordSummary}</p>
      {live && answer.task === "draft_reply" && (
        <button type="button" className={`${staffBtn.outline} mt-3 inline-flex items-center gap-2 border text-xs`}
          onClick={() => { void navigator.clipboard?.writeText(answer.reply ?? "").then(() => setCopied(true)); }}>
          <Copy className="h-3.5 w-3.5" aria-hidden="true" /> {copied ? t("s32dir.aip.ans.copied") : t("s32dir.aip.ans.copy")}
        </button>
      )}
      {answer.citations.length > 0 && (
        <div className="mt-3 border-t border-student-line pt-2">
          <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-student-muted"><FileSearch className="h-3.5 w-3.5" aria-hidden="true" /> {t("s32dir.aip.ans.sources")}</p>
          <ul className="flex flex-wrap gap-2" data-testid="owner-ai-citations">
            {answer.citations.map((c) => (
              <li key={c.ref}>{c.path
                ? <Link href={c.path} className="rounded border border-student-line px-2 py-0.5 text-xs text-student-ink hover:bg-student-gold/10">{c.ref} · {c.label}</Link>
                : <span className="rounded border border-dashed border-student-line px-2 py-0.5 text-xs text-student-muted">{c.ref} · {c.label}</span>}</li>
            ))}
          </ul>
        </div>
      )}
      {live && answer.citations.length === 0 && <p className="mt-2 text-xs text-student-muted">{t("s32dir.aip.ans.noCite")}</p>}
    </div>
  );
}
