/** Section D: the master's thesis. Submitted is never presented as passed. */
import React, { useId, useState } from "react";
import { CalendarClock, Check, ShieldAlert } from "lucide-react";
import type { StudentGraduateProgramView } from "@shared/graduate-program-contract";
import { cn } from "@/lib/utils";
import { Pill, SectionHeading, StatusPill, buttonClass, cardClass } from "@/components/student-progress/student-ui";
import { useGraduateActions } from "./graduate-actions";
import { SECTION_IDS, TOPIC_APPROVAL_LABEL, formatCount, formatDate, thesisOutcomeDisplay, thesisStrip, validateTopic } from "./graduate-presentation";

type Thesis = NonNullable<StudentGraduateProgramView["thesis"]>;

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : "We could not save that. Please try again.");

function TopicForm({ programId, thesis }: { programId: string; thesis: Thesis }) {
  const actions = useGraduateActions();
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(thesis.topic ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const invalid = validateTopic(value);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await actions.saveThesisPlan(programId, { topic: value.trim() });
      setSaved(true);
      setOpen(false);
    } catch (err) {
      setError(message(err)); // keep what the student typed
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <div className="space-y-1">
        <button type="button" className={buttonClass.outline} onClick={() => { setOpen(true); setSaved(false); }} data-testid="thesis-edit-topic">
          {thesis.topic ? "Edit my topic" : "Propose my topic"}
        </button>
        {saved && <p className="text-xs text-st-applied" role="status">Topic saved. It is now waiting for approval.</p>}
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-student-line-strong bg-student-bg p-4" data-testid="thesis-topic-form" noValidate>
      <div className="space-y-1.5">
        <label htmlFor={fieldId} className="text-sm font-medium text-student-ink">Working title of your thesis</label>
        <textarea
          id={fieldId}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={3}
          maxLength={300}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${fieldId}-help`}
          className="w-full rounded-lg border border-student-line-strong bg-student-card p-3 text-sm text-student-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-student-gold-ink"
        />
        <p id={`${fieldId}-help`} className="text-xs text-student-muted">5 to 300 characters. Your academic contact approves the topic; proposing it does not approve it.</p>
      </div>
      {error && <p className="text-sm font-medium text-student-attn" role="alert" data-testid="thesis-error">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={buttonClass.solid} disabled={saving} data-testid="thesis-save-topic">{saving ? "Saving..." : "Save topic"}</button>
        <button type="button" className={buttonClass.outline} disabled={saving} onClick={() => { setOpen(false); setError(null); }}>Cancel</button>
      </div>
    </form>
  );
}

function Milestones({ programId, thesis }: { programId: string; thesis: Thesis }) {
  const actions = useGraduateActions();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!thesis.milestones.length) return null;
  const toggle = async (index: number) => {
    setBusy(index);
    setError(null);
    try {
      const next = thesis.milestones.map((m, i) => (i === index ? { ...m, done: !m.done } : m));
      await actions.saveThesisPlan(programId, { milestones: next });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div data-testid="thesis-milestones">
      <h3 className="mb-1 text-sm font-semibold text-student-ink">Your milestones</h3>
      <ul className="divide-y divide-student-line">
        {thesis.milestones.map((m, i) => {
          const due = formatDate(m.due);
          const label = (
            <span className="min-w-0">
              <span className={cn("block text-sm", m.done ? "text-student-muted line-through" : "text-student-ink")}>{m.label}</span>
              {due && <span className="block text-xs text-student-muted">Due <time dateTime={m.due ?? undefined}>{due}</time></span>}
            </span>
          );
          return (
            <li key={`${m.label}-${i}`} data-testid="thesis-milestone" data-done={m.done}>
              {thesis.canEditPlan ? (
                <label className="flex min-h-[44px] cursor-pointer items-center gap-3 py-2">
                  <input type="checkbox" className="h-5 w-5 shrink-0 accent-[hsl(var(--s-gold-ink))]" checked={m.done} disabled={busy !== null} onChange={() => void toggle(i)} />
                  {label}
                </label>
              ) : (
                <div className="flex min-h-[44px] items-center gap-3 py-2">
                  {m.done ? <Check className="h-5 w-5 shrink-0 text-st-applied" aria-label="Done" /> : <span className="h-5 w-5 shrink-0 rounded border border-dashed border-student-line-strong" aria-label="Not done" role="img" />}
                  {label}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="mt-1 text-sm font-medium text-student-attn" role="alert">{error}</p>}
    </div>
  );
}

export function ThesisStatusStrip({ thesis }: { thesis: Thesis }) {
  const steps = thesisStrip(thesis);
  return (
    <ol className="grid grid-cols-3 gap-3" aria-label="Thesis stages" data-testid="thesis-strip">
      {steps.map((s) => (
        <li key={s.key} data-done={s.done}>
          <span aria-hidden="true" className={cn("mb-2 block h-1.5 rounded-full", s.done ? "bg-student-gold" : "border border-dashed border-student-line-strong")} />
          <p className={cn("text-sm", s.done ? "font-medium text-student-ink" : "text-student-muted")}>{s.label}{s.done ? "" : " (not yet)"}</p>
        </li>
      ))}
    </ol>
  );
}

export function ThesisSection({ programId, thesis }: { programId: string; thesis: Thesis }) {
  const approval = TOPIC_APPROVAL_LABEL[thesis.topicApproval];
  const deadline = formatDate(thesis.deadline);
  const submitted = formatDate(thesis.submittedOn);
  const result = thesis.result ? thesisOutcomeDisplay(thesis.result.outcome) : null;
  return (
    <section aria-labelledby="graduate-thesis-title" id={SECTION_IDS.thesis} className="scroll-mt-24 space-y-4" data-testid="graduate-thesis">
      <SectionHeading id="graduate-thesis-title" eyebrow="My Master's" title="My thesis" description="The terms below are your cohort's terms, not a rule for every student." />
      <div className={cn(cardClass, "space-y-5")}>
        <ThesisStatusStrip thesis={thesis} />

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={approval.status} label={approval.label} data-testid="topic-approval" />
          </div>
          <p className="font-serif text-lg leading-snug text-student-ink" data-testid="thesis-topic">{thesis.topic ?? "You have not proposed a topic yet."}</p>
          <p className="text-sm text-student-muted" data-testid="thesis-supervisor">
            {thesis.supervisor ? `Supervisor: ${thesis.supervisor}` : "A supervisor has not been named yet."}
          </p>
          {thesis.canEditPlan ? (
            <TopicForm programId={programId} thesis={thesis} />
          ) : (
            thesis.topicApproval === "approved" && <p className="text-xs text-student-muted" data-testid="topic-locked">An approved topic can only be changed through your academic contact.</p>
          )}
        </div>

        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div data-testid="thesis-length">
            <dt className="text-student-muted">Minimum length</dt>
            <dd className="font-medium text-student-ink">
              {thesis.minWords ? `${formatCount(thesis.minWords)} words` : "To be confirmed for your cohort"}
            </dd>
            {thesis.minWordsBasis && <dd className="text-xs text-student-muted" data-testid="thesis-basis">Basis: {thesis.minWordsBasis}</dd>}
          </div>
          <div data-testid="thesis-deadline">
            <dt className="text-student-muted">Deadline</dt>
            <dd className="flex items-center gap-1.5 font-medium text-student-ink">
              <CalendarClock className="h-4 w-4 text-student-gold-ink" aria-hidden="true" />
              {deadline ? <time dateTime={thesis.deadline ?? undefined}>{deadline}</time> : "No deadline recorded"}
            </dd>
          </div>
        </dl>

        <Milestones programId={programId} thesis={thesis} />

        <div className="flex gap-3 rounded-xl border border-student-line bg-student-bg p-4 text-sm text-student-ink" data-testid="thesis-originality">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-student-gold-ink" aria-hidden="true" />
          <p>{thesis.originality}</p>
        </div>

        <div className="space-y-2 border-t border-student-line pt-4" data-testid="thesis-grading">
          <h3 className="text-sm font-semibold text-student-ink">Submission and result</h3>
          {thesis.gradingStatus === "not_submitted" && <p className="text-sm text-student-muted">Not submitted yet.</p>}
          {thesis.gradingStatus === "submitted" && (
            <div className="space-y-1">
              <StatusPill status="submitted" label="Submitted, not graded yet" data-testid="thesis-submitted" />
              {submitted && <p className="text-sm text-student-ink">Submitted on <time dateTime={thesis.submittedOn ?? undefined}>{submitted}</time>.</p>}
              <p className="text-sm font-medium text-student-ink">Submitted is not passed. Your result appears here once it is graded.</p>
            </div>
          )}
          {thesis.gradingStatus === "graded" && result && (
            <div className="space-y-1">
              {submitted && <p className="text-sm text-student-ink">Submitted on <time dateTime={thesis.submittedOn ?? undefined}>{submitted}</time>.</p>}
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={result.status} label={`Result: ${result.label}`} data-testid="thesis-result" />
                {thesis.result?.grade && <span className="text-sm font-semibold text-student-ink">{thesis.result.grade}</span>}
                {thesis.result?.official && <Pill tone="gold">Confirmed from the grading record</Pill>}
              </div>
            </div>
          )}
          {thesis.resubmission && <p className="text-xs leading-relaxed text-student-muted" data-testid="thesis-resubmission">{thesis.resubmission}</p>}
        </div>
      </div>
    </section>
  );
}
