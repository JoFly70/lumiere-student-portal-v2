import React, { useId, useState } from "react";
import { Link } from "wouter";
import { Info, Lock, Mail, Pencil, Phone, Plus, Trash2, UserRound } from "lucide-react";
import type { ContactScope, ContactType, ProfileReadinessItem, StudentContactInput, StudentContactView } from "@shared/student-profile-contract";
import { CONTACT_SCOPES, CONTACT_TYPES, contactRequestsAuthority } from "@shared/student-profile-contract";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { buttonClass } from "@/components/student-progress/student-ui";
import { useProfileActions } from "./profile-actions";
import {
  CONTACT_TYPE_LABELS,
  SCOPE_INFO,
  authorityChip,
  describeError,
  inactiveScopes,
  isVerifiedAuthority,
  scopeLabels,
  validateEmail,
  validatePhone,
  type FieldErrors,
} from "./profile-presentation";
import { DialogBody, FormActions, FormError, ProfileSection, StatusChip, SubCard, TextField, dialogClass, dialogFormClass, dialogHeaderClass, inputClass } from "./profile-ui";
import { Pill } from "@/components/student-progress/student-ui";

export function AuthorityExplainer() {
  return (
    <div className="flex items-start gap-2 text-sm leading-relaxed text-student-muted" data-testid="authority-explainer" role="note">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-student-gold-ink" aria-hidden="true" />
      <p>
        <span className="font-semibold text-student-ink">Adding someone does not give them access.</span>{" "}
        They get no portal login and cannot see your academic or financial records. A guardian or representative can act for you only after
        Lumière verifies a signed consent or legal document. Upload it in{" "}
        <Link href="/documents" className="font-medium text-student-gold-ink underline underline-offset-4">Documents</Link>.
      </p>
    </div>
  );
}

function ScopeLine({ contact }: { contact: StudentContactView }) {
  const pendingScopes = inactiveScopes(contact);
  const inForce = scopeLabels(contact.effectiveScopes);
  return (
    <div className="space-y-1 text-sm" data-testid="contact-scopes">
      <p className="text-student-ink">
        <span className="text-xs font-medium uppercase tracking-wide text-student-muted">In force today: </span>
        <span data-testid="effective-scopes">{inForce.length ? inForce.join(", ") : "No special permissions"}</span>
      </p>
      {contact.requestedScopes.length > 0 && (
        <p className="text-student-muted">
          <span className="text-xs font-medium uppercase tracking-wide">You asked for: </span>
          <span data-testid="requested-scopes">{scopeLabels(contact.requestedScopes).join(", ")}</span>
        </p>
      )}
      {pendingScopes.length > 0 && (
        <p className="text-xs text-student-muted" data-testid="scopes-inactive-note">
          {scopeLabels(pendingScopes).join(", ")} {pendingScopes.length > 1 ? "do" : "does"} not apply until Lumière verifies authority.
        </p>
      )}
    </div>
  );
}

export function ContactCard({
  contact,
  onEdit,
  onDelete,
  consentUnderReview = false,
}: {
  contact: StudentContactView;
  /** True when a signed consent is already on file, so Lumière (not the student) is the one acting. */
  consentUnderReview?: boolean;
  onEdit?: (c: StudentContactView) => void;
  onDelete?: (c: StudentContactView) => void;
}) {
  const chip = authorityChip(contact.authorityStatus);
  const locked = isVerifiedAuthority(contact);
  return (
    <li className="flex min-w-0 flex-col rounded-2xl border border-student-line bg-student-card p-4 sm:p-5" data-testid="contact-card" data-authority={contact.authorityStatus}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 break-words text-base font-semibold text-student-ink">
            <UserRound className="h-4 w-4 shrink-0 text-student-gold-ink" aria-hidden="true" />
            {contact.fullName}
          </h3>
          <p className="text-sm text-student-muted">{contact.relationship}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill tone="neutral" data-testid="contact-type">{CONTACT_TYPE_LABELS[contact.type]}</Pill>
          <StatusChip label={chip.label} tone={chip.tone} testId="authority-status" />
        </div>
      </div>
      <div className="mt-3 grid gap-1 text-sm text-student-ink">
        <p className="flex items-center gap-2"><Phone className="h-4 w-4 shrink-0 text-student-muted" aria-hidden="true" /><span className="break-all">{contact.phone}</span></p>
        {contact.email && <p className="flex items-center gap-2"><Mail className="h-4 w-4 shrink-0 text-student-muted" aria-hidden="true" /><span className="break-all">{contact.email}</span></p>}
      </div>
      <div className="mt-3"><ScopeLine contact={contact} /></div>
      {contact.authorityStatus === "pending_verification" && (
        <p className="mt-3 text-sm text-student-muted" data-testid="pending-hint">
          {consentUnderReview ? (
            "Lumière is reviewing the consent you sent. You will see the result here."
          ) : (
            <>Lumière is waiting for a signed consent or legal document. <Link href="/documents" className="font-medium text-student-gold-ink underline underline-offset-4">Upload it in Documents</Link>.</>
          )}
        </p>
      )}
      {contact.authorityStatus === "revoked" && (
        <p className="mt-3 text-sm text-student-muted" data-testid="revoked-hint">
          Next step: <Link href="/documents" className="font-medium text-student-gold-ink underline underline-offset-4">Upload a signed consent in Documents</Link> and Lumière will review it again.
        </p>
      )}
      {contact.authorityNote && (
        <p className="mt-3 rounded-lg bg-student-gold-soft px-3 py-2 text-sm text-student-ink" data-testid="authority-note">
          <span className="font-medium">Note from Lumière: </span>{contact.authorityNote}
        </p>
      )}
      <div className="h-3 shrink-0" aria-hidden="true" />
      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-student-line pt-3">
        {locked && (
          <p className="flex items-center gap-2 text-sm text-student-muted" data-testid="contact-locked">
            <Lock className="h-4 w-4" aria-hidden="true" />
            Verified by Lumière. <Link href="/support" className="font-medium text-student-gold-ink underline underline-offset-4">Contact Lumière to change</Link>
          </p>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" className={buttonClass.outline} onClick={() => onEdit?.(contact)} aria-label={`${locked ? "Update phone or email for" : "Edit"} ${contact.fullName}`} data-testid="button-edit-contact">
            <Pencil className="h-4 w-4" aria-hidden="true" />
            {locked ? "Update phone or email" : "Edit"}
          </button>
          {!locked && (
            <button type="button" className={buttonClass.outline} onClick={() => onDelete?.(contact)} aria-label={`Remove ${contact.fullName}`} data-testid="button-delete-contact">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Remove
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Add / edit dialog
// ---------------------------------------------------------------------------

interface Draft {
  type: ContactType;
  fullName: string;
  relationship: string;
  phone: string;
  email: string;
  language: string;
  scopes: ContactScope[];
}

const EMPTY: Draft = { type: "emergency", fullName: "", relationship: "", phone: "", email: "", language: "", scopes: ["emergency"] };

function toDraft(c: StudentContactView | null): Draft {
  if (!c) return EMPTY;
  return {
    type: c.type,
    fullName: c.fullName,
    relationship: c.relationship,
    phone: c.phone,
    email: c.email ?? "",
    language: c.language ?? "",
    scopes: [...c.requestedScopes],
  };
}

export function ContactDialog({
  open,
  onOpenChange,
  contact,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contact: StudentContactView | null;
}) {
  const actions = useProfileActions();
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>(() => toDraft(contact));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const typeId = useId();
  const locked = contact ? isVerifiedAuthority(contact) : false;
  const editing = Boolean(contact);

  // Reset whenever the dialog opens for a (different) contact.
  const key = `${open}:${contact?.id ?? "new"}`;
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    if (open) {
      setDraft(toDraft(contact));
      setErrors({});
      setServerError(null);
    }
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const needsAuthority = contactRequestsAuthority(draft.type, draft.scopes);

  function toggleScope(s: ContactScope, on: boolean) {
    set("scopes", on ? Array.from(new Set([...draft.scopes, s])) : draft.scopes.filter((x) => x !== s));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    const next: FieldErrors = {};
    if (!locked) {
      if (!draft.fullName.trim()) next.fullName = "Enter their full name";
      if (!draft.relationship.trim()) next.relationship = "Describe how they are related to you";
    }
    const p = validatePhone(draft.phone, true);
    if (p) next.phone = p;
    const em = validateEmail(draft.email);
    if (em) next.email = em;
    setErrors(next);
    if (Object.keys(next).length) return;

    const email = draft.email.trim() === "" ? null : draft.email.trim();
    const language = draft.language.trim() === "" ? null : draft.language.trim();
    setBusy(true);
    try {
      if (contact && locked) {
        await actions.updateContact(contact.id, { phone: draft.phone.trim(), email, language });
      } else {
        const payload: StudentContactInput = {
          type: draft.type,
          full_name: draft.fullName.trim(),
          relationship: draft.relationship.trim(),
          phone: draft.phone.trim(),
          email,
          language,
          scopes: draft.scopes,
        };
        if (contact) await actions.updateContact(contact.id, payload);
        else await actions.addContact(payload);
      }
      toast({
        title: editing ? "Contact updated" : "Contact added",
        description: needsAuthority && !locked ? "Listed. Authority is pending Lumière's verification." : "Your changes were saved.",
      });
      onOpenChange(false);
    } catch (err) {
      setServerError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogClass}>
        <DialogHeader className={dialogHeaderClass}>
          <DialogTitle className="font-serif text-2xl">
            {locked ? "Update contact details" : editing ? "Edit contact" : "Add a contact"}
          </DialogTitle>
          <DialogDescription className="text-student-muted">
            {locked
              ? "Lumière verified this person's authority, so only their phone, email and language can be updated here."
              : "Listing someone does not give them portal access or access to your records."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className={dialogFormClass} noValidate>
          <DialogBody>
          {!locked && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor={typeId} className="text-sm font-medium text-student-ink">Type of contact</Label>
                <Select value={draft.type} onValueChange={(v) => set("type", v as ContactType)}>
                  <SelectTrigger id={typeId} className={cn(inputClass, "w-full")} data-testid="select-contact-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTACT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{CONTACT_TYPE_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <TextField label="Full name" required value={draft.fullName} onChange={(v) => set("fullName", v)} error={errors.fullName} maxLength={120} testId="input-contact-name" />
              <TextField label="Relationship to you" required value={draft.relationship} onChange={(v) => set("relationship", v)} error={errors.relationship} maxLength={60} hint="For example: mother, uncle, family friend" testId="input-contact-relationship" />
            </>
          )}
          <TextField label="Phone" required type="tel" inputMode="tel" value={draft.phone} onChange={(v) => set("phone", v)} error={errors.phone} testId="input-contact-phone" />
          <TextField label="Email" type="email" inputMode="email" value={draft.email} onChange={(v) => set("email", v)} error={errors.email} hint="Optional" testId="input-contact-email" />
          <TextField label="Preferred language" value={draft.language} onChange={(v) => set("language", v)} maxLength={40} hint="Optional" testId="input-contact-language" />

          {!locked && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-student-ink">What may Lumière do with this contact?</legend>
              {CONTACT_SCOPES.map((s) => {
                const info = SCOPE_INFO[s];
                const id = `scope-${s}`;
                const on = draft.scopes.includes(s);
                return (
                  <label key={s} htmlFor={id} className={cn("flex min-h-[44px] cursor-pointer items-start gap-3 rounded-lg border px-3 py-2", on ? "border-student-gold-ink bg-student-gold-soft/50" : "border-student-line")}>
                    <Checkbox
                      id={id}
                      checked={on}
                      onCheckedChange={(c) => toggleScope(s, c === true)}
                      className="mt-0.5 border-student-line-strong data-[state=checked]:bg-student-seal data-[state=checked]:text-student-seal-ink"
                      data-testid={`checkbox-scope-${s}`}
                    />
                    <span className="min-w-0 text-sm">
                      <span className="flex flex-wrap items-center gap-2 font-medium text-student-ink">
                        {info.label}
                        {info.authority && <span className="rounded-full border border-student-line-strong px-2 text-xs font-medium text-student-muted">Requires verification</span>}
                      </span>
                      <span className="block text-xs text-student-muted">{info.help}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          )}

          {needsAuthority && !locked && (
            <p className="rounded-lg bg-student-gold-soft px-3 py-2 text-sm text-student-gold-ink" data-testid="authority-warning">
              This contact will be listed with a status of &ldquo;Verification pending&rdquo;. They gain no authority until Lumière verifies a signed consent or legal document. Upload it in{" "}
              <Link href="/documents" className="font-medium underline underline-offset-4">Documents</Link>.
            </p>
          )}
          <FormError message={serverError} />
          </DialogBody>
          <FormActions saving={busy} onCancel={() => onOpenChange(false)} saveLabel={editing ? "Save contact" : "Add contact"} sticky />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteContactDialog({ contact, onClose }: { contact: StudentContactView | null; onClose: () => void }) {
  const actions = useProfileActions();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function remove() {
    if (!contact) return;
    setBusy(true);
    setError(null);
    try {
      await actions.deleteContact(contact.id);
      toast({ title: "Contact removed", description: `${contact.fullName} was removed from your list.` });
      onClose();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AlertDialog open={Boolean(contact)} onOpenChange={(o) => !o && !busy && onClose()}>
      <AlertDialogContent className="student-surface border-student-line bg-student-card text-student-ink">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-serif text-xl">Remove {contact?.fullName}?</AlertDialogTitle>
          <AlertDialogDescription className="text-student-muted">
            They will be taken off your list and Lumière will no longer contact them for you. Any pending verification for this person ends.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <FormError message={error} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} className="min-h-[44px]">Keep contact</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              void remove();
            }}
            className="min-h-[44px] bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
            data-testid="button-confirm-delete-contact"
          >
            {busy ? "Removing…" : "Remove contact"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ContactsSection({ contacts, readiness = [] }: { contacts: readonly StudentContactView[]; readiness?: readonly ProfileReadinessItem[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<StudentContactView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StudentContactView | null>(null);
  return (
    <ProfileSection
      id="contacts"
      title="Authorized Contacts & Guardians"
      description="People Lumière can reach in an emergency, and family who may later be authorized to act for you."
    >
      <AuthorityExplainer />
      <div className="flex justify-end">
        <button
          type="button"
          className={buttonClass.solid}
          onClick={() => {
            setEditTarget(null);
            setDialogOpen(true);
          }}
          data-testid="button-add-contact"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add a contact
        </button>
      </div>
      {contacts.length === 0 ? (
        <SubCard testId="contacts-empty">
          <p className="text-sm text-student-muted">You have not listed anyone yet. Add at least an emergency contact so we can reach someone if we cannot reach you.</p>
        </SubCard>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2" aria-label="Your contacts">
          {contacts.map((c) => (
            <ContactCard
              key={c.id}
              contact={c}
              consentUnderReview={readiness.some((r) => r.key === `contact_authority:${c.id}` && r.kind === "pending_review")}
              onEdit={(x) => {
                setEditTarget(x);
                setDialogOpen(true);
              }}
              onDelete={setDeleteTarget}
            />
          ))}
        </ul>
      )}
      <ContactDialog open={dialogOpen} onOpenChange={setDialogOpen} contact={editTarget} />
      <DeleteContactDialog contact={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </ProfileSection>
  );
}

