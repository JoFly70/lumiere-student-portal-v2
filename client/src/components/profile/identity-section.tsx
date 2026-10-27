import React, { useId, useState } from "react";
import { Link } from "wouter";
import { FileCheck2, Hourglass, ShieldCheck, Upload, XCircle, CheckCircle2 } from "lucide-react";
import type {
  CreateIdentityCorrection,
  IdentityCorrectionChanges,
  IdentityCorrectionField,
  IdentityCorrectionRequestView,
  ProfileIdentity,
} from "@shared/student-profile-contract";
import { IDENTITY_CORRECTION_FIELDS } from "@shared/student-profile-contract";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { buttonClass } from "@/components/student-progress/student-ui";
import { ProfileAvatarUpload } from "@/components/profile-avatar-upload";
import { useProfileActions } from "./profile-actions";
import {
  FIELD_LABELS,
  describeError,
  displayName,
  formatDate,
  needsUpload,
  verificationChip,
} from "./profile-presentation";
import {
  Fact,
  FactGrid,
  FormActions,
  FormError,
  ProfileSection,
  ReadOnlyNote,
  SavedIndicator,
  StatusChip,
  SubCard,
  TextField,
  EditButton,
  TextLink,
  dialogClass,
  dialogFormClass,
  dialogHeaderClass,
  DialogBody,
  inputClass,
  useEditableCard,
} from "./profile-ui";
import { pt } from "./pt";

// ---------------------------------------------------------------------------
// Preferred name (the only directly editable identity field)
// ---------------------------------------------------------------------------

function PreferredNameCard({ identity }: { identity: ProfileIdentity }) {
  const actions = useProfileActions();
  const [value, setValue] = useState(identity.preferredName ?? "");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const card = useEditableCard(
    () => actions.saveSelfService({ preferred_name: value.trim() === "" ? null : value.trim() }),
    pt("Preferred name saved"),
  );

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (value.trim().length > 80) return setFieldError(pt("Use 80 characters or fewer"));
    setFieldError(null);
    void card.submit(describeError);
  }

  return (
    <SubCard
      title={pt("Preferred name")}
      testId="preferred-name-card"
      action={
        card.editing ? null : (
          <div className="flex items-center gap-3">
            <SavedIndicator saved={card.saved} />
            <EditButton
              label={pt("Edit preferred name")}
              testId="button-edit-preferred-name"
              onClick={() => {
                setValue(identity.preferredName ?? "");
                card.setError(null);
                card.setEditing(true);
              }}
            />
          </div>
        )
      }
    >
      {card.editing ? (
        <form onSubmit={onSubmit} className="space-y-3" noValidate>
          <TextField
            label={pt("Preferred name")}
            value={value}
            onChange={setValue}
            error={fieldError}
            hint={pt("What Lumière staff and your portal call you day to day. It does not change your legal name.")}
            maxLength={80}
            autoComplete="nickname"
            testId="input-preferred-name"
          />
          <FormError message={card.error} />
          <FormActions saving={card.saving} onCancel={() => card.setEditing(false)} />
        </form>
      ) : (
        <>
          <p className="text-sm text-student-ink" data-testid="text-preferred-name">
            {identity.preferredName ? identity.preferredName : <span className="italic text-student-muted">{pt("None set. We use your first name.")}</span>}
          </p>
          <p className="mt-1 text-xs text-student-muted">{pt("Optional. You can change this any time.")}</p>
        </>
      )}
    </SubCard>
  );
}

// ---------------------------------------------------------------------------
// Correction request views
// ---------------------------------------------------------------------------

function ChangeRows({ request }: { request: IdentityCorrectionRequestView }) {
  return (
    <ul className="divide-y divide-student-line rounded-lg border border-student-line">
      {request.fields.map((f) => (
        <li key={f} className="grid gap-1 px-3 py-2 text-sm sm:grid-cols-3 sm:gap-3">
          <span className="font-medium text-student-ink">{FIELD_LABELS[f] ?? f}</span>
          <span className="min-w-0 break-words text-student-muted">
            <span className="text-xs uppercase tracking-wide">{pt("On record:")} </span>
            {request.currentDisplay[f] || pt("Nothing recorded")}
          </span>
          <span className="min-w-0 break-words text-student-ink">
            <span className="text-xs uppercase tracking-wide text-student-muted">{pt("Requested:")} </span>
            {request.requestedDisplay[f] || pt("Cleared")}
          </span>
        </li>
      ))}
    </ul>
  );
}

function WithdrawButton({ request }: { request: IdentityCorrectionRequestView }) {
  const actions = useProfileActions();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  async function withdraw() {
    setBusy(true);
    setError(null);
    try {
      await actions.withdrawCorrection(request.id);
      toast({ title: pt("Request withdrawn"), description: pt("Your identity details were not changed.") });
      setOpen(false);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <button type="button" className={buttonClass.outline} data-testid="button-withdraw-correction">
          {pt("Withdraw request")}
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent className="student-surface border-student-line bg-student-card text-student-ink">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-serif text-xl">{pt("Withdraw this correction request?")}</AlertDialogTitle>
          <AlertDialogDescription className="text-student-muted">
            {pt("Lumière will stop reviewing it and your identity details stay as they are. You can submit a new request afterwards.")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <FormError message={error} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} className="min-h-[44px]">{pt("Keep request")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              void withdraw();
            }}
            className="min-h-[44px]"
          >
            {busy ? pt("Withdrawing…") : pt("Withdraw")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function PendingCorrectionCard({ request }: { request: IdentityCorrectionRequestView }) {
  return (
    <div
      className="space-y-3 rounded-2xl border border-student-gold bg-student-gold-soft/60 p-4 sm:p-5"
      data-testid="pending-correction"
      role="group"
      aria-label={pt("Pending identity correction request")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Hourglass className="h-4 w-4 text-student-gold-ink" aria-hidden="true" />
        <h3 className="text-base font-semibold text-student-ink">{pt("Correction request under review")}</h3>
        <StatusChip label={pt("Pending review")} tone="waiting" />
      </div>
      <p className="text-sm text-student-muted">
        {pt("Submitted {date}. Your verified identity stays exactly as recorded until Lumière finishes reviewing this request.", { date: formatDate(request.createdAt) })}
      </p>
      <ChangeRows request={request} />
      <p className="text-sm text-student-ink">
        <span className="font-medium">{pt("Your reason:")} </span>
        {request.reason}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <WithdrawButton request={request} />
        <TextLink href="/documents">{pt("Add supporting documents")}</TextLink>
      </div>
    </div>
  );
}

export function ResolvedCorrectionCard({ request }: { request: IdentityCorrectionRequestView }) {
  const approved = request.status === "approved";
  const withdrawn = request.status === "withdrawn";
  return (
    <div className="space-y-2 rounded-2xl border border-student-line bg-student-card p-4 sm:p-5" data-testid="resolved-correction">
      <div className="flex flex-wrap items-center gap-2">
        {approved ? (
          <CheckCircle2 className="h-4 w-4 text-student-gold-ink" aria-hidden="true" />
        ) : (
          <XCircle className="h-4 w-4 text-student-attn" aria-hidden="true" />
        )}
        <h3 className="text-base font-semibold text-student-ink">{pt("Your last correction request")}</h3>
        <StatusChip
          label={approved ? pt("Approved") : withdrawn ? pt("Withdrawn") : pt("Not approved")}
          tone={approved ? "verified" : withdrawn ? "neutral" : "attention"}
          testId="resolved-correction-status"
        />
      </div>
      <p className="text-sm text-student-muted">
        {approved
          ? pt("Approved {date}. Your details above now show the corrected values.", { date: formatDate(request.reviewedAt ?? request.createdAt) })
          : withdrawn
            ? pt("You withdrew this request on {date}. Nothing changed.", { date: formatDate(request.reviewedAt ?? request.createdAt) })
            : pt("Reviewed {date}. Your details were not changed.", { date: formatDate(request.reviewedAt ?? request.createdAt) })}
      </p>
      <p className="text-sm text-student-muted">
        {pt("You asked to change:")} {request.fields.map((f) => FIELD_LABELS[f] ?? f).join(", ")}.
      </p>
      {request.reviewNote && (
        <p className="rounded-lg bg-student-gold-soft px-3 py-2 text-sm text-student-ink" data-testid="correction-review-note">
          <span className="font-medium">{pt("Note from Lumière:")} </span>
          {request.reviewNote}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Request-a-correction dialog
// ---------------------------------------------------------------------------

type DraftValues = Record<IdentityCorrectionField, string>;

function currentValues(identity: ProfileIdentity): DraftValues {
  return {
    first_name: identity.firstName,
    middle_name: identity.middleName ?? "",
    last_name: identity.lastName,
    dob: identity.dob ?? "",
    sex: identity.sex ?? "",
    nationality: identity.nationality.join(", "),
    gov_id_type: identity.govIdType ?? "",
    // Never prefilled: the full number is not sent to the browser.
    gov_id_number: "",
  };
}

const FIELD_HINTS: Partial<Record<IdentityCorrectionField, string>> = {
  get nationality() { return pt("Separate more than one with commas (up to 4)."); },
  get gov_id_number() { return pt("Enter the full corrected number. Only the last four characters are ever shown back to you."); },
  get dob() { return pt("Use the date printed on your ID."); },
};

export function buildCorrectionChanges(
  identity: ProfileIdentity,
  selected: ReadonlySet<IdentityCorrectionField>,
  values: DraftValues,
): { changes: IdentityCorrectionChanges; errors: Record<string, string> } {
  const cur = currentValues(identity);
  const changes: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const f of IDENTITY_CORRECTION_FIELDS) {
    if (!selected.has(f)) continue;
    const raw = values[f].trim();
    switch (f) {
      case "first_name":
      case "last_name":
        if (!raw) errors[f] = pt("{field} cannot be empty", { field: FIELD_LABELS[f] ?? f });
        else if (raw.length > 80) errors[f] = pt("Use 80 characters or fewer");
        else changes[f] = raw;
        break;
      case "middle_name":
      case "sex":
      case "gov_id_type":
        changes[f] = raw === "" ? null : raw;
        break;
      case "dob":
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) errors[f] = pt("Enter a valid date");
        else if (raw > new Date().toISOString().slice(0, 10)) errors[f] = pt("Date of birth cannot be in the future");
        else changes[f] = raw;
        break;
      case "nationality": {
        const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
        if (list.length === 0) errors[f] = pt("Enter at least one nationality");
        else if (list.length > 4) errors[f] = pt("List up to 4 nationalities");
        else if (list.some((s) => s.length < 2)) errors[f] = pt("Each nationality needs at least 2 letters");
        else changes[f] = list;
        break;
      }
      case "gov_id_number":
        if (raw.length < 3) errors[f] = pt("Enter the full ID number (at least 3 characters)");
        else changes[f] = raw;
        break;
    }
  }
  if (Object.keys(errors).length === 0) {
    // Drop fields that equal what is already on record.
    const unchanged = Object.keys(changes).filter((k) => {
      if (k === "gov_id_number") return false;
      const v = changes[k];
      const now = cur[k as IdentityCorrectionField];
      return (Array.isArray(v) ? v.join(", ") : (v ?? "")) === now;
    });
    for (const k of unchanged) errors[k] = pt("This matches what is already on record");
  }
  return { changes: changes as IdentityCorrectionChanges, errors };
}

export function CorrectionDialog({ identity }: { identity: ProfileIdentity }) {
  const actions = useProfileActions();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<IdentityCorrectionField>>(new Set());
  const [values, setValues] = useState<DraftValues>(() => currentValues(identity));
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const reasonId = useId();

  function reset() {
    setSelected(new Set());
    setValues(currentValues(identity));
    setReason("");
    setErrors({});
    setServerError(null);
  }

  function toggle(f: IdentityCorrectionField, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(f);
      else next.delete(f);
      return next;
    });
    setErrors((e) => {
      const { [f]: _drop, ...rest } = e;
      return rest;
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    const next: Record<string, string> = {};
    if (selected.size === 0) next._fields = pt("Choose at least one detail to correct");
    const built = buildCorrectionChanges(identity, selected, values);
    Object.assign(next, built.errors);
    if (reason.trim().length < 10) next.reason = pt("Tell us briefly why this needs correcting (at least 10 characters)");
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const payload: CreateIdentityCorrection = { changes: built.changes, reason: reason.trim() };
    setBusy(true);
    try {
      await actions.submitCorrection(payload);
      toast({ title: pt("Correction request sent"), description: pt("Lumière will review it. Your current details stay as they are until then.") });
      setOpen(false);
      reset();
    } catch (err) {
      setServerError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) reset();
      }}
    >
      <DialogTrigger asChild>
        <button type="button" className={buttonClass.outline} data-testid="button-request-correction">
          <FileCheck2 className="h-4 w-4" aria-hidden="true" />
          {pt("Request a correction")}
        </button>
      </DialogTrigger>
      <DialogContent className={dialogClass}>
        <DialogHeader className={dialogHeaderClass}>
          <DialogTitle className="font-serif text-2xl">{pt("Request a correction")}</DialogTitle>
          <DialogDescription className="text-student-muted">
            {pt("Choose what is wrong and enter the correct value. Lumière reviews every request, and your recorded details do not change until it is approved.")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className={dialogFormClass} noValidate>
          <DialogBody>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-student-ink">{pt("What needs correcting?")}</legend>
            {errors._fields && (
              <p role="alert" className="text-xs font-medium text-student-attn">{errors._fields}</p>
            )}
            {IDENTITY_CORRECTION_FIELDS.map((f) => {
              const on = selected.has(f);
              const cbId = `corr-${f}`;
              return (
                <div key={f} className={cn("rounded-lg border px-3", on ? "border-student-gold-ink bg-student-gold-soft/50" : "border-student-line")}>
                  <label htmlFor={cbId} className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm text-student-ink">
                    <Checkbox
                      id={cbId}
                      checked={on}
                      onCheckedChange={(c) => toggle(f, c === true)}
                      className="border-student-line-strong data-[state=checked]:bg-student-seal data-[state=checked]:text-student-seal-ink"
                    />
                    <span className="font-medium">{FIELD_LABELS[f]}</span>
                    <span className="ml-auto truncate text-xs text-student-muted">
                      {f === "gov_id_number" ? identity.govIdNumberMasked ?? "" : f === "dob" ? formatDate(identity.dob) : currentValues(identity)[f]}
                    </span>
                  </label>
                  {on && (
                    <div className="pb-3">
                      <TextField
                        label={pt("Correct {field}", { field: (FIELD_LABELS[f] ?? f).toLowerCase() })}
                        type={f === "dob" ? "date" : "text"}
                        value={values[f]}
                        onChange={(v) => setValues((s) => ({ ...s, [f]: v }))}
                        error={errors[f]}
                        hint={FIELD_HINTS[f]}
                        testId={`input-correction-${f}`}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor={reasonId} className="text-sm font-medium text-student-ink">
              {pt("Why does this need correcting?")} <span aria-hidden="true" className="text-student-attn">*</span>
              <span className="sr-only">({pt("required, at least 10 characters")})</span>
            </Label>
            <Textarea
              id={reasonId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={1000}
              aria-invalid={errors.reason ? true : undefined}
              aria-describedby={errors.reason ? `${reasonId}-err` : undefined}
              className={cn(inputClass, "h-auto min-h-[88px]")}
              data-testid="input-correction-reason"
            />
            {errors.reason && (
              <p id={`${reasonId}-err`} role="alert" className="text-xs font-medium text-student-attn">{errors.reason}</p>
            )}
          </div>

          <p className="rounded-lg bg-student-gold-soft px-3 py-2 text-sm text-student-gold-ink" data-testid="correction-evidence-note">
            {pt("Supporting documents, like a corrected ID or passport, are uploaded in")}{" "}
            <Link href="/documents" className="font-medium underline underline-offset-4">Documents</Link>. {pt("Lumière will look for them when reviewing.")}
          </p>

          <FormError message={serverError} />
          </DialogBody>
          <FormActions saving={busy} onCancel={() => setOpen(false)} saveLabel={pt("Send request")} sticky />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function IdentitySection({ identity }: { identity: ProfileIdentity }) {
  const actions = useProfileActions();
  const names = displayName(identity);
  const chip = verificationChip(identity.verification);
  return (
    <ProfileSection
      id="identity"
      title={pt("My Identity")}
      description={pt("Your legal identity is the record Lumière uses for admissions, transcripts and credentials. You can keep your preferred name up to date; everything else changes only after Lumière reviews a request.")}
    >
      <div className="grid gap-3 sm:gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] lg:items-start">
        <SubCard
          title={pt("Legal identity")}
          testId="legal-identity-card"
          action={<StatusChip label={chip.label} tone={chip.tone} testId="identity-verification-badge" />}
        >
          <FactGrid>
            <Fact label={pt("Legal full name")} testId="fact-legal-name">{names.legal}</Fact>
            <Fact label={pt("Student ID")} testId="fact-student-id">{identity.studentCode}</Fact>
            <Fact label={pt("Date of birth")} testId="fact-dob" missing>{formatDate(identity.dob)}</Fact>
            <Fact label={pt("Sex")} testId="fact-sex">{identity.sex}</Fact>
            <Fact label={pt("Nationality")} testId="fact-nationality">{identity.nationality.join(", ")}</Fact>
            <Fact label={pt("Government ID type")} testId="fact-gov-id-type">{identity.govIdType}</Fact>
            <Fact label={pt("Government ID number")} testId="fact-gov-id-number" empty={pt("Not on record")} missing={needsUpload(identity.verification)}>
              {identity.govIdNumberMasked}
            </Fact>
          </FactGrid>
          <p className="mt-3 text-sm text-student-muted" data-testid="verification-explain">
            <ShieldCheck className="mr-1.5 inline h-4 w-4 align-text-bottom text-student-gold-ink" aria-hidden="true" />
            {chip.explain}
          </p>
          {needsUpload(identity.verification) && (
            <Link href="/documents" className={cn(buttonClass.solid, "mt-3 w-full sm:w-auto")} data-testid="link-upload-government-id">
              <Upload className="h-4 w-4" aria-hidden="true" />
              {pt("Upload government ID")}
            </Link>
          )}
          <div className="mt-3 space-y-2 border-t border-student-line pt-3">
            <ReadOnlyNote>
              {pt("Read-only. Identity changes go through a correction request, and your recorded details stay as they are until Lumière approves it.")}
            </ReadOnlyNote>
            {!identity.pendingCorrection && <CorrectionDialog identity={identity} />}
          </div>
        </SubCard>

        <PreferredNameCard identity={identity} />
      </div>

      {identity.pendingCorrection && <PendingCorrectionCard request={identity.pendingCorrection} />}
      {identity.lastResolvedCorrection && <ResolvedCorrectionCard request={identity.lastResolvedCorrection} />}
    </ProfileSection>
  );
}
