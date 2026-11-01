/**
 * S09 — staff "Profile & identity" panel, mounted in the admin student workspace.
 * S10 staff pass: no longer a separately styled island. It is one tab panel of the
 * workspace and uses the shared Lumière tokens/primitives like every other section
 * (verified is the charcoal seal, never gold; gold stays the action accent). Staff decisions
 * (identity correction, guardian authority) are always explicit, confirmed and
 * recorded with a note; trust labels derive from status, never from field presence.
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowRight, CheckCircle2, CircleDashed, Clock, FileCheck2, Fingerprint, Loader2, Paperclip, ShieldAlert, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getAuthToken, freshCsrfToken } from "@/lib/api";
import { StaffSectionHeader } from "@/components/staff/staff-ui";
import { useT } from "@/i18n";
import type { WsTr } from "@/pages/admin-student-workspace-presentation";
import type { IdentityCorrectionRequestView, StudentContactView, StudentProfileView } from "@shared/student-profile-contract";
import {
  STAFF_PROFILE_HISTORY_QUERY_KEY,
  STAFF_PROFILE_PATHS,
  STAFF_PROFILE_QUERY_KEY,
  authorityBody,
  authorityDecisionGate,
  authorityTrust,
  classifyResolveFailure,
  contactActions,
  contactNeedsDecision,
  correctionDecisionGate,
  correctionRows,
  humanize,
  humanizeList,
  showVerifyAction,
  correctionStatusLabel,
  profileDecisionCount,
  identityTrust,
  identityStatusChip,
  normalizeHistory,
  resolveBody,
  type TrustBadge,
} from "./student-profile-review-logic";

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

async function staffRequest<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (method !== "GET") {
    const csrf = await freshCsrfToken();
    if (csrf) headers["X-CSRF-Token"] = csrf;
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(url, { method, headers, credentials: "include", body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new HttpError(res.status);
  return (await res.json()) as T;
}

const TONE_CLASS: Record<TrustBadge["tone"], string> = {
  verified: "border-st-official bg-st-official text-student-seal-ink",
  pending: "border-st-attention bg-st-attention-soft text-st-attention",
  problem: "border-student-attn bg-student-attn-soft text-student-attn",
  reported: "border-student-line-strong bg-student-card text-student-muted",
};

const TONE_ICON: Record<TrustBadge["tone"], typeof CheckCircle2> = {
  verified: CheckCircle2,
  pending: Clock,
  problem: AlertCircle,
  reported: CircleDashed,
};

/**
 * S32-B: the logic module returns English labels. These helpers pick the translated label from the same
 * status the logic switches on, and keep the logic's tone.
 */
const identityTrustKey = (v: string): "verified" | "pending" | "rejected" | "resubmit_requested" | "none" =>
  v === "verified" || v === "pending" || v === "rejected" || v === "resubmit_requested" ? v : "none";
const identityChipKey = (v: string): "verified" | "pending" | "action" | "none" => (v === "verified" ? "verified" : v === "pending" ? "pending" : v === "rejected" || v === "resubmit_requested" ? "action" : "none");
const authorityKey = (s: string): "verified" | "pending_verification" | "revoked" | "listed" =>
  s === "verified" || s === "pending_verification" || s === "revoked" ? s : "listed";
const humanizeT = (t: WsTr, value: string | null | undefined): string => {
  if (value === null || value === undefined || value === "") return t("s32ws.prof.notProvided");
  const key = `s32ws.prof.enum.${value.trim().toLowerCase()}` as Parameters<WsTr>[0];
  const found = t(key);
  return found !== key ? found : humanize(value);
};
const humanizeListT = (t: WsTr, values: readonly string[]): string => (values.length ? values.map((v) => humanizeT(t, v)).join(", ") : t("s32ws.prof.none"));

function TrustPill({ badge }: { badge: TrustBadge }) {
  const Icon = TONE_ICON[badge.tone];
  return <Badge variant="outline" className={`gap-1 whitespace-normal text-left text-xs font-semibold ${TONE_CLASS[badge.tone]}`}>
    <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    {badge.label}
  </Badge>;
}

function StatusBadge({ status }: { status: IdentityCorrectionRequestView["status"] }) {
  const { t } = useT();
  const tone: TrustBadge["tone"] = status === "approved" ? "verified" : status === "pending" ? "pending" : status === "rejected" ? "problem" : "reported";
  const Icon = TONE_ICON[tone];
  return <Badge variant="outline" className={`gap-1 text-xs font-semibold ${TONE_CLASS[tone]}`}><Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t(`s32ws.prof.corr.${status}`)}</Badge>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const { t } = useT();
  return <div><dt className="text-xs font-medium uppercase tracking-wide text-student-muted">{label}</dt><dd className="mt-1 break-words text-sm">{children ?? t("s32ws.prof.notProvided")}</dd></div>;
}

/** Lumière charcoal seal (cream in dark mode); 44px touch targets. */
const PRIMARY_ACTION = "min-h-11 border-student-seal bg-student-seal px-4 text-student-seal-ink hover:bg-student-seal/90";
const OUTLINE_ACTION = "min-h-11 border-student-line-strong bg-student-card px-4 text-student-ink hover:bg-student-gold-soft";
const DESTRUCTIVE_ACTION = "min-h-11 border-student-attn bg-student-attn px-4 text-student-card hover:bg-student-attn/90";
const CARD = "rounded-2xl border-student-line bg-student-card text-student-ink shadow-none";
const CARD_TITLE = "font-serif text-lg font-normal tracking-tight";

type Decision =
  | { kind: "correction"; decision: "approve" | "reject"; request: IdentityCorrectionRequestView }
  | { kind: "authority"; decision: "verify" | "revoke"; contact: StudentContactView };

function DecisionDialog({ decision, studentId, onClose, onDone, returnFocusTo }: { decision: Decision | null; studentId: string; onClose: () => void; onDone: (message: string) => void; returnFocusTo?: React.RefObject<HTMLElement | null> }) {
  const queryClient = useQueryClient();
  const { t } = useT();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: async (d: Decision) =>
      d.kind === "correction"
        ? staffRequest("POST", STAFF_PROFILE_PATHS.resolve(d.request.id), resolveBody(d.decision, note))
        : staffRequest("POST", STAFF_PROFILE_PATHS.authority(d.contact.id), authorityBody(d.decision, note)),
    onSuccess: async (_data, d) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: STAFF_PROFILE_QUERY_KEY(studentId) }),
        queryClient.invalidateQueries({ queryKey: STAFF_PROFILE_HISTORY_QUERY_KEY(studentId) }),
      ]);
      setNote("");
      onDone(d.kind === "correction"
        ? d.decision === "approve" ? t("s32ws.prof.done.approve") : t("s32ws.prof.done.reject")
        : d.decision === "verify" ? t("s32ws.prof.done.verify") : t("s32ws.prof.done.revoke"));
    },
    onError: async (err) => {
      const failure = classifyResolveFailure(err instanceof HttpError ? err.status : 0);
      setError(t(`s32ws.prof.fail.${failure.kind}`));
      if (failure.kind === "conflict") {
        await queryClient.invalidateQueries({ queryKey: STAFF_PROFILE_QUERY_KEY(studentId) });
      }
    },
  });
  // Keep the dialog mounted while it closes so focus returns to the button that opened it.
  const lastDecision = useRef<Decision | null>(null);
  if (decision) lastDecision.current = decision;
  const shown = decision ?? lastDecision.current;
  if (!shown) return null;
  const open = !!decision;
  const gate = shown.kind === "correction"
    ? correctionDecisionGate(shown.decision, note)
    : authorityDecisionGate(note);
  const noteRequired = shown.kind === "authority" || shown.decision === "reject";
  const gateReason = gate.ok ? null : shown.kind === "correction" ? t("s32ws.prof.gate.reject") : t("s32ws.prof.gate.authority");
  const title = shown.kind === "correction"
    ? shown.decision === "approve" ? t("s32ws.prof.dlg.approveTitle") : t("s32ws.prof.dlg.rejectTitle")
    : shown.decision === "verify" ? t("s32ws.prof.dlg.verifyTitle") : shown.contact.authorityStatus === "verified" ? t("s32ws.prof.dlg.revokeTitle") : t("s32ws.prof.dlg.declineTitle");
  const description = shown.kind === "correction"
    ? shown.decision === "approve"
      ? t("s32ws.prof.dlg.approveBody")
      : t("s32ws.prof.dlg.rejectBody")
    : shown.decision === "verify"
      ? t("s32ws.prof.dlg.verifyBody", { name: shown.contact.fullName })
      : t("s32ws.prof.dlg.revokeBody", { name: shown.contact.fullName });
  const destructive = shown.kind === "correction" ? shown.decision === "reject" : shown.decision === "revoke";
  return <Dialog open={open} onOpenChange={(open) => { if (!open && !mutation.isPending) { setError(null); setNote(""); onClose(); } }}>
    <DialogContent onCloseAutoFocus={(e) => {
      // No Radix trigger here (the dialog is opened from state), so return focus to the control that opened it;
      // if a successful decision removed that control, land on the panel heading instead of the page top.
      e.preventDefault();
      const opener = returnFocusTo?.current;
      (opener && opener.isConnected ? opener : document.getElementById("workspace-profile-heading"))?.focus();
    }} className="student-surface border-student-line bg-student-card text-student-ink max-sm:left-0 max-sm:top-0 max-sm:h-[100dvh] max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:content-start max-sm:rounded-none max-sm:border-0">
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="profile-decision-note">{noteRequired ? t("s32ws.prof.dlg.noteRequired") : t("s32ws.prof.dlg.noteOptional")}</Label>
        <Textarea className="border-student-line-strong bg-student-card text-student-ink" id="profile-decision-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} aria-describedby={error || !gate.ok ? "profile-decision-help" : undefined} />
        {!gate.ok && note.length > 0 ? <p id="profile-decision-help" className="text-xs text-student-muted">{gateReason}</p> : null}
        {error ? <p id="profile-decision-help" role="alert" className="text-sm text-student-attn">{error}</p> : null}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" className={OUTLINE_ACTION} disabled={mutation.isPending} onClick={() => { setError(null); setNote(""); onClose(); }}>{t("s32ws.prof.dlg.cancel")}</Button>
        <Button type="button" className={`${destructive ? DESTRUCTIVE_ACTION : PRIMARY_ACTION} disabled:border-student-line disabled:bg-student-line disabled:text-student-muted disabled:opacity-100`} disabled={!gate.ok || mutation.isPending} onClick={() => { setError(null); mutation.mutate(shown); }}>
          {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}{t("s32ws.prof.dlg.confirm")}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function CorrectionTable({ request }: { request: IdentityCorrectionRequestView }) {
  const { t } = useT();
  const val = (v: string) => (v === "Not on record" ? t("s32ws.prof.notOnRecord") : v);
  const rows = correctionRows(request).map((r) => ({ ...r, label: t(`s32ws.prof.field.${r.field}`), current: val(r.current), requested: val(r.requested) }));
  return <>
    <ul className="divide-y rounded-md border md:hidden" aria-label={t("s32ws.prof.tbl.aria")}>
      {rows.map((r) => <li key={r.field} className="space-y-1 px-3 py-2 text-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-student-muted">{r.label}</p>
        <p className="flex flex-wrap items-center gap-x-2 break-words"><span className="text-student-muted">{r.current}</span><ArrowRight className="h-3.5 w-3.5 shrink-0 text-student-muted" aria-hidden="true" /><span className="font-medium">{r.requested}</span></p>
        <p className="text-xs text-student-muted">{t("s32ws.prof.tbl.arrow")}</p>
      </li>)}
    </ul>
    <div className="relative hidden overflow-x-auto md:block"><table className="w-full text-sm">
      <caption className="sr-only">{t("s32ws.prof.tbl.aria")}</caption>
      <thead><tr className="text-left text-xs uppercase tracking-wide text-student-muted"><th scope="col" className="py-1 pr-3 font-medium">{t("s32ws.prof.tbl.field")}</th><th scope="col" className="py-1 pr-3 font-medium">{t("s32ws.prof.tbl.onRecord")}</th><th scope="col" className="py-1 font-medium">{t("s32ws.prof.tbl.requested")}</th></tr></thead>
      <tbody className="divide-y">{rows.map((r) => <tr key={r.field}><th scope="row" className="py-2 pr-3 text-left font-medium">{r.label}</th><td className="py-2 pr-3 text-student-muted">{r.current}</td><td className="py-2 font-medium">{r.requested}</td></tr>)}</tbody>
    </table></div>
  </>;
}

function ContactDetails({ c }: { c: StudentContactView }) {
  const { t } = useT();
  return <>
    <p className="text-sm text-student-muted">{c.phone}{c.email ? ` · ${c.email}` : ""}</p>
    <p className="text-xs text-student-muted">{t("s32ws.prof.contact.scopes", { req: humanizeListT(t, c.requestedScopes), eff: humanizeListT(t, c.effectiveScopes) })}</p>
    {c.authorityNote ? <p className="text-xs text-student-muted">{t("s32ws.prof.contact.staffNote", { note: c.authorityNote })}</p> : null}
  </>;
}

function ContactActions({ c, canDecide, onDecide }: { c: StudentContactView; canDecide: boolean; onDecide?: (d: Decision) => void }) {
  const { t } = useT();
  const actions = contactActions(c);
  const verify = showVerifyAction(c) && actions.canVerify;
  if (!verify && !actions.canRevoke) {
    return c.authorityStatus === "listed" ? <p className="text-xs text-student-muted">{t("s32ws.prof.contact.noAuthority")}</p> : null;
  }
  return <div className="flex flex-wrap gap-2">
    {verify ? <Button type="button" className={PRIMARY_ACTION} disabled={!canDecide} onClick={() => onDecide?.({ kind: "authority", decision: "verify", contact: c })}>{t("s32ws.prof.contact.verifyBtn")}</Button> : null}
    {actions.canRevoke ? <Button type="button" variant="outline" className={OUTLINE_ACTION} disabled={!canDecide} onClick={() => onDecide?.({ kind: "authority", decision: "revoke", contact: c })}>{c.authorityStatus === "verified" ? t("s32ws.prof.contact.revokeBtn") : t("s32ws.prof.contact.declineBtn")}</Button> : null}
  </div>;
}

export function StudentProfileReviewView({
  profile,
  history,
  studentId,
  canDecide = true,
  onDecide,
  feedback,
}: {
  profile: StudentProfileView;
  history: readonly IdentityCorrectionRequestView[];
  studentId: string;
  canDecide?: boolean;
  onDecide?: (d: Decision) => void;
  feedback?: string | null;
}) {
  const { t } = useT();
  const text = (v: string | null | undefined) => (v ? v : t("s32ws.prof.notProvided"));
  const { identity, contact, contacts } = profile;
  const pending = identity.pendingCorrection;
  const trust = { ...identityTrust(identity.verification), label: t(`s32ws.prof.trust.${identityTrustKey(identity.verification)}`) };
  const idChip = { ...identityStatusChip(identity.verification), label: t(`s32ws.prof.chip.${identityChipKey(identity.verification)}`) };
  const authBadge = (status: StudentContactView["authorityStatus"]): TrustBadge => ({ ...authorityTrust(status), label: t(`s32ws.prof.auth.${authorityKey(status)}`) });
  const past = history.filter((h) => h.status !== "pending");
  const decisionContacts = contacts.filter(contactNeedsDecision);
  const decisionCount = profileDecisionCount(profile);
  return <section id="workspace-profile" aria-labelledby="workspace-profile-heading" className="scroll-mt-4 space-y-5">
    <StaffSectionHeader id="workspace-profile-heading" tabIndex={-1} icon={<Fingerprint className="h-5 w-5" />} title={t("s32ws.prof.title")} description={t("s32ws.prof.desc")} className="mb-0" />
    {feedback ? <div role="status" className="rounded-xl border border-student-gold bg-student-gold-soft px-4 py-2.5 text-sm font-medium text-student-ink">{feedback}</div> : null}
    {decisionCount > 0 ? <div className="space-y-3 rounded-2xl border border-student-gold bg-student-gold-soft p-3 sm:p-4" data-testid="needs-decision" role="group" aria-labelledby="needs-decision-heading">
      <h3 id="needs-decision-heading" className="flex items-center gap-2 font-serif text-lg"><AlertCircle className="h-4 w-4 text-student-gold-ink" aria-hidden="true" />{t("s32ws.prof.needsDecision")}<Badge className="ml-1 bg-student-seal text-student-seal-ink hover:bg-student-seal">{decisionCount}</Badge></h3>
      {pending ? <Card className={CARD} data-testid="pending-correction">
        <CardHeader className="pb-3"><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className={`flex items-center gap-2 ${CARD_TITLE}`}><ShieldAlert className="h-4 w-4 text-student-gold-ink" aria-hidden="true" />{t("s32ws.prof.pendingCorrection")}</CardTitle><StatusBadge status={pending.status} /></div></CardHeader>
        <CardContent className="space-y-4">
          <CorrectionTable request={pending} />
          <div><p className="text-xs font-medium uppercase tracking-wide text-student-muted">{t("s32ws.prof.studentReason")}</p><p className="mt-1 text-sm">{pending.reason}</p></div>
          <p className="text-xs text-student-muted">{t("s32ws.prof.submitted", { date: new Date(pending.createdAt).toISOString().slice(0, 10) })}</p>
          <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="correction-evidence">
            <Paperclip className="h-4 w-4 text-student-muted" aria-hidden="true" />
            {pending.evidenceDocumentId
              ? <span>{t("s32ws.prof.evidence.yes")}</span>
              : <span>{t("s32ws.prof.evidence.no")}</span>}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" className={PRIMARY_ACTION} disabled={!canDecide} onClick={() => onDecide?.({ kind: "correction", decision: "approve", request: pending })}>{t("s32ws.prof.approve")}</Button>
            <Button type="button" variant="outline" className={OUTLINE_ACTION} disabled={!canDecide} onClick={() => onDecide?.({ kind: "correction", decision: "reject", request: pending })}>{t("s32ws.prof.reject")}</Button>
            <Button asChild variant="ghost" className="min-h-11 px-4 text-student-ink hover:bg-student-gold-soft"><a href={STAFF_PROFILE_PATHS.documents(studentId)}><FileCheck2 className="mr-2 h-4 w-4" aria-hidden="true" />{t("s32ws.prof.reviewDocs")}</a></Button>
          </div>
        </CardContent>
      </Card> : null}
      {decisionContacts.map((c) => <Card key={c.id} className={CARD} data-testid="authority-request">
        <CardContent className="space-y-2 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{t("s32ws.prof.authReq", { name: c.fullName })} <span className="font-normal text-student-muted">· {c.relationship} ({humanizeT(t, c.type)})</span></p><TrustPill badge={authBadge(c.authorityStatus)} /></div>
          <ContactDetails c={c} />
          <ContactActions c={c} canDecide={canDecide} onDecide={onDecide} />
        </CardContent>
      </Card>)}
    </div> : null}
    <p className="text-sm text-student-muted">{t("s32ws.prof.reportedNote")}</p>
    <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
      <Card className={CARD}><CardHeader className="pb-3"><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className={CARD_TITLE}>{t("s32ws.prof.legalIdentity")}</CardTitle><TrustPill badge={idChip} /></div><p className="pt-1 text-xs text-student-muted" data-testid="identity-trust-detail">{trust.label}</p></CardHeader>
        <CardContent><dl className="grid gap-3 sm:grid-cols-2">
          <Field label={t("s32ws.prof.studentCode")}>{identity.studentCode}</Field>
          <Field label={t("s32ws.prof.legalName")}>{[identity.firstName, identity.middleName, identity.lastName].filter(Boolean).join(" ")}</Field>
          <Field label={t("s32ws.prof.preferredName")}>{text(identity.preferredName)}</Field>
          <Field label={t("s32ws.prof.dob")}>{text(identity.dob)}</Field>
          <Field label={t("s32ws.prof.sex")}>{text(identity.sex)}</Field>
          <Field label={t("s32ws.prof.nationality")}>{identity.nationality.length ? identity.nationality.join(", ") : t("s32ws.prof.notProvided")}</Field>
          <Field label={t("s32ws.prof.govId")}><span>{text(identity.govIdType)} <span className="font-mono">{identity.govIdNumberMasked ?? ""}</span></span></Field>
        </dl>
        <p className="mt-3 text-xs text-student-muted">{t("s32ws.prof.govMasked")}</p></CardContent></Card>
      <Card className={CARD}><CardHeader className="pb-3"><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className={CARD_TITLE}>{t("s32ws.prof.contactInfo")}</CardTitle><TrustPill badge={{ label: t("s32ws.prof.reportedByStudent"), tone: "reported" }} /></div></CardHeader>
        <CardContent><dl className="grid gap-3 sm:grid-cols-2">
          <Field label={t("s32ws.prof.loginEmail")}>{contact.email}{contact.emailVerified ? t("s32ws.prof.verifiedSuffix") : t("s32ws.prof.unverifiedSuffix")}</Field>
          <Field label={t("s32ws.prof.phonePrimary")}>{text(contact.phonePrimary)}</Field>
          <Field label={t("s32ws.prof.phoneSecondary")}>{text(contact.phoneSecondary)}</Field>
          <Field label={t("s32ws.prof.channel")}>{humanizeT(t, contact.preferredContactChannel)}</Field>
          <Field label={t("s32ws.prof.timezone")}>{text(contact.timezone)}</Field>
          <Field label={t("s32ws.prof.address")}>{[contact.addressLine1, contact.addressLine2, contact.addressCity, contact.addressState, contact.addressPostal, contact.addressCountry].filter(Boolean).join(", ") || t("s32ws.prof.notProvided")}</Field>
        </dl></CardContent></Card>
    </div>
    <Card className={CARD}><CardHeader className="pb-3"><CardTitle className={`flex items-center gap-2 ${CARD_TITLE}`}><Users className="h-4 w-4" aria-hidden="true" />{t("s32ws.prof.contactsTitle")}</CardTitle></CardHeader>
      <CardContent className="divide-y">
        {contacts.length === 0 ? <p className="py-2 text-sm text-student-muted">{t("s32ws.prof.noContacts")}</p> : contacts.map((c) => contactNeedsDecision(c)
          ? <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0" data-testid="staff-contact" data-compact="true">
              <p className="min-w-0 text-sm font-medium">{c.fullName} <span className="font-normal text-student-muted">· {c.relationship} ({humanizeT(t, c.type)})</span></p>
              <a href="#needs-decision-heading" className="inline-flex min-h-11 items-center rounded-full border border-st-attention bg-st-attention-soft px-3 text-xs font-semibold text-st-attention underline-offset-2 hover:underline">{t("s32ws.prof.reviewRequest")}</a>
            </div>
          : <div key={c.id} className="space-y-2 py-3 first:pt-0" data-testid="staff-contact">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{c.fullName} <span className="font-normal text-student-muted">· {c.relationship} ({humanizeT(t, c.type)})</span></p><TrustPill badge={authBadge(c.authorityStatus)} /></div>
            <ContactDetails c={c} />
            <ContactActions c={c} canDecide={canDecide} onDecide={onDecide} />
          </div>)}
      </CardContent></Card>
    <Card className={CARD}><CardHeader className="pb-3"><CardTitle className={CARD_TITLE}>{t("s32ws.prof.history")}</CardTitle></CardHeader>
      <CardContent>{past.length === 0 ? <p className="text-sm text-student-muted">{t("s32ws.prof.noHistory")}</p> : <ul className="divide-y">{past.map((h) => <li key={h.id} className="space-y-1 py-3 first:pt-0" data-testid="correction-history-item">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">{h.fields.map((f) => t(`s32ws.prof.field.${f}`)).join(", ")}</span><StatusBadge status={h.status} /></div>
        <p className="text-xs text-student-muted">{new Date(h.createdAt).toISOString().slice(0, 10)}{h.reviewedAt ? ` → ${new Date(h.reviewedAt).toISOString().slice(0, 10)}` : ""}{h.reviewNote ? ` · ${t("s32ws.prof.historyNote", { note: h.reviewNote })}` : ""}</p>
      </li>)}</ul>}</CardContent></Card>
    <p className="text-sm text-student-muted">{t("s32ws.prof.docsPre")} <a className="inline-flex min-h-10 items-center font-medium underline underline-offset-2" href={STAFF_PROFILE_PATHS.documents(studentId)}>{t("s32ws.prof.docsLink")}</a>{t("s32ws.prof.docsPost")}</p>
  </section>;
}

/** The staff profile + history queries. Shared (same keys) by the panel and the workspace's attention summary. */
export function useStaffProfileData(studentId: string) {
  const profileQuery = useQuery<StudentProfileView>({
    queryKey: STAFF_PROFILE_QUERY_KEY(studentId),
    queryFn: () => staffRequest<StudentProfileView>("GET", STAFF_PROFILE_PATHS.profile(studentId)),
    enabled: !!studentId,
    retry: false,
  });
  const historyQuery = useQuery<IdentityCorrectionRequestView[]>({
    queryKey: STAFF_PROFILE_HISTORY_QUERY_KEY(studentId),
    queryFn: async () => normalizeHistory(await staffRequest<unknown>("GET", STAFF_PROFILE_PATHS.history(studentId))),
    enabled: !!studentId,
    retry: false,
  });
  return { profileQuery, historyQuery };
}

export default function StudentProfileReview({ studentId, canDecide = true }: { studentId: string; canDecide?: boolean }) {
  const { t } = useT();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const { profileQuery, historyQuery } = useStaffProfileData(studentId);
  if (profileQuery.isLoading) return <div role="status" aria-live="polite" className="rounded-md border p-6 text-center text-sm text-student-muted">{t("s32ws.prof.loading")}</div>;
  if (profileQuery.isError || !profileQuery.data) {
    return <section id="workspace-profile" aria-labelledby="workspace-profile-heading" className="space-y-2">
      <h2 id="workspace-profile-heading" className="text-xl font-semibold">{t("s32ws.prof.title")}</h2>
      <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm"><p>{t("s32ws.prof.loadError")}</p><Button className="mt-3" type="button" size="sm" variant="outline" onClick={() => void profileQuery.refetch()}>{t("s32ws.prof.retry")}</Button></div>
    </section>;
  }
  return <>
    <StudentProfileReviewView profile={profileQuery.data} history={historyQuery.data ?? []} studentId={studentId} canDecide={canDecide} onDecide={(d) => { opener.current = document.activeElement as HTMLElement | null; setFeedback(null); setDecision(d); }} feedback={feedback} />
    <DecisionDialog returnFocusTo={opener} decision={decision} studentId={studentId} onClose={() => setDecision(null)} onDone={(m) => { setDecision(null); setFeedback(m); }} />
  </>;
}
