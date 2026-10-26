/**
 * S09 — staff "Profile & identity" panel, mounted in the admin student workspace.
 * Admin styling (workspace cards), not the student gold surface. Staff decisions
 * (identity correction, guardian authority) are always explicit, confirmed and
 * recorded with a note; trust labels derive from status, never from field presence.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, FileCheck2, Fingerprint, Loader2, ShieldAlert, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getAuthToken, getCsrfToken } from "@/lib/api";
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
  correctionDecisionGate,
  correctionRows,
  correctionStatusLabel,
  identityTrust,
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
    const csrf = getCsrfToken();
    if (csrf) headers["X-CSRF-Token"] = csrf;
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(url, { method, headers, credentials: "include", body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new HttpError(res.status);
  return (await res.json()) as T;
}

const TONE_CLASS: Record<TrustBadge["tone"], string> = {
  verified: "border-green-600/40 bg-green-600/10 text-green-800 dark:text-green-300",
  pending: "border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-200",
  problem: "border-destructive/40 bg-destructive/10 text-destructive",
  reported: "border-border bg-muted text-muted-foreground",
};

function TrustPill({ badge }: { badge: TrustBadge }) {
  return <Badge variant="outline" className={`gap-1 whitespace-normal text-left ${TONE_CLASS[badge.tone]}`}>
    {badge.tone === "verified" ? <BadgeCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
    {badge.label}
  </Badge>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="mt-1 text-sm">{children ?? "Not provided"}</dd></div>;
}

const text = (v: string | null | undefined) => (v ? v : "Not provided");

type Decision =
  | { kind: "correction"; decision: "approve" | "reject"; request: IdentityCorrectionRequestView }
  | { kind: "authority"; decision: "verify" | "revoke"; contact: StudentContactView };

function DecisionDialog({ decision, studentId, onClose, onDone }: { decision: Decision | null; studentId: string; onClose: () => void; onDone: (message: string) => void }) {
  const queryClient = useQueryClient();
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
        ? d.decision === "approve" ? "Correction approved. The student record was updated." : "Correction rejected. The student can see your note."
        : d.decision === "verify" ? "Guardian authority verified." : "Guardian authority revoked.");
    },
    onError: async (err) => {
      const failure = classifyResolveFailure(err instanceof HttpError ? err.status : 0);
      setError(failure.message);
      if (failure.kind === "conflict") {
        await queryClient.invalidateQueries({ queryKey: STAFF_PROFILE_QUERY_KEY(studentId) });
      }
    },
  });
  if (!decision) return null;
  const gate = decision.kind === "correction"
    ? correctionDecisionGate(decision.decision, note)
    : authorityDecisionGate(note);
  const noteRequired = decision.kind === "authority" || decision.decision === "reject";
  const title = decision.kind === "correction"
    ? decision.decision === "approve" ? "Approve identity correction?" : "Reject identity correction?"
    : decision.decision === "verify" ? "Verify guardian authority?" : "Revoke guardian authority?";
  const description = decision.kind === "correction"
    ? decision.decision === "approve"
      ? "Approving applies the requested values to the student's legal identity record. This is recorded in the audit log."
      : "The student will see your note and can submit a new request."
    : decision.decision === "verify"
      ? `${decision.contact.fullName} will be able to act within the requested scopes. Only verify after checking the supporting document.`
      : `${decision.contact.fullName} will lose any academic, financial or release authority.`;
  const destructive = decision.kind === "correction" ? decision.decision === "reject" : decision.decision === "revoke";
  return <Dialog open onOpenChange={(open) => { if (!open && !mutation.isPending) { setError(null); setNote(""); onClose(); } }}>
    <DialogContent>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="profile-decision-note">{noteRequired ? "Note (required)" : "Note (optional)"}</Label>
        <Textarea id="profile-decision-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} aria-describedby={error || !gate.ok ? "profile-decision-help" : undefined} />
        {!gate.ok && note.length > 0 ? <p id="profile-decision-help" className="text-xs text-muted-foreground">{gate.reason}</p> : null}
        {error ? <p id="profile-decision-help" role="alert" className="text-sm text-destructive">{error}</p> : null}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => { setError(null); setNote(""); onClose(); }}>Cancel</Button>
        <Button type="button" variant={destructive ? "destructive" : "default"} disabled={!gate.ok || mutation.isPending} onClick={() => { setError(null); mutation.mutate(decision); }}>
          {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}Confirm
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function CorrectionTable({ request }: { request: IdentityCorrectionRequestView }) {
  const rows = correctionRows(request);
  return <table className="w-full text-sm">
    <caption className="sr-only">Current and requested identity values</caption>
    <thead><tr className="text-left text-xs uppercase tracking-wide text-muted-foreground"><th scope="col" className="py-1 pr-3 font-medium">Field</th><th scope="col" className="py-1 pr-3 font-medium">On record</th><th scope="col" className="py-1 font-medium">Requested</th></tr></thead>
    <tbody className="divide-y">{rows.map((r) => <tr key={r.field}><th scope="row" className="py-2 pr-3 text-left font-medium">{r.label}</th><td className="py-2 pr-3 text-muted-foreground">{r.current}</td><td className="py-2 font-medium">{r.requested}</td></tr>)}</tbody>
  </table>;
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
  const { identity, contact, contacts } = profile;
  const pending = identity.pendingCorrection;
  const trust = identityTrust(identity.verification);
  const past = history.filter((h) => h.status !== "pending");
  return <section id="workspace-profile" aria-labelledby="workspace-profile-heading" className="space-y-4">
    <div>
      <h2 id="workspace-profile-heading" className="flex items-center gap-2 text-xl font-semibold"><Fingerprint className="h-5 w-5" aria-hidden="true" />Profile &amp; identity</h2>
      <p className="mt-1 text-sm text-muted-foreground">Values the student reported are labelled as such. Only a verified government ID document makes identity verified.</p>
    </div>
    {feedback ? <div role="status" className="rounded-md border border-green-600/30 bg-green-600/5 px-3 py-2 text-sm text-green-800 dark:text-green-300">{feedback}</div> : null}
    {pending ? <Card className="border-amber-500/50" data-testid="pending-correction">
      <CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="flex items-center gap-2 text-base"><ShieldAlert className="h-4 w-4 text-amber-600" aria-hidden="true" />Pending identity correction</CardTitle><Badge variant="outline">{correctionStatusLabel(pending.status)}</Badge></div></CardHeader>
      <CardContent className="space-y-4">
        <CorrectionTable request={pending} />
        <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Student's reason</p><p className="mt-1 text-sm">{pending.reason}</p></div>
        <p className="text-xs text-muted-foreground">Submitted {new Date(pending.createdAt).toISOString().slice(0, 10)}{pending.evidenceDocumentId ? " · supporting document attached" : " · no supporting document attached"}. Approving does not change document verification.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={!canDecide} onClick={() => onDecide?.({ kind: "correction", decision: "approve", request: pending })}>Approve…</Button>
          <Button type="button" size="sm" variant="outline" disabled={!canDecide} onClick={() => onDecide?.({ kind: "correction", decision: "reject", request: pending })}>Reject…</Button>
          <Button asChild size="sm" variant="ghost"><a href={STAFF_PROFILE_PATHS.documents(studentId)}><FileCheck2 className="mr-2 h-4 w-4" aria-hidden="true" />Review documents</a></Button>
        </div>
      </CardContent>
    </Card> : null}
    <div className="grid gap-4 md:grid-cols-2">
      <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="text-base">Legal identity</CardTitle><TrustPill badge={trust} /></div></CardHeader>
        <CardContent><dl className="grid gap-3 sm:grid-cols-2">
          <Field label="Student code">{identity.studentCode}</Field>
          <Field label="Legal name">{[identity.firstName, identity.middleName, identity.lastName].filter(Boolean).join(" ")}</Field>
          <Field label="Preferred name">{text(identity.preferredName)}</Field>
          <Field label="Date of birth">{text(identity.dob)}</Field>
          <Field label="Sex">{text(identity.sex)}</Field>
          <Field label="Nationality">{identity.nationality.length ? identity.nationality.join(", ") : "Not provided"}</Field>
          <Field label="Government ID"><span>{text(identity.govIdType)} <span className="font-mono">{identity.govIdNumberMasked ?? ""}</span></span></Field>
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">Government ID numbers are always masked here.</p></CardContent></Card>
      <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="text-base">Contact information</CardTitle><TrustPill badge={{ label: "Reported by student", tone: "reported" }} /></div></CardHeader>
        <CardContent><dl className="grid gap-3 sm:grid-cols-2">
          <Field label="Login email">{contact.email}{contact.emailVerified ? " · verified" : " · unverified"}</Field>
          <Field label="Primary phone">{text(contact.phonePrimary)}</Field>
          <Field label="Secondary phone">{text(contact.phoneSecondary)}</Field>
          <Field label="Preferred channel">{contact.preferredContactChannel}</Field>
          <Field label="Timezone">{text(contact.timezone)}</Field>
          <Field label="Address">{[contact.addressLine1, contact.addressLine2, contact.addressCity, contact.addressState, contact.addressPostal, contact.addressCountry].filter(Boolean).join(", ") || "Not provided"}</Field>
        </dl></CardContent></Card>
    </div>
    <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" aria-hidden="true" />Contacts &amp; guardian authority</CardTitle></CardHeader>
      <CardContent className="divide-y">
        {contacts.length === 0 ? <p className="py-2 text-sm text-muted-foreground">The student has not listed any contacts.</p> : contacts.map((c) => {
          const actions = contactActions(c);
          return <div key={c.id} className="space-y-2 py-3" data-testid="staff-contact">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{c.fullName} <span className="font-normal text-muted-foreground">· {c.relationship} ({c.type})</span></p><TrustPill badge={authorityTrust(c.authorityStatus)} /></div>
            <p className="text-sm text-muted-foreground">{c.phone}{c.email ? ` · ${c.email}` : ""}</p>
            <p className="text-xs text-muted-foreground">Requested scopes: {c.requestedScopes.join(", ") || "none"} · In force: {c.effectiveScopes.join(", ") || "none"} · Portal access: none</p>
            {c.authorityNote ? <p className="text-xs text-muted-foreground">Staff note: {c.authorityNote}</p> : null}
            {c.authorityStatus !== "listed" || c.requestedScopes.length > 0 || c.type === "guardian" || c.type === "representative" ? <div className="flex flex-wrap gap-2">
              {actions.canVerify && c.authorityStatus !== "verified" ? <Button type="button" size="sm" disabled={!canDecide} onClick={() => onDecide?.({ kind: "authority", decision: "verify", contact: c })}>Verify authority…</Button> : null}
              {actions.canRevoke ? <Button type="button" size="sm" variant="outline" disabled={!canDecide} onClick={() => onDecide?.({ kind: "authority", decision: "revoke", contact: c })}>Revoke…</Button> : null}
            </div> : null}
          </div>;
        })}
      </CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Correction history</CardTitle></CardHeader>
      <CardContent>{past.length === 0 ? <p className="text-sm text-muted-foreground">No resolved correction requests.</p> : <ul className="divide-y">{past.map((h) => <li key={h.id} className="space-y-1 py-3" data-testid="correction-history-item">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">{h.fields.map((f) => correctionRows({ ...h, fields: [f] })[0].label).join(", ")}</span><Badge variant="outline">{correctionStatusLabel(h.status)}</Badge></div>
        <p className="text-xs text-muted-foreground">{new Date(h.createdAt).toISOString().slice(0, 10)}{h.reviewedAt ? ` → ${new Date(h.reviewedAt).toISOString().slice(0, 10)}` : ""}{h.reviewNote ? ` · Note: ${h.reviewNote}` : ""}</p>
      </li>)}</ul>}</CardContent></Card>
    <p className="text-sm text-muted-foreground">Document verification is managed in <a className="font-medium underline underline-offset-2" href={STAFF_PROFILE_PATHS.documents(studentId)}>Documents</a>. Approving a correction never verifies a document.</p>
  </section>;
}

export default function StudentProfileReview({ studentId, canDecide = true }: { studentId: string; canDecide?: boolean }) {
  const [decision, setDecision] = useState<Decision | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
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
  if (profileQuery.isLoading) return <div role="status" aria-live="polite" className="rounded-md border p-6 text-center text-sm text-muted-foreground">Loading profile &amp; identity…</div>;
  if (profileQuery.isError || !profileQuery.data) {
    return <section id="workspace-profile" aria-labelledby="workspace-profile-heading" className="space-y-2">
      <h2 id="workspace-profile-heading" className="text-xl font-semibold">Profile &amp; identity</h2>
      <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm"><p>Could not load the profile.</p><Button className="mt-3" type="button" size="sm" variant="outline" onClick={() => void profileQuery.refetch()}>Retry</Button></div>
    </section>;
  }
  return <>
    <StudentProfileReviewView profile={profileQuery.data} history={historyQuery.data ?? []} studentId={studentId} canDecide={canDecide} onDecide={(d) => { setFeedback(null); setDecision(d); }} feedback={feedback} />
    <DecisionDialog decision={decision} studentId={studentId} onClose={() => setDecision(null)} onDone={(m) => { setDecision(null); setFeedback(m); }} />
  </>;
}
