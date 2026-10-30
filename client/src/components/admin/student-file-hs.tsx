/**
 * Owner "Student file" for a student with no university workspace (e.g. a high-school-only
 * student). The same shell as the university workspace: portrait + identity header, the same
 * action links, and the Overview / Profile & identity / Documents / Support / Lumière AI tabs.
 * Every fact shown is read from stored records; checkpoints are Done or Pending, never inferred.
 */
import React, { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowLeft, ArrowRight, BrainCircuit, CheckCircle2, CircleDashed, CreditCard, FileText, Fingerprint, GraduationCap, LayoutDashboard, LifeBuoy, ShieldCheck, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  StaffCard, StaffFileHeader, StaffNotice, StaffPage, StaffPill, StaffSectionHeader, StaffTabList, StaffTabPanel,
  StatusPill, staffBtn, staffLabel, useHashTab, type StaffTab,
} from "@/components/staff/staff-ui";
import StudentProfileReview, { useStaffProfileData } from "@/components/admin/student-profile-review";
import { StudentDocumentsReview } from "@/components/admin/student-documents-review";
import { STAFF_PROFILE_QUERY_KEY, profileDecisionCount } from "@/components/admin/student-profile-review-logic";
import { canActivateLeadForRole } from "@/components/admin/student-documents-upload-logic";
import { OwnerAssistantPanel } from "@/components/owner-assistant/owner-assistant-panel";
import { AccountAvatar, PhotoDialog } from "@/components/os/account-menu";
import { ticketStatusKey } from "@/components/support/support-presentation";
import { documentNeedsReview, formatWorkspaceDateTime, workspaceToken } from "@/pages/admin-student-workspace-presentation";
import { useDocuments } from "@/hooks/use-documents";
import { useTickets, type Ticket } from "@/hooks/use-tickets";
import { useHsState } from "@/lib/admin-high-school-api";
import { formatDate, statusLabel } from "@/lib/admin-high-school-logic";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useT } from "@/i18n";
import { SUPPORT_TOPIC_INFO, awaitingFor, staffStatusLabel, topicForTicket } from "@shared/support-contract";
import { formatHalfUnits, type HsPlanCourse, type StaffHighSchoolState } from "@shared/high-school-contract";
import type { StudentProfileView } from "@shared/student-profile-contract";
import type { StudentDocument } from "@shared/schema";
import type { StaffBillingView } from "@shared/billing-contract";
import { useStaffBilling } from "@/lib/billing-queries";
import { BillingSummaryCard } from "@/components/admin/billing/billing-summary-card";
import { StudentPortalAccountCard } from "@/components/admin/student-portal-account-card";
import { DossierActivity, DossierBilling, ExperienceButton, ExperienceError, NextStepBanner, ViewAsStudentLink, nextStep, useExperienceAction } from "@/components/admin/dossier/dossier-parts";
import { DemoPill, isDemoStudent, shortProgram, studentStatusLabel } from "@/components/admin/directory/directory-data";

void React;

export const STUDENT_FILE_TABS = ["overview", "academics", "documents", "billing", "support", "profile", "activity", "ai"] as const;
type FileTab = (typeof STUDENT_FILE_TABS)[number];
const TAB_ALIASES: Readonly<Record<string, FileTab>> = {
  "workspace-overview": "overview", "workspace-profile": "profile", "workspace-documents": "documents", "workspace-support": "support",
  guardian: "profile", guardians: "profile", "workspace-billing": "billing", "workspace-academics": "academics", courses: "academics",
};
const LINK = `${staffBtn.outline} inline-flex items-center justify-center border`;

export interface StudentFileRecord {
  id: string;
  status: string;
  student_code?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  preferred_name?: string | null;
  email?: string | null;
  user_id?: string | null;
}

export interface Checkpoint { key: string; label: string; done: boolean; detail: string }

/** Plan facts. Planned = every course still in the plan (not replaced/removed) in the published roadmap,
 *  or in the unpublished draft when nothing is published yet (shown to staff only, labelled DRAFT). */
export function plannedCourses(state: StaffHighSchoolState): readonly HsPlanCourse[] {
  const content = state.current?.published?.content ?? state.current?.draft?.content;
  return (content?.courses ?? []).filter((c) => c.status === "planned");
}
export const isDraftPlan = (state: StaffHighSchoolState): boolean => !state.current?.published && !!state.current?.draft;
/** Relative planning phase stored on the course's first task (e.g. "accelerated weeks 1–4 after activation"). */
export const coursePhase = (c: HsPlanCourse): string | null => {
  const t = c.tasks[0]?.title ?? "";
  const m = t.match(/weeks? ([0-9–-]+)/i);
  return /^Planning target/i.test(t) && m ? `Weeks ${m[1]} after activation` : null;
};

export interface GateInput {
  state: StaffHighSchoolState;
  documents?: readonly StudentDocument[];
  billing?: StaffBillingView;
}
export interface Gate { key: string; label: string; status: "done" | "pending" | "not_set"; detail: string }
const addDays = (iso: string, days: number) => { const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const addMonths = (iso: string, months: number) => { const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + months); return d.toISOString().slice(0, 10); };
/**
 * Contract / pre-enrollment gates, derived ONLY from stored records. Relative deadlines (English test
 * 30 days after two-party signature, school records 90 days after enrollment, 9 months of support from
 * activation) show "date not yet set" until their anchor is actually recorded.
 */
export function contractGates({ state, documents = [], billing }: GateInput): Gate[] {
  const cur = state.current;
  const agreement = documents.find((d) => d.doc_type === "consent_form");
  const signedOn = agreement?.status === "verified" ? String((agreement as { verified_at?: string | null }).verified_at ?? "").slice(0, 10) || null : null;
  const english = documents.find((d) => d.doc_type === "english_cert");
  const b = billing?.student;
  const paid = b?.state === "configured" && b.netObligationCents > 0 && b.paidCents >= b.netObligationCents;
  const activated = cur?.enrollment.startedOn ?? null;
  return [
    { key: "agreement", label: "Agreement signed by both parties", status: signedOn ? "done" : "pending",
      detail: signedOn ? `Signed agreement verified (${signedOn}).` : agreement ? "Proposed agreement on file; signature not verified." : "No agreement on file." },
    { key: "payment", label: "Contract amount received in full", status: paid ? "done" : b?.state === "configured" ? "pending" : "not_set",
      detail: b?.state === "configured" ? `${(b.paidCents / 100).toLocaleString("en-US")} of ${(b.netObligationCents / 100).toLocaleString("en-US")} ${b.currency} received.` : "No contract amount recorded in Billing." },
    { key: "disclosure", label: "School identity disclosed to the family", status: cur?.enrollment.institutionDisclosed ? "done" : "pending",
      detail: cur?.enrollment.institutionDisclosed ? "Disclosed." : "Only after two-party signature and full cleared payment." },
    { key: "english", label: "English test result (due 30 days after signature)", status: english?.status === "verified" ? "done" : signedOn ? "pending" : "not_set",
      detail: english?.status === "verified" ? "Official result verified." : signedOn ? `Due by ${addDays(signedOn, 30)}.` : "Date not yet set (starts at two-party signature)." },
    { key: "activation", label: "Academic program activated", status: activated ? "done" : "not_set",
      detail: activated ? `Activated ${activated}.` : "Date not yet set (after signature and payment)." },
    { key: "records", label: "Prior school records (due 90 days after school enrollment)", status: (cur?.priorEducation ?? []).some((p) => p.evidenceDocumentId) ? "done" : activated ? "pending" : "not_set",
      detail: activated ? `Due by ${addDays(activated, 90)}.` : "Date not yet set (starts at school enrollment)." },
    { key: "support", label: "Lumière support window (9 months from activation)", status: activated ? "done" : "not_set",
      detail: activated ? `Runs to ${addMonths(activated, 9)}.` : "Date not yet set (starts at activation)." },
  ];
}
export function plannedHalfUnits(state: StaffHighSchoolState): number {
  return plannedCourses(state).reduce((sum, c) => sum + c.halfUnits, 0);
}
export const isTestOnlyTitle = (title: string): boolean => /TEST ONLY|APPROVAL PENDING|AWAITING SCHOOL|PROPOSED/i.test(title);

/** Checklist derived only from stored facts. */
export function enrollmentCheckpoints(input: { student: StudentFileRecord; state: StaffHighSchoolState; profile?: StudentProfileView }): Checkpoint[] {
  const { student, state, profile } = input;
  const cur = state.current;
  const guardians = profile?.contacts.filter((c) => c.type === "guardian" || c.type === "parent") ?? [];
  const verifiedGuardian = guardians.some((g) => g.authorityStatus === "verified");
  const guardianCount = guardians.length || state.guardians.length;
  const verifiedAny = verifiedGuardian || state.guardians.some((g) => g.standing === "verified_guardian");
  const prior = cur?.priorEducation ?? [];
  const row = (key: string, label: string, done: boolean, yes: string, no: string): Checkpoint => ({ key, label, done, detail: done ? yes : no });
  return [
    row("portal", "Portal account linked", !!student.user_id, "A login is linked to this student.", "No login is linked yet."),
    row("guardian", "Guardian listed and verified", verifiedAny, "A guardian's authority is verified.", guardianCount > 0 ? "Guardian listed, authority not verified yet." : "No guardian listed."),
    row("institution", "Awarding institution disclosed", !!cur?.enrollment.institutionDisclosed, "The school name is visible to the student.", "Not disclosed to the student yet."),
    row("schoolref", "School student reference", !!cur?.enrollment.schoolStudentRef, "A school reference is recorded.", "No school reference recorded."),
    row("prior", "Prior education recorded", prior.length > 0, `${prior.length} prior school${prior.length === 1 ? "" : "s"} recorded.`, "No prior education recorded."),
    row("roadmap", "Roadmap published", !!cur?.published, `Version ${cur?.published?.versionNumber ?? ""} is published.`, cur?.draft ? "A draft exists but is not published." : "No roadmap yet."),
    row("results", "Official results recorded", (cur?.results.length ?? 0) > 0, `${cur?.results.length ?? 0} official result${cur?.results.length === 1 ? "" : "s"} on record.`, "None recorded by the school yet."),
    row("graduation", "Graduation", cur?.graduation.status === "diploma_conferred", "Diploma conferred.", cur ? `Status: ${statusLabel(cur.graduation.status)}.` : "No enrollment."),
  ];
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div><dt className={staffLabel}>{label}</dt><dd className="mt-1 font-serif text-2xl tabular-nums text-student-ink">{value}</dd>{hint ? <dd className="mt-0.5 text-xs text-student-muted">{hint}</dd> : null}</div>;
}

export interface HsOverviewProps {
  studentId: string;
  student: StudentFileRecord;
  state: StaffHighSchoolState;
  profile?: StudentProfileView;
  attention: { label: string; count: number; detail: string; none: string; tab: FileTab }[];
  onTab?: (tab: FileTab) => void;
  documents?: readonly StudentDocument[];
  billing?: StaffBillingView;
  billingLoading?: boolean;
  billingError?: boolean;
}

/** High-school overview: pure, server-renderable. Needs attention first, then where the student stands. */
export function StudentFileHsOverview({ studentId, student, state, profile, attention, onTab, documents, billing }: HsOverviewProps) {
  const cur = state.current;
  const href = `/admin/students/${encodeURIComponent(studentId)}/high-school`;
  if (!cur) {
    return <div className="space-y-5" data-testid="student-file-hs-overview">
      <Attention rows={attention} onTab={onTab} />
      <StaffCard as="div" tone="gold" className="space-y-3" data-testid="hs-no-program">
        <p className={staffLabel}>High school program</p>
        <p className="font-serif text-xl text-student-ink">No high school program has been set up yet</p>
        <p className="max-w-2xl text-sm text-student-muted">A short guided setup creates the program: choose the diploma, confirm credits and electives, set pace and approval gates, then review and save. Nothing is visible to the student until you publish the roadmap.</p>
        <Link href={href} className={`${staffBtn.primary} inline-flex items-center justify-center`} data-testid="link-open-hs-pathway">Set up the high-school program<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
      </StaffCard>
    </div>;
  }
  const { enrollment, credits } = cur;
  const courses = plannedCourses(state);
  const planned = plannedHalfUnits(state);
  const checkpoints = enrollmentCheckpoints({ student, state, profile });
  const doneCount = checkpoints.filter((c) => c.done).length;
  return <div className="space-y-6" data-testid="student-file-hs-overview">
    <Attention rows={attention} onTab={onTab} />
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <StaffCard as="div" className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0"><p className={staffLabel}>High school program</p><p className="mt-2 break-words font-serif text-xl leading-snug text-student-ink" data-testid="hs-program-title">{enrollment.programTitle}</p></div>
          <StaffPill tone={enrollment.status === "active" || enrollment.status === "completed" ? "seal" : "neutral"}>{statusLabel(enrollment.status)}</StaffPill>
        </div>
        <dl className="grid grid-cols-2 gap-4 text-sm"><div><dt className={staffLabel}>Start</dt><dd className="mt-1">{formatDate(enrollment.startedOn)}</dd></div><div><dt className={staffLabel}>Target completion</dt><dd className="mt-1">{formatDate(enrollment.targetCompletionDate)}</dd><dd className="text-xs text-student-muted">a target, not a guarantee</dd></div></dl>
        <Link href={href} className={LINK} data-testid="link-open-hs-pathway">Open full high-school pathway<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
      </StaffCard>
      <section aria-label="Credits" data-testid="hs-credit-summary">
        <StaffCard as="div" className="h-full">
          <StaffSectionHeader level={3} icon={<GraduationCap className="h-5 w-5" />} title="Credits" description="Planned credit is a plan. Only the awarding school's confirmed results count as earned." className="mb-3" />
          <dl className="grid grid-cols-2 gap-4">
            <Stat label="Planned" value={formatHalfUnits(planned)} hint={`${courses.length} course${courses.length === 1 ? "" : "s"} in the ${isDraftPlan(state) ? "DRAFT (not visible to the student)" : "published"} plan`} />
            <Stat label="Officially earned" value={formatHalfUnits(credits.earnedHalfUnits)} hint={`of ${formatHalfUnits(credits.requiredHalfUnits)} required · school-confirmed only`} />
            <Stat label="Reported, awaiting confirmation" value={formatHalfUnits(credits.awaitingConfirmationHalfUnits)} hint="student-reported, not official" />
            <Stat label="Review queue" value={String(cur.reviewQueue.length)} hint={cur.reviewQueue.length ? "reports waiting for staff" : "nothing waiting"} />
          </dl>
          <p className="mt-4 text-sm text-student-muted" data-testid="hs-core-elective">Core {formatHalfUnits(credits.core.earnedHalfUnits)} of {formatHalfUnits(credits.core.requiredHalfUnits)} required earned · Elective {formatHalfUnits(credits.elective.earnedHalfUnits)} of {formatHalfUnits(credits.elective.requiredHalfUnits)} required earned</p>
        </StaffCard>
      </section>
    </div>

    <div className="grid gap-5 lg:grid-cols-2">
      <section aria-label="Enrollment checkpoints" className="space-y-3" data-testid="hs-checkpoints">
        <StaffSectionHeader level={3} icon={<CheckCircle2 className="h-5 w-5" />} title="Enrollment checkpoints" description={`${doneCount} of ${checkpoints.length} done. Each item reflects a stored record only.`} className="mb-0" />
        <StaffCard as="div" padded={false}><ul className="divide-y divide-student-line">
          {checkpoints.map((c) => <li key={c.key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" data-testid={`checkpoint-${c.key}`}>
            <div className="min-w-0"><p className="font-medium text-student-ink">{c.label}</p><p className="text-sm text-student-muted">{c.detail}</p></div>
            <StaffPill tone={c.done ? "seal" : "dashed"} icon={c.done ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <CircleDashed className="h-3.5 w-3.5" aria-hidden="true" />}>{c.done ? "Done" : "Pending"}</StaffPill>
          </li>)}
        </ul></StaffCard>
      </section>
      <section aria-label="Contract gates" className="space-y-3" data-testid="hs-contract-gates">
        <StaffSectionHeader level={3} icon={<ShieldCheck className="h-5 w-5" />} title="Contract and pre-enrollment gates" description="From stored documents, billing and enrollment records only. Nothing here is marked done without a record." className="mb-0" />
        <StaffCard as="div" padded={false}><ul className="divide-y divide-student-line">
          {contractGates({ state, documents, billing }).map((g) => <li key={g.key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" data-testid={`gate-${g.key}`}>
            <div className="min-w-0"><p className="font-medium text-student-ink">{g.label}</p><p className="text-sm text-student-muted">{g.detail}</p></div>
            <StaffPill tone={g.status === "done" ? "seal" : g.status === "pending" ? "attention" : "dashed"}>{g.status === "done" ? "Done" : g.status === "pending" ? "Pending" : "Date not set"}</StaffPill>
          </li>)}
        </ul></StaffCard>
      </section>
    </div>
    <StudentPortalAccountCard studentId={studentId} />
  </div>;
}

/** Academics: the course roadmap grouped core / electives, with a way into the full pathway. */
export function StudentFileHsAcademics({ studentId, state }: { studentId: string; state: StaffHighSchoolState }) {
  const cur = state.current;
  const href = `/admin/students/${encodeURIComponent(studentId)}/high-school`;
  if (!cur) {
    return <StaffNotice tone="gold" role="status" action={<Link href={href} className={`${staffBtn.primary} inline-flex items-center justify-center`} data-testid="link-open-hs-pathway">Set up the program<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>}>No courses yet: the high-school program has not been set up.</StaffNotice>;
  }
  const courses = plannedCourses(state);
  const areas = (cur.published?.content ?? cur.draft?.content)?.areas ?? [];
  const isElective = (c: HsPlanCourse) => areas.find((a) => a.key === c.areaKey)?.kind === "elective" || c.areaKey === "electives";
  const core = courses.filter((c) => !isElective(c));
  const electives = courses.filter(isElective);
  const group = (title: string, list: readonly HsPlanCourse[], testId: string) => (
    <section aria-label={title} className="space-y-3" data-testid={testId}>
      <StaffSectionHeader level={3} title={title} description={`${list.length} course${list.length === 1 ? "" : "s"} · ${formatHalfUnits(list.reduce((n, c) => n + c.halfUnits, 0))} credits planned`} className="mb-0" />
      {list.length === 0 ? <StaffNotice tone="gold" role="status">None planned yet.</StaffNotice> : <ul className="grid gap-3 md:grid-cols-2" data-testid={testId === "hs-core" ? "hs-course-list" : undefined}>
        {list.map((c) => {
          const official = cur.results.some((r) => r.courseKey === c.key && r.taskKey === null);
          return <li key={c.key}><StaffCard as="div" className="space-y-1 !p-3.5">
            <div className="flex flex-wrap items-start justify-between gap-2"><p className="min-w-0 break-words font-medium text-student-ink">{c.title}</p>
              <div className="flex flex-wrap gap-1.5">{isTestOnlyTitle(c.title) ? <StaffPill tone="attention">Approval pending</StaffPill> : null}<StaffPill tone={official ? "seal" : "neutral"}>{official ? "School result recorded" : "Planned"}</StaffPill></div></div>
            <p className="text-sm text-student-muted">{formatHalfUnits(c.halfUnits)} credit{c.halfUnits === 2 ? "" : "s"} · {c.plannedStart || c.plannedEnd ? `${formatDate(c.plannedStart)} to ${formatDate(c.plannedEnd)}` : coursePhase(c) ?? "No planned window"}</p>
          </StaffCard></li>;
        })}
      </ul>}
    </section>
  );
  return <div className="space-y-6" data-testid="student-file-hs-academics">
    <StaffSectionHeader icon={<GraduationCap className="h-5 w-5" />} title="Course roadmap" description={cur.published ? `Roadmap version ${cur.published.versionNumber}, visible to the student.` : cur.draft ? "DRAFT plan: not published, not visible to the student." : "No roadmap published yet."}
      actions={<Link href={href} className={LINK} data-testid="link-open-hs-pathway">Open full pathway<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>} className="mb-0" />
    {courses.length === 0 ? <StaffNotice tone="gold" role="status">No courses are planned yet.</StaffNotice> : <>
      {group("Core courses", core, "hs-core")}
      {group("Electives", electives, "hs-electives")}
    </>}
  </div>;
}

function Attention({ rows, onTab }: { rows: HsOverviewProps["attention"]; onTab?: (tab: FileTab) => void }) {
  const total = rows.reduce((n, r) => n + r.count, 0);
  const waiting = rows.filter((r) => r.count > 0);
  const clear = rows.filter((r) => r.count === 0);
  return <section aria-label="Needs attention" className="space-y-3" data-testid="student-file-attention">
    <StaffSectionHeader level={3} title="Needs attention" description={total ? `${total} item${total === 1 ? "" : "s"} waiting on staff` : "Nothing is waiting on staff."} className="mb-0" />
    {waiting.length ? <StaffCard as="div" padded={false} tone="attention"><ul className="divide-y divide-student-line">
      {waiting.map((r) => <li key={r.label} className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0"><p className="font-medium text-student-ink">{r.label}</p><p className="text-sm text-student-muted">{r.detail}</p></div>
        {onTab ? <Button type="button" size="sm" variant="outline" className={`${staffBtn.outline} shrink-0`} aria-label={`Review ${r.label}`} onClick={() => onTab(r.tab)}>Review<ArrowRight className="h-4 w-4" aria-hidden="true" /></Button> : null}
      </li>)}
    </ul></StaffCard> : null}
    {clear.length ? <p className="flex items-start gap-2 text-sm text-student-muted"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-student-gold-ink" aria-hidden="true" /><span>All clear: {clear.map((r) => r.label.toLowerCase()).join(", ")}.</span></p> : null}
  </section>;
}

export function StudentFileSupport({ studentId, tickets, loading, error, onRetry }: { studentId: string; tickets: readonly Ticket[]; loading?: boolean; error?: boolean; onRetry?: () => void }) {
  return <section id="workspace-support" aria-labelledby="workspace-support-heading" className="space-y-4">
    <StaffSectionHeader id="workspace-support-heading" icon={<LifeBuoy className="h-5 w-5" />} title="Support" description="Support tickets associated with this student. Replies happen in the Support desk." actions={<Link href={`/support?studentId=${encodeURIComponent(studentId)}`} className={LINK}>Open Support desk</Link>} />
    {loading ? <div role="status" className="rounded-md border p-6 text-center text-sm text-student-muted">Loading…</div>
      : error ? <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm"><p>Could not load support tickets.</p>{onRetry ? <Button className="mt-3" type="button" size="sm" variant="outline" onClick={onRetry}>Retry</Button> : null}</div>
      : tickets.length === 0 ? <StaffNotice tone="gold" role="status">No support tickets for this student.</StaffNotice>
      : <ul className="space-y-3">{tickets.map((ticket) => <li key={ticket.id}><StaffCard as="div" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="min-w-0 break-words font-medium text-student-ink">{ticket.subject}</p><div className="flex flex-wrap gap-2"><StatusPill status={ticketStatusKey(ticket.status)} label={staffStatusLabel(ticket.status)} /><StaffPill tone={ticket.priority === "urgent" ? "urgent-solid" : ticket.priority === "high" ? "attention" : "neutral"}>{workspaceToken(ticket.priority) ?? ticket.priority}</StaffPill></div></div>
        <p className="text-sm text-student-muted">{ticket.ticket_number} · {SUPPORT_TOPIC_INFO[ticket.topic ?? topicForTicket(null, ticket.category)].label}</p>
        {formatWorkspaceDateTime(ticket.created_at) ? <p className="text-xs text-student-muted">Opened {formatWorkspaceDateTime(ticket.created_at)}</p> : null}
        <Link href={`/support?studentId=${encodeURIComponent(studentId)}&ticket=${encodeURIComponent(ticket.id)}`} className="inline-flex min-h-10 items-center text-sm font-semibold text-student-gold-ink underline-offset-4 hover:underline" data-testid="link-workspace-ticket">Open conversation</Link>
      </StaffCard></li>)}</ul>}
  </section>;
}

export function studentDisplayName(s: StudentFileRecord): string {
  const first = s.preferred_name || s.first_name || "";
  const full = [first, s.last_name].filter(Boolean).join(" ").trim();
  return full || s.email || s.student_code || "Student";
}

/** Full student file for a student without a university workspace. */
export default function StudentFileHs({ studentId, student }: { studentId: string; student: StudentFileRecord }) {
  const { user } = useAuth();
  const { t } = useT();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "admin";
  const [tab, setTab] = useHashTab(STUDENT_FILE_TABS, "overview", TAB_ALIASES);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [activation, setActivation] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const hs = useHsState(studentId);
  const documentsQuery = useDocuments(studentId);
  const billingQuery = useStaffBilling(studentId);
  const ticketsQuery = useTickets({ studentId });
  const { profileQuery } = useStaffProfileData(studentId);
  const record = useQuery<StudentFileRecord>({ queryKey: [`/api/students/${encodeURIComponent(studentId)}`], initialData: student });
  const experience = useExperienceAction(studentId);
  const current = record.data ?? student;
  const activate = useMutation({
    mutationFn: () => apiRequest(`/api/admin/students/${encodeURIComponent(studentId)}/status`, { method: "PATCH", body: JSON.stringify({ status: "active" }) }),
    onMutate: () => setActivation(null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/students"] });
      await record.refetch();
      setActivation({ kind: "success", message: "Lead activated." });
    },
    onError: (e) => setActivation({ kind: "error", message: e instanceof Error ? e.message : "Could not activate this lead." }),
  });

  const name = studentDisplayName(current);
  const profile = profileQuery.data;
  const profileCount = profile ? profileDecisionCount(profile) : 0;
  const docsPending = (documentsQuery.data ?? []).filter((d: StudentDocument) => documentNeedsReview(d.status)).length;
  const tickets = ticketsQuery.data?.tickets ?? [];
  const supportAwaiting = tickets.filter((x) => awaitingFor(x.status) === "staff").length;
  const activeTab: FileTab = tab === "ai" && !isAdmin ? "overview" : tab;
  const demo = isDemoStudent({ first_name: current.first_name ?? "", last_name: current.last_name ?? "", preferred_name: current.preferred_name, email: current.email });
  const programTitle = hs.data?.current?.enrollment.programTitle;
  const tabs: StaffTab[] = [
    { key: "overview", label: "Overview", icon: <LayoutDashboard className="h-4 w-4" /> },
    { key: "academics", label: "Academics", icon: <GraduationCap className="h-4 w-4" /> },
    { key: "documents", label: "Documents", icon: <FileText className="h-4 w-4" />, count: docsPending, countLabel: "waiting for review" },
    { key: "billing", label: "Billing", icon: <CreditCard className="h-4 w-4" /> },
    { key: "support", label: "Support", icon: <LifeBuoy className="h-4 w-4" />, count: supportAwaiting, countLabel: "waiting for a response" },
    { key: "profile", label: "Guardian & identity", icon: <Fingerprint className="h-4 w-4" />, count: profileCount, countLabel: "decisions waiting" },
    ...(isAdmin ? [{ key: "activity", label: "Activity", icon: <Activity className="h-4 w-4" /> }, { key: "ai", label: "Lumière AI", icon: <BrainCircuit className="h-4 w-4" /> }] : []),
  ];
  const attention = [
    { label: "Identity and guardian decisions", count: profileCount, detail: `${profileCount} waiting for a decision`, none: "No decisions waiting", tab: "profile" as const },
    { label: "Documents to review", count: docsPending, detail: `${docsPending} waiting for review`, none: "No documents waiting", tab: "documents" as const },
    { label: "Requests waiting on Lumière", count: supportAwaiting, detail: `${supportAwaiting} waiting for a response`, none: "No requests waiting", tab: "support" as const },
    { label: "High school reports to review", count: hs.data?.current?.reviewQueue.length ?? 0, detail: `${hs.data?.current?.reviewQueue.length ?? 0} student reports waiting`, none: "No reports waiting", tab: "academics" as const },
  ];
  const step = nextStep({
    status: current.status, profileDecisions: profileCount, docsPending, supportAwaiting,
    hasProgram: hs.data ? !!hs.data.current : undefined,
    billingConfigured: billingQuery.data ? billingQuery.data.student.state === "configured" : undefined,
    canActivate: canActivateLeadForRole(user?.role, current.status),
  }, studentId);
  const identity = { studentId, firstName: profile?.identity.firstName ?? current.first_name, lastName: profile?.identity.lastName ?? current.last_name, name, photoUrl: profile?.identity.photoUrl };

  return <StaffPage testId="admin-student-workspace">
    <StaffFileHeader
      testId="student-file-header"
      back={<Link href="/admin/students" className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-student-gold-ink underline-offset-4 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to Students</Link>}
      eyebrow="Staff Portal · Student file"
      portrait={<AccountAvatar identity={identity} className="h-16 w-16 shrink-0 text-xl ring-2 ring-student-gold/50 sm:h-20 sm:w-20 sm:text-2xl" />}
      title={name}
      description={<>{current.email ?? profile?.contact.email ?? "Email not provided"} · <span className="font-mono">{current.student_code ?? profile?.identity.studentCode ?? "No student code"}</span></>}
      meta={<div className="flex flex-wrap items-center gap-2">
        <StaffPill tone="seal">{studentStatusLabel(current.status)}</StaffPill>
        {demo ? <DemoPill /> : null}
        <StaffPill tone="neutral" icon={<GraduationCap className="h-3.5 w-3.5" aria-hidden="true" />}>{programTitle ? shortProgram(programTitle) : hs.data ? "No program yet" : "Loading program…"}</StaffPill>
      </div>}
      actions={<>
        <ViewAsStudentLink studentId={studentId} />
        {canActivateLeadForRole(user?.role, current.status) ? <Button type="button" size="sm" className={staffBtn.seal} disabled={activate.isPending} onClick={() => activate.mutate()} data-testid="button-activate-lead">{activate.isPending ? "Activating…" : <><UserCheck className="h-4 w-4" aria-hidden="true" />Activate lead</>}</Button> : null}
        <Button type="button" variant="outline" size="sm" className={staffBtn.outline} onClick={() => setPhotoOpen(true)} data-testid="button-student-photo">{t("staff.photo.button")}</Button>
        {isAdmin ? <Link href={`/admin/assistant?studentId=${encodeURIComponent(studentId)}`} className={LINK} data-testid="link-student-ai"><BrainCircuit className="h-4 w-4" aria-hidden="true" />Ask Lumière AI</Link> : null}
      </>}
    />
    <ExperienceError action={experience} />
    {demo ? <StaffNotice tone="attention" role="status">This is a synthetic demo student. Nothing here is a real person, payment or school record, and it is never counted in real totals.</StaffNotice> : null}
    {activation ? <StaffNotice tone={activation.kind === "error" ? "urgent" : "gold"} role={activation.kind === "error" ? "alert" : "status"}>{activation.message}</StaffNotice> : null}
    <NextStepBanner step={step} onTab={(k) => setTab(k as FileTab)} experience={experience} />
    <PhotoDialog
      open={photoOpen}
      onOpenChange={setPhotoOpen}
      identity={identity}
      title={t("staff.photo.title")}
      description={t("staff.photo.desc")}
      onChanged={() => { void queryClient.invalidateQueries({ queryKey: STAFF_PROFILE_QUERY_KEY(studentId) }); }}
    />
    <StaffTabList tabs={tabs} active={activeTab} onChange={(key) => setTab(key as FileTab)} label="Student file sections" idPrefix="ws" />

    <StaffTabPanel idPrefix="ws" tabKey="overview" active={activeTab === "overview"}>
      <div id="workspace-overview" aria-label="Overview">
        {hs.isLoading ? <div role="status" className="rounded-md border p-6 text-center text-sm text-student-muted">Loading high school record…</div>
          : hs.isError || !hs.data ? <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm"><p>The high school record could not be loaded.</p><Button className="mt-3" type="button" size="sm" variant="outline" onClick={() => void hs.refetch()}>Retry</Button></div>
          : <StudentFileHsOverview studentId={studentId} student={current} state={hs.data} profile={profile} attention={attention} onTab={setTab} documents={documentsQuery.data} billing={billingQuery.data} billingLoading={billingQuery.isLoading} billingError={billingQuery.isError} />}
      </div>
    </StaffTabPanel>
    <StaffTabPanel idPrefix="ws" tabKey="academics" active={activeTab === "academics"}>
      {hs.isLoading ? <div role="status" className="rounded-md border p-6 text-center text-sm text-student-muted">Loading courses…</div>
        : hs.data ? <StudentFileHsAcademics studentId={studentId} state={hs.data} />
        : <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm"><p>The courses could not be loaded.</p><Button className="mt-3" type="button" size="sm" variant="outline" onClick={() => void hs.refetch()}>Retry</Button></div>}
    </StaffTabPanel>
    <StaffTabPanel idPrefix="ws" tabKey="documents" active={activeTab === "documents"}>
      <section id="workspace-documents" aria-labelledby="workspace-documents-heading" className="space-y-4">
        <StaffSectionHeader id="workspace-documents-heading" icon={<FileText className="h-5 w-5" />} title="Documents" description="Verify, reject or request a new upload. The reason you write for the student is shown to them; the internal note never is." />
        {documentsQuery.isLoading ? <div role="status" className="rounded-md border p-6 text-center text-sm text-student-muted">Loading…</div>
          : documentsQuery.isError ? <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm"><p>Could not load documents.</p><Button className="mt-3" type="button" size="sm" variant="outline" onClick={() => void documentsQuery.refetch()}>Retry</Button></div>
          : <StudentDocumentsReview studentId={studentId} documents={documentsQuery.data ?? []} />}
      </section>
    </StaffTabPanel>
    <StaffTabPanel idPrefix="ws" tabKey="billing" active={activeTab === "billing"}>
      <DossierBilling studentId={studentId} billing={billingQuery.data} loading={billingQuery.isLoading} error={billingQuery.isError} />
    </StaffTabPanel>
    <StaffTabPanel idPrefix="ws" tabKey="support" active={activeTab === "support"}>
      <StudentFileSupport studentId={studentId} tickets={tickets} loading={ticketsQuery.isLoading} error={ticketsQuery.isError} onRetry={() => void ticketsQuery.refetch()} />
    </StaffTabPanel>
    <StaffTabPanel idPrefix="ws" tabKey="profile" active={activeTab === "profile"}><StudentProfileReview studentId={studentId} /></StaffTabPanel>
    {isAdmin ? <StaffTabPanel idPrefix="ws" tabKey="activity" active={activeTab === "activity"}><DossierActivity studentId={studentId} /></StaffTabPanel> : null}
    {isAdmin ? <StaffTabPanel idPrefix="ws" tabKey="ai" active={activeTab === "ai"}><OwnerAssistantPanel studentId={studentId} studentLabel={name} /></StaffTabPanel> : null}
  </StaffPage>;
}
