/**
 * Shared building blocks for the profile sections. Local Tailwind classes on
 * top of the S05 `.student-surface` tokens; nothing global.
 */
import React, { useEffect, useId, useRef, useState } from "react";
import { Link } from "wouter";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock,
  Lock,
  ArrowRight,
  Pencil,
  UserRound,
  Contact,
  GraduationCap,
  Users,
  FileCheck2,
  KeyRound,
  ChevronDown,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Pill, cardClass } from "@/components/student-progress/student-ui";
import { sectionDomId, type ChipTone } from "./profile-presentation";
import { pt } from "./pt";

export const inputClass =
  "h-11 border-student-line-strong bg-student-card text-student-ink placeholder:text-student-muted focus:ring-student-gold-ink focus-visible:ring-student-gold-ink focus-visible:ring-offset-student-card";

/**
 * Dialog shell. At sm and up: a centred card capped at 90vh. Below sm: a full-height
 * sheet (inset-0, 100dvh, no rounding) so no page text can show around it and the
 * sticky footer actions always sit on the bottom edge of the screen.
 */
export const dialogClass =
  "student-surface flex flex-col gap-0 overflow-hidden border-student-line bg-student-card p-0 text-student-ink sm:max-h-[90vh] sm:max-w-lg " +
  "max-sm:left-0 max-sm:top-0 max-sm:h-[100dvh] max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0";

/**
 * Dialog layout: header (fixed) / body (the ONLY scroll region) / footer (fixed).
 * The footer is a flex sibling of the body, never an overlay on it, so no content
 * can sit beneath or peek above the Cancel/Send row.
 */
export const dialogFormClass = "flex min-h-0 flex-1 flex-col";
export const dialogHeaderClass = "shrink-0 px-6 pb-2 pt-6 pr-12";
export function DialogBody({ children }: { children: React.ReactNode }) {
  return <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-6 py-3" data-testid="dialog-body">{children}</div>;
}

const TONE_TO_PILL = {
  waiting: "neutral",
  missing: "dashed",
  attention: "attn",
  neutral: "neutral",
} as const;

/**
 * Semantic colour rules for every student status chip:
 *  - verified  = success treatment: neutral card, 2px gold outline, check icon
 *                (never a filled amber/gold wash, which is reserved for attention
 *                and Lumière notes)
 *  - attention = filled amber with a warning icon
 */
export function StatusChip({
  label,
  tone,
  className,
  testId,
}: {
  label: string;
  tone: ChipTone;
  className?: string;
  testId?: string;
}) {
  if (tone === "verified") {
    return (
      <span
        className={cn(
          "inline-flex w-fit items-center gap-1.5 rounded-full border-2 border-student-gold-ink bg-student-card px-2.5 py-0.5 text-xs font-semibold text-student-gold-ink",
          className,
        )}
        data-tone="verified"
        data-testid={testId}
      >
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </span>
    );
  }
  const icon =
    tone === "waiting" ? (
      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
    ) : tone === "attention" ? (
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
    ) : tone === "missing" ? (
      <CircleDashed className="h-3.5 w-3.5" aria-hidden="true" />
    ) : null;
  return (
    <Pill tone={TONE_TO_PILL[tone]} icon={icon} className={className} data-testid={testId}>
      {label}
    </Pill>
  );
}

const SECTION_ICONS: Record<string, LucideIcon> = {
  identity: UserRound,
  contact: Contact,
  background: GraduationCap,
  contacts: Users,
  eligibility: FileCheck2,
  account: KeyRound,
};

/** A titled profile section with a scroll target id. */
export function ProfileSection({
  id,
  eyebrow,
  title,
  description,
  children,
  testId,
  collapsible,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
  /** Low-frequency sections: a one-line summary stays visible, the details sit behind a disclosure. */
  collapsible?: { summary: React.ReactNode; defaultOpen?: boolean };
}) {
  const headingId = `${sectionDomId(id)}-title`;
  const Icon = SECTION_ICONS[id];
  const [open, setOpen] = useState(collapsible?.defaultOpen ?? false);
  const bodyId = useId();
  useEffect(() => {
    if (!collapsible) return;
    // In-page links (nav pills, readiness rows) open the section they point at.
    const sync = () => { if (window.location.hash === `#${sectionDomId(id)}`) setOpen(true); };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [collapsible, id]);
  return (
    <section
      id={sectionDomId(id)}
      aria-labelledby={headingId}
      className="scroll-mt-20 space-y-3 sm:space-y-4"
      data-testid={testId ?? `profile-section-${id}`}
    >
      <div className="flex items-start gap-3">
        {Icon && (
          <span className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-student-gold-soft text-student-gold-ink sm:h-12 sm:w-12" aria-hidden="true" data-testid="section-icon">
            <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
          </span>
        )}
        <div className="min-w-0 space-y-1">
          {eyebrow && <p className="text-xs font-semibold uppercase tracking-[0.14em] text-student-gold-ink">{eyebrow}</p>}
          <h2 id={headingId} className="font-serif text-2xl tracking-tight text-student-ink sm:text-3xl">
            {title}
          </h2>
          {description && <p className="max-w-2xl text-sm leading-relaxed text-student-muted">{description}</p>}
        </div>
      </div>
      {collapsible ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border border-student-line bg-student-card px-4" data-testid="section-summary">
            <p className="py-2 text-sm text-student-muted">{collapsible.summary}</p>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={() => setOpen((o) => !o)}
              className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-student-gold-ink underline-offset-4 hover:underline"
              data-testid="button-section-toggle"
            >
              {open ? pt("Hide details") : pt("Show details")}
              <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
            </button>
          </div>
          <div id={bodyId} hidden={!open} className="space-y-3 sm:space-y-4">{children}</div>
        </>
      ) : (
        children
      )}
    </section>
  );
}

export function SubCard({
  title,
  action,
  children,
  className,
  testId,
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div className={cn(cardClass, "min-w-0 p-4 sm:p-5", className)} data-testid={testId}>
      {(title || action) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 sm:mb-4">
          {title && <h3 className="text-base font-semibold text-student-ink">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

/** Read-only label/value pair. */
export function Fact({
  label,
  children,
  empty,
  missing = false,
  testId,
}: {
  label: string;
  children?: React.ReactNode;
  empty?: string;
  /** An empty value the student is expected to supply: shown with weight, not as a quiet blank. */
  missing?: boolean;
  testId?: string;
}) {
  const has = children !== null && children !== undefined && children !== "" && children !== false;
  return (
    <div className="min-w-0" data-testid={testId}>
      <dt className="text-xs font-medium uppercase tracking-wide text-student-muted">{label}</dt>
      <dd className={cn("mt-0.5 break-words text-sm", has ? "text-student-ink" : missing ? "font-semibold text-student-attn" : "italic text-student-muted")}>
        {has ? children : missing ? (
          <span className="inline-flex items-center gap-1.5" data-testid="fact-missing">
            <CircleDashed className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {pt("Missing")}
            <span className="sr-only">: {empty ?? pt("Not provided")}</span>
          </span>
        ) : (empty ?? pt("Not provided"))}
      </dd>
    </div>
  );
}

export function FactGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <dl className={cn("grid gap-x-6 gap-y-4 sm:grid-cols-2", className)}>{children}</dl>;
}

export function TextLink({ href, children, testId }: { href: string; children: React.ReactNode; testId?: string }) {
  return (
    <Link href={href} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md text-sm font-medium text-student-gold-ink underline-offset-4 hover:underline" data-testid={testId}>
      {children}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}

/** One short inline lock note per section. */
export function ReadOnlyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs leading-relaxed text-student-muted" data-testid="read-only-note">
      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** Labelled input with hint and inline error wired for assistive tech. */
export function TextField({
  label,
  value,
  onChange,
  error,
  hint,
  required,
  type = "text",
  inputMode,
  autoComplete,
  maxLength,
  placeholder,
  disabled,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  hint?: string;
  required?: boolean;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  autoComplete?: string;
  maxLength?: number;
  placeholder?: string;
  disabled?: boolean;
  testId?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm font-medium text-student-ink">
        {label}
        {required && <span aria-hidden="true" className="text-student-attn"> *</span>}
        {required && <span className="sr-only"> ({pt("required")})</span>}
      </Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={inputMode}
        autoComplete={autoComplete}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hint ? hintId : null, error ? errId : null].filter(Boolean).join(" ") || undefined}
        className={cn(inputClass, error && "border-student-attn")}
        data-testid={testId}
      />
      {hint && (
        <p id={hintId} className="text-xs text-student-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} role="alert" className="text-xs font-medium text-student-attn">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Save / cancel row with a polite live region that confirms a save for
 * screen-reader and sighted users alike.
 */
export function FormActions({
  saving,
  onCancel,
  saveLabel,
  disabled,
  sticky = false,
}: {
  sticky?: boolean;
  saving: boolean;
  onCancel: () => void;
  saveLabel?: string;
  disabled?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex gap-2 pt-2 sm:justify-end",
        sticky && "shrink-0 border-t border-student-line bg-student-card px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pb-4",
      )}
      data-testid={sticky ? "dialog-footer" : undefined}
    >
      <button
        type="button"
        onClick={onCancel}
        disabled={saving}
        className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-lg border border-student-line-strong bg-student-card px-4 text-sm font-medium text-student-ink hover:bg-student-gold-soft disabled:opacity-60 sm:flex-none"
      >
        {pt("Cancel")}
      </button>
      <button
        type="submit"
        disabled={saving || disabled}
        className="inline-flex min-h-[44px] flex-[2] items-center justify-center gap-2 rounded-lg bg-student-seal px-5 text-sm font-medium text-student-seal-ink hover:opacity-90 disabled:opacity-60 sm:flex-none"
      >
        {saving ? pt("Saving…") : (saveLabel ?? pt("Save changes"))}
      </button>
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  return (
    <div aria-live="assertive" role="status">
      {message && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-student-attn bg-student-attn-soft px-3 py-2 text-sm text-student-attn" data-testid="form-error">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{message}</span>
        </p>
      )}
    </div>
  );
}

export function EditButton({
  onClick,
  label,
  testId,
  addText,
}: {
  onClick: () => void;
  label: string;
  testId?: string;
  /** When the value is missing, show a solid "Add ..." action instead of a quiet Edit. */
  addText?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={addText ? undefined : label}
      data-testid={testId}
      className={cn(
        "inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium",
        addText
          ? "bg-student-seal px-4 text-student-seal-ink hover:opacity-90"
          : "border border-student-line-strong bg-student-card text-student-ink hover:bg-student-gold-soft",
      )}
    >
      {addText ? <Plus className="h-4 w-4" aria-hidden="true" /> : <Pencil className="h-4 w-4" aria-hidden="true" />}
      {addText ?? pt("Edit")}
    </button>
  );
}

/**
 * Edit-in-place card controller: tracks edit mode, saving state, the server
 * error and a transient "Saved" confirmation announced politely.
 */
export function useEditableCard(onSave: () => Promise<void>, savedTitle: string) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function submit(describe: (e: unknown) => string) {
    setSaving(true);
    setError(null);
    try {
      await onSave();
      setEditing(false);
      setSaved(true);
      toast({ title: savedTitle, description: pt("Your changes were saved.") });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setSaved(false), 4000);
    } catch (e) {
      setError(describe(e));
    } finally {
      setSaving(false);
    }
  }
  return { editing, setEditing, saving, error, setError, saved, submit };
}

export function SavedIndicator({ saved }: { saved: boolean }) {
  return (
    <span aria-live="polite" role="status" className="inline-flex min-h-[24px] items-center">
      {saved && (
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-student-gold-ink" data-testid="saved-indicator">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          {pt("Saved")}
        </span>
      )}
    </span>
  );
}

/** Long read-only lists show the first few rows and reveal the rest on request. */
export function CollapsibleList({
  items,
  limit = 4,
  label,
  className,
  testId,
}: {
  items: React.ReactNode[];
  limit?: number;
  label: string;
  className?: string;
  testId?: string;
}) {
  const [all, setAll] = useState(false);
  const collapsible = items.length > limit;
  const shown = collapsible && !all ? items.slice(0, limit) : items;
  return (
    <>
      <ul className={className} data-testid={testId}>{shown}</ul>
      {collapsible && (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll((a) => !a)}
          className="mt-1 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-student-gold-ink underline-offset-4 hover:underline"
          data-testid="button-show-all"
        >
          {all ? pt("Show fewer") : pt("Show all {n} {label}", { n: items.length, label })}
          <ChevronDown className={cn("h-4 w-4 transition-transform", all && "rotate-180")} aria-hidden="true" />
        </button>
      )}
    </>
  );
}
