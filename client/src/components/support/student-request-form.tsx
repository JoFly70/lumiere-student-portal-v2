/** New request form: topic tiles, subject, description, optional context and file. */
import React, { useId, useRef, useState } from "react";
import { Loader2, Paperclip, X } from "lucide-react";
import type { SupportTopic } from "@shared/support-contract";
import type { SupportContextOptionsResponse } from "@/hooks/use-tickets";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { buttonClass, cardClass } from "@/components/student-progress/student-ui";
import {
  ATTACHMENT_HELP,
  DESCRIPTION_MAX,
  SUBJECT_MAX,
  TOPIC_CHOICES,
  attachmentError,
  formatFileSize,
  validateRequestDraft,
} from "./support-presentation";

export interface NewRequestValues {
  topic: SupportTopic;
  subject: string;
  description: string;
  roadmapItemKey?: string;
  file?: File;
}

const fieldClass =
  "w-full rounded-lg border border-student-line-strong bg-student-card px-3 py-2.5 text-base text-student-ink placeholder:text-student-muted sm:text-sm";

export function NewRequestForm({
  contextOptions,
  defaultItemKey,
  submitting,
  serverError,
  serverErrorMayHaveSaved,
  onSubmit,
  onCancel,
}: {
  contextOptions?: SupportContextOptionsResponse | null;
  defaultItemKey?: string | null;
  submitting?: boolean;
  serverError?: string | null;
  /** True when the request may have been received despite the error (network loss, unconfirmed rollback). */
  serverErrorMayHaveSaved?: boolean;
  onSubmit: (values: NewRequestValues) => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const uid = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const options = contextOptions?.available ? contextOptions.items : [];
  const initialItem = defaultItemKey && options.some((o) => o.key === defaultItemKey) ? defaultItemKey : "";
  const [topic, setTopic] = useState<SupportTopic | null>(defaultItemKey ? "roadmap_question" : null);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [itemKey, setItemKey] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  // The picker may load after mount, so ?item pre-selection is derived, not initial state.
  const effectiveItem = itemKey ?? initialItem;
  const errors = validateRequestDraft({ topic, subject, description });
  const show = (k: keyof typeof errors) => (attempted ? errors[k] : undefined);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (Object.keys(errors).length > 0 || !topic) return;
    onSubmit({
      topic,
      subject: subject.trim(),
      description: description.trim(),
      roadmapItemKey: effectiveItem || undefined,
      file: file ?? undefined,
    });
  };

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    const err = attachmentError(f);
    setFileError(err);
    setFile(err ? null : f);
    if (err && fileRef.current) fileRef.current.value = "";
  };

  return (
    <form onSubmit={submit} noValidate className={cn(cardClass, "space-y-6")} data-testid="new-request-form" aria-labelledby={`${uid}-title`}>
      <div className="space-y-1">
        <h2 id={`${uid}-title`} tabIndex={-1} className="font-serif text-2xl tracking-tight text-student-ink sm:text-3xl" data-focus-target>
          {t("support.newRequest")}
        </h2>
        <p className="text-sm leading-relaxed text-student-muted">
          Tell us what you need. A Lumière advisor will reply here, and you can follow the conversation at any time.
        </p>
      </div>

      <fieldset className="space-y-3" aria-describedby={show("topic") ? `${uid}-topic-err` : undefined}>
        <legend className="text-sm font-semibold text-student-ink">What is this about?</legend>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Topic">
          {TOPIC_CHOICES.map((t) => {
            const selected = topic === t.key;
            return (
              <label
                key={t.key}
                data-testid={`topic-tile-${t.key}`}
                className={cn(
                  "flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-student-gold-ink",
                  selected ? "border-student-gold bg-student-gold-soft" : "border-student-line bg-student-card hover:bg-student-gold-soft",
                )}
              >
                <input
                  type="radio"
                  name={`${uid}-topic`}
                  value={t.key}
                  checked={selected}
                  onChange={() => setTopic(t.key)}
                  className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--s-gold-fill))]"
                />
                <span className="space-y-0.5">
                  <span className="block text-sm font-medium text-student-ink">{t.label}</span>
                  <span className="block text-xs leading-snug text-student-muted">{t.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
        {show("topic") && <p id={`${uid}-topic-err`} role="alert" className="text-sm font-medium text-student-attn">{errors.topic}</p>}
      </fieldset>

      {options.length > 0 && (
        <div className="space-y-1.5" data-testid="context-picker">
          <label htmlFor={`${uid}-ctx`} className="text-sm font-semibold text-student-ink">
            Related course or milestone <span className="font-normal text-student-muted">(optional)</span>
          </label>
          <select
            id={`${uid}-ctx`}
            value={effectiveItem}
            onChange={(e) => setItemKey(e.target.value)}
            className={cn(fieldClass, "min-h-[44px]")}
          >
            <option value="">Not related to a specific item</option>
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.title}{o.code ? ` (${o.code})` : ""}
              </option>
            ))}
          </select>
          <p className="text-xs text-student-muted">Helps your advisor see exactly where you are in your plan.</p>
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor={`${uid}-subject`} className="text-sm font-semibold text-student-ink">Subject</label>
        <input
          id={`${uid}-subject`}
          data-testid="input-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={SUBJECT_MAX + 50}
          placeholder="A short summary in a few words"
          className={cn(fieldClass, "min-h-[44px]")}
          aria-invalid={!!show("subject")}
          aria-describedby={show("subject") ? `${uid}-subject-err` : undefined}
        />
        {show("subject") && <p id={`${uid}-subject-err`} role="alert" className="text-sm font-medium text-student-attn">{errors.subject}</p>}
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${uid}-desc`} className="text-sm font-semibold text-student-ink">How can we help?</label>
        <textarea
          id={`${uid}-desc`}
          data-testid="input-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={6}
          placeholder="Share the details. The more context you give, the faster we can help."
          className={fieldClass}
          aria-invalid={!!show("description")}
          aria-describedby={`${uid}-desc-hint${show("description") ? ` ${uid}-desc-err` : ""}`}
        />
        <p id={`${uid}-desc-hint`} className="text-xs text-student-muted">{description.trim().length} / {DESCRIPTION_MAX}</p>
        {show("description") && <p id={`${uid}-desc-err`} role="alert" className="text-sm font-medium text-student-attn">{errors.description}</p>}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-student-ink">Attach a file <span className="font-normal text-student-muted">(optional)</span></p>
        <input
          ref={fileRef}
          type="file"
          className="sr-only"
          id={`${uid}-file`}
          accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.doc,.docx"
          onChange={(e) => pickFile(e.target.files?.[0])}
          data-testid="input-file"
          aria-label="Attach a file"
        />
        {file ? (
          <div className="flex items-center gap-2 text-sm text-student-ink" data-testid="selected-file">
            <Paperclip className="h-4 w-4 text-student-gold-ink" aria-hidden="true" />
            <span className="min-w-0 truncate">{file.name}</span>
            <span className="text-xs text-student-muted">{formatFileSize(file.size)}</span>
            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg hover:bg-student-gold-soft"
              onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }}
              aria-label={`Remove ${file.name}`}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <button type="button" className={buttonClass.outline} onClick={() => fileRef.current?.click()}>
            <Paperclip className="h-4 w-4" aria-hidden="true" /> Choose a file
          </button>
        )}
        <p className="text-xs text-student-muted">{ATTACHMENT_HELP} It is added right after your request is sent.</p>
        {fileError && <p role="alert" className="text-sm font-medium text-student-attn" data-testid="file-error">{fileError}</p>}
      </div>

      {serverError && (
        <div role="alert" className="rounded-xl border border-student-attn bg-student-attn-soft p-4 text-sm text-student-ink" data-testid="submit-error">
          {serverError}{" "}
          {serverErrorMayHaveSaved
            ? "It may have been received. Sending it again is safe: we will not create a duplicate. Nothing you wrote has been lost."
            : "Your request has not been sent. Nothing you wrote has been lost, so you can try again."}
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} className={buttonClass.outline} disabled={submitting}>Cancel</button>
        <button type="submit" className={buttonClass.solid} disabled={submitting} data-testid="button-submit-request">
          {submitting ? (<><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Sending…</>) : "Send request"}
        </button>
      </div>
    </form>
  );
}
