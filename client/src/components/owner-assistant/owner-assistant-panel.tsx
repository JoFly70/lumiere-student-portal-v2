/**
 * S26 — Lumière Owner AI panel. Admin only; one selected student; read-only.
 * Talks to POST /api/admin/students/:id/owner-assistant. Live answers cite numbered records;
 * when the provider is unavailable the panel says so and shows the deterministic record
 * summary explicitly labelled "not AI". Drafts are copied by a human into the support desk.
 */
import React, { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BrainCircuit, Copy, FileSearch, Loader2, Send, ShieldCheck } from "lucide-react";
import { api, ApiError } from "@/lib/api";
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

const REASON_TEXT: Record<string, string> = {
  disabled: "Live AI is switched off for this deployment.",
  not_configured: "No AI provider key is configured on the server.",
  not_eligible: "Live AI is not enabled for this role.",
  budget_exhausted: "This month's AI budget is used up.",
  provider_error: "The AI provider did not answer just now. Try again in a moment.",
};

const SUGGESTED = [
  "For this student, which courses and documents still require action?",
  "Summarize official credits versus student-reported progress.",
  "Which guardian or enrollment checkpoints are still unverified?",
];

export function OwnerAssistantPanel({ studentId, studentLabel }: { studentId: string; studentLabel?: string }) {
  const [question, setQuestion] = useState("");
  const [language, setLanguage] = useState<Lang>("en");
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
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-student-gold/15 text-student-gold-ink"><BrainCircuit className="h-5 w-5" aria-hidden="true" /></span>
          <div>
            <h2 id="owner-ai-heading" className="font-serif text-xl tracking-tight text-student-ink">Lumière Owner AI</h2>
            <p className="text-sm text-student-muted">
              Reads only {studentLabel ? <strong>{studentLabel}</strong> : "this student"}'s saved records, cites them, and never changes anything.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status.data?.mode === "live"
            ? <StaffPill tone="gold" testId="owner-ai-mode">Live AI</StaffPill>
            : <StaffPill tone="attention" testId="owner-ai-mode">{status.isLoading ? "Checking…" : "AI unavailable"}</StaffPill>}
          <label className="sr-only" htmlFor="owner-ai-lang">Answer language</label>
          <select id="owner-ai-lang" className={`${staffField} h-9 w-auto`} value={language} onChange={(e) => setLanguage(e.target.value as Lang)} data-testid="owner-ai-language">
            <option value="en">English</option>
            <option value="fr">Français</option>
          </select>
        </div>
      </div>

      {status.data?.mode === "unavailable" && (
        <StaffNotice tone="attention" role="status" testId="owner-ai-unavailable">
          {REASON_TEXT[status.data.reason ?? ""] ?? "Live AI is unavailable."} You will still get a record summary that is clearly marked as not written by AI.
        </StaffNotice>
      )}

      <ol className="space-y-4" aria-live="polite" data-testid="owner-ai-history">
        {history.map((h, i) => (
          <li key={i} className="space-y-2">
            <p className="ml-auto max-w-[85%] rounded-lg bg-student-ink px-3 py-2 text-sm text-white">
              {h.task === "draft_reply" ? <span className="mr-1 font-semibold">[Draft reply]</span> : null}{h.q}
            </p>
            <OwnerAnswerView answer={h.a} />
          </li>
        ))}
      </ol>

      {ask.isError && (
        <StaffNotice tone="urgent" role="alert" testId="owner-ai-error">
          {ask.error instanceof ApiError && ask.error.status === 403 ? "Only administrators can use Owner AI." : "The request failed. Nothing was changed."}
        </StaffNotice>
      )}

      {history.length === 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Suggested questions">
          {SUGGESTED.map((s) => (
            <button key={s} type="button" className={`${staffBtn.outline} border text-left text-sm`} onClick={() => submit("answer", s)} disabled={ask.isPending}>{s}</button>
          ))}
        </div>
      )}

      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); submit("answer"); }}>
        <label htmlFor="owner-ai-question" className="text-sm font-medium text-student-ink">Ask about this student</label>
        <textarea
          id="owner-ai-question"
          className={`${staffField} min-h-[84px]`}
          maxLength={800}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. What should we follow up on this week?"
          data-testid="owner-ai-input"
        />
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={`${staffBtn.primary} inline-flex items-center gap-2`} disabled={ask.isPending || !question.trim()} data-testid="owner-ai-ask">
            {ask.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />} Ask
          </button>
          <button type="button" className={`${staffBtn.outline} inline-flex items-center gap-2 border`} disabled={ask.isPending || !question.trim()} onClick={() => submit("draft_reply")} data-testid="owner-ai-draft">
            Draft a reply to the student
          </button>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-student-muted"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> No contact details, names or message bodies are sent to the AI. Every use is audited. Drafts are never sent automatically.</p>
      </form>
    </section>
  );
}

export function OwnerAnswerView({ answer }: { answer: OwnerAnswer }) {
  const [copied, setCopied] = useState(false);
  const live = answer.mode === "live" && answer.reply;
  return (
    <div className="max-w-[95%] rounded-lg border border-student-line bg-student-card p-4 text-sm" data-testid="owner-ai-answer" data-mode={answer.mode}>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-student-muted">
        {live ? (answer.task === "draft_reply" ? "AI draft — review before sending" : "AI answer") : "Record summary — not AI"}
      </p>
      <p className="whitespace-pre-wrap leading-relaxed text-student-ink">{live ? answer.reply : answer.recordSummary}</p>
      {live && answer.task === "draft_reply" && (
        <button type="button" className={`${staffBtn.outline} mt-3 inline-flex items-center gap-2 border text-xs`}
          onClick={() => { void navigator.clipboard?.writeText(answer.reply ?? "").then(() => setCopied(true)); }}>
          <Copy className="h-3.5 w-3.5" aria-hidden="true" /> {copied ? "Copied — paste it into the ticket reply" : "Copy draft"}
        </button>
      )}
      {answer.citations.length > 0 && (
        <div className="mt-3 border-t border-student-line pt-2">
          <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-student-muted"><FileSearch className="h-3.5 w-3.5" aria-hidden="true" /> Sources cited</p>
          <ul className="flex flex-wrap gap-2" data-testid="owner-ai-citations">
            {answer.citations.map((c) => (
              <li key={c.ref}><Link href={c.path} className="rounded border border-student-line px-2 py-0.5 text-xs text-student-ink hover:bg-student-gold/10">{c.ref} · {c.label}</Link></li>
            ))}
          </ul>
        </div>
      )}
      {live && answer.citations.length === 0 && <p className="mt-2 text-xs text-student-muted">The AI cited no records for this answer: treat it with care.</p>}
    </div>
  );
}
