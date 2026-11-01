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
import { useAgreement } from "@/lib/s27-queries";
import type { ProgramAgreementView } from "@shared/s27-contract";
import { ActivateStudentButton } from "@/components/admin/activate-student";
import { studentFilePath } from "@shared/staff-links";
import { canActivateLeadForRole } from "@/components/admin/student-documents-upload-logic";
import { OwnerAssistantPanel } from "@/components/owner-assistant/owner-assistant-panel";
import { AccountAvatar, PhotoDialog } from "@/components/os/account-menu";
import { ticketStatusKey } from "@/components/support/support-presentation";
import { documentNeedsReview, enTr, formatWorkspaceDateTime, tokenLabel, workspaceToken, type WsTr } from "@/pages/admin-student-workspace-presentation";
import { supportText } from "@/components/support/original-support-text";
import { useDocuments } from "@/hooks/use-documents";
import { useTickets, type Ticket } from "@/hooks/use-tickets";
import { useHsState } from "@/lib/admin-high-school-api";
import { formatDate, statusLabel } from "@/lib/admin-high-school-logic";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useT, type Language } from "@/i18n";
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

/** S32-B: translated words for values the shared helpers return in English. English output is unchanged. */
const MONTHS_FR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."] as const;
export function fileDate(value: string | null | undefined, language: Language): string {
  if (language !== "fr") return formatDate(value);
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  const month = m ? MONTHS_FR[Number(m[2]) - 1] : undefined;
  return m && month ? `${Number(m[3])} ${month} ${m[1]}` : value;
}
export const fileStatusText = (value: string, tr: WsTr = enTr): string => tokenLabel(value, tr) ?? statusLabel(value);
export function studentStatusText(status: string, tr: WsTr = enTr): string {
  const key = `s32ws.sh.status.${status}` as Parameters<WsTr>[0];
  const found = tr(key);
  return found !== key ? found : studentStatusLabel(status);
}
export function ticketStatusText(status: Ticket["status"], language: Language, tr: WsTr = enTr): string {
  return language === "fr" ? tr(`s32sup.status.${status}` as Parameters<WsTr>[0]) : staffStatusLabel(status);
}
export function ticketTopicText(ticket: Pick<Ticket, "topic" | "category">, language: Language): string {
  const key = (ticket.topic ?? topicForTicket(null, ticket.category)) as keyof typeof SUPPORT_TOPIC_INFO;
  return language === "fr" ? supportText("fr").topics[key]?.label ?? SUPPORT_TOPIC_INFO[key].label : SUPPORT_TOPIC_INFO[key].label;
}

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
export const coursePhase = (c: HsPlanCourse, tr: WsTr = enTr): string | null => {
  const t = c.tasks[0]?.title ?? "";
  const m = t.match(/weeks? ([0-9–-]+)/i);
  return /^Planning target/i.test(t) && m ? tr("s32ws.hs.phase", { w: m[1] }) : null;
};

export interface GateInput {
  state: StaffHighSchoolState;
  documents?: readonly StudentDocument[];
  billing?: StaffBillingView;
  /** S32-B: the S27 agreement (authoritative terms); null/undefined -> the older document-based fallback. */
  agreement?: ProgramAgreementView | null;
}
export interface Gate { key: string; label: string; status: "done" | "pending" | "not_set"; detail: string }
const addDays = (iso: string, days: number) => { const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const addMonths = (iso: string, months: number) => { const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + months); return d.toISOString().slice(0, 10); };
/**
 * Contract / pre-enrollment gates, derived ONLY from stored records. Relative deadlines show "date not yet set"
 * until their anchor is actually recorded.
 *
 * S32-B (SA-26): when the S27 agreement is known it is the single source: "signed" is the agreement's signing date
 * (the same fact the Student File Overview shows), and the English-test, prior-records and support-window values
 * are the agreement's editable terms instead of hard-coded 30 days / 90 days / 9 months. The consent-document
 * fallback is used only when no agreement record exists.
 */
export function contractGates({ state, documents = [], billing, agreement: terms }: GateInput, tr: WsTr = enTr): Gate[] {
  const cur = state.current;
  const agreement = documents.find((d) => d.doc_type === "consent_form");
  const docSignedOn = agreement?.status === "verified" ? String((agreement as { verified_at?: string | null }).verified_at ?? "").slice(0, 10) || null : null;
  const signedOn = terms ? terms.signedOn : docSignedOn;
  const langDays = terms?.languageTestDays ?? 30;
  const recordDays = terms?.priorSchoolingDays ?? 90;
  const supportMonths = terms?.supportMonths ?? 9;
  const english = documents.find((d) => d.doc_type === "english_cert");
  const b = billing?.student;
  const paid = b?.state === "configured" && b.netObligationCents > 0 && b.paidCents >= b.netObligationCents;
  const activated = terms?.activatedOn ?? cur?.enrollment.startedOn ?? null;
  const englishDue = terms?.deadlines.find((d) => d.key === "language_test")?.dueOn ?? (signedOn ? addDays(signedOn, langDays) : null);
  const recordsDue = terms?.deadlines.find((d) => d.key === "prior_schooling_proof")?.dueOn ?? (activated ? addDays(activated, recordDays) : null);
  const supportEnds = terms?.supportEndsOn ?? (activated ? addMonths(activated, supportMonths) : null);
  return [
    { key: "agreement", label: tr("s32ws.hs.gate.agreement"), status: signedOn ? "done" : "pending",
      detail: signedOn ? (terms ? tr("s32ws.hs.gate.agreement.signed", { date: signedOn }) : tr("s32ws.hs.gate.agreement.verified", { date: signedOn })) : agreement ? tr("s32ws.hs.gate.agreement.proposed") : tr("s32ws.hs.gate.agreement.none") },
    { key: "payment", label: tr("s32ws.hs.gate.payment"), status: paid ? "done" : b?.state === "configured" ? "pending" : "not_set",
      detail: b?.state === "configured" ? tr("s32ws.hs.gate.payment.detail", { paid: (b.paidCents / 100).toLocaleString(tr("s32ws.hs.locale")), net: (b.netObligationCents / 100).toLocaleString(tr("s32ws.hs.locale")), currency: b.currency }) : tr("s32ws.hs.gate.payment.none") },
    { key: "disclosure", label: tr("s32ws.hs.gate.disclosure"), status: cur?.enrollment.institutionDisclosed ? "done" : "pending",
      detail: cur?.enrollment.institutionDisclosed ? tr("s32ws.hs.gate.disclosure.yes") : tr("s32ws.hs.gate.disclosure.no") },
    { key: "english", label: tr("s32ws.hs.gate.english", { days: langDays }), status: english?.status === "verified" ? "done" : signedOn ? "pending" : "not_set",
      detail: english?.status === "verified" ? tr("s32ws.hs.gate.english.yes") : englishDue ? tr("s32ws.hs.gate.english.due", { date: englishDue }) : tr("s32ws.hs.gate.english.none") },
    { key: "activation", label: tr("s32ws.hs.gate.activation"), status: activated ? "done" : "not_set",
      detail: activated ? tr("s32ws.hs.gate.activation.yes", { date: activated }) : tr("s32ws.hs.gate.activation.none") },
    { key: "records", label: tr("s32ws.hs.gate.records", { days: recordDays }), status: (cur?.priorEducation ?? []).some((p) => p.evidenceDocumentId) ? "done" : activated ? "pending" : "not_set",
      detail: recordsDue ? tr("s32ws.hs.gate.records.due", { date: recordsDue }) : tr("s32ws.hs.gate.records.none") },
    { key: "support", label: tr("s32ws.hs.gate.support", { months: supportMonths }), status: activated ? "done" : "not_set",
      detail: supportEnds ? tr("s32ws.hs.gate.support.runs", { date: supportEnds }) : tr("s32ws.hs.gate.support.none") },
  ];
}
export function plannedHalfUnits(state: StaffHighSchoolState): number {
  return plannedCourses(state).reduce((sum, c) => sum + c.halfUnits, 0);
}
export const isTestOnlyTitle = (title: string): boolean => /TEST ONLY|APPROVAL PENDING|AWAITING SCHOOL|PROPOSED/i.test(title);

/** Checklist derived only from stored facts. */
export function enrollmentCheckpoints(input: { student: StudentFileRecord; state: StaffHighSchoolState; profile?: StudentProfileView }, tr: WsTr = enTr): Checkpoint[] {
  const { student, state, profile } = input;
  const cur = state.current;
  const guardians = profile?.contacts.filter((c) => c.type === "guardian" || c.type === "parent") ?? [];
  const verifiedGuardian = guardians.some((g) => g.authorityStatus === "verified");
  const guardianCount = guardians.length || state.guardians.length;
  const verifiedAny = verifiedGuardian || state.guardians.some((g) => g.standing === "verified_guardian");
  const prior = cur?.priorEducation ?? [];
  const row = (key: string, label: string, done: boolean, yes: string, no: string): Checkpoint => ({ key, label, done, detail: done ? yes : no });
  return [
    row("portal", tr("s32ws.hs.cp.portal"), !!student.user_id, tr("s32ws.hs.cp.portal.yes"), tr("s32ws.hs.cp.portal.no")),
    row("guardian", tr("s32ws.hs.cp.guardian"), verifiedAny, tr("s32ws.hs.cp.guardian.yes"), guardianCount > 0 ? tr("s32ws.hs.cp.guardian.listed") : tr("s32ws.hs.cp.guardian.none")),
    row("institution", tr("s32ws.hs.cp.institution"), !!cur?.enrollment.institutionDisclosed, tr("s32ws.hs.cp.institution.yes"), tr("s32ws.hs.cp.institution.no")),
    row("schoolref", tr("s32ws.hs.cp.schoolref"), !!cur?.enrollment.schoolStudentRef, tr("s32ws.hs.cp.schoolref.yes"), tr("s32ws.hs.cp.schoolref.no")),
    row("prior", tr("s32ws.hs.cp.prior"), prior.length > 0, prior.length === 1 ? tr("s32ws.hs.cp.prior.one") : tr("s32ws.hs.cp.prior.many", { n: prior.length }), tr("s32ws.hs.cp.prior.no")),
    row("roadmap", tr("s32ws.hs.cp.roadmap"), !!cur?.published, tr("s32ws.hs.cp.roadmap.yes", { v: cur?.published?.versionNumber ?? "" }), cur?.draft ? tr("s32ws.hs.cp.roadmap.draft") : tr("s32ws.hs.cp.roadmap.no")),
    row("results", tr("s32ws.hs.cp.results"), (cur?.results.length ?? 0) > 0, cur?.results.length === 1 ? tr("s32ws.hs.cp.results.one") : tr("s32ws.hs.cp.results.many", { n: cur?.results.length ?? 0 }), tr("s32ws.hs.cp.results.no")),
    row("graduation", tr("s32ws.hs.cp.graduation"), cur?.graduation.status === "diploma_conferred", tr("s32ws.hs.cp.graduation.yes"), cur ? tr("s32ws.hs.cp.graduation.status", { status: fileStatusText(cur.graduation.status, tr) }) : tr("s32ws.hs.cp.graduation.none")),
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
  agreement?: ProgramAgreementView | null;
}

/** High-school overview: pure, server-renderable. Needs attention first, then where the student stands. */
export function StudentFileHsOverview({ studentId, student, state, profile, attention, onTab, documents, billing, agreement }: HsOverviewProps) {
  const { t, language, formatCredits } = useT();
  const cur = state.current;
  const href = `/admin/students/${encodeURIComponent(studentId)}/high-school`;
  if (!cur) {
    return <div className="space-y-5" data-testid="student-file-hs-overview">
      <Attention rows={attention} onTab={onTab} />
      <StaffCard as="div" tone="gold" className="space-y-3" data-testid="hs-no-program">
        <p className={staffLabel}>{t("s32ws.hs.programLabel")}</p>
        <p className="font-serif text-xl text-student-ink">{t("s32ws.hs.noProgramTitle")}</p>
        <p className="max-w-2xl text-sm text-student-muted">{t("s32ws.hs.noProgramBody")}</p>
        <Link href={href} className={`${staffBtn.primary} inline-flex items-center justify-center`} data-testid="link-open-hs-pathway">{t("s32ws.dp.program.title")}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
      </StaffCard>
    </div>;
  }
  const { enrollment, credits } = cur;
  const courses = plannedCourses(state);
  const planned = plannedHalfUnits(state);
  const checkpoints = enrollmentCheckpoints({ student, state, profile }, t);
  const doneCount = checkpoints.filter((c) => c.done).length;
  return <div className="space-y-6" data-testid="student-file-hs-overview">
    <Attention rows={attention} onTab={onTab} />
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <StaffCard as="div" className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0"><p className={staffLabel}>{t("s32ws.hs.programLabel")}</p><p className="mt-2 break-words font-serif text-xl leading-snug text-student-ink" data-testid="hs-program-title">{enrollment.programTitle}</p></div>
          <StaffPill tone={enrollment.status === "active" || enrollment.status === "completed" ? "seal" : "neutral"}>{fileStatusText(enrollment.status, t)}</StaffPill>
        </div>
        <dl className="grid grid-cols-2 gap-4 text-sm"><div><dt className={staffLabel}>{t("s32ws.hs.start")}</dt><dd className="mt-1">{fileDate(enrollment.startedOn, language)}</dd></div><div><dt className={staffLabel}>{t("s32ws.hs.target")}</dt><dd className="mt-1">{fileDate(enrollment.targetCompletionDate, language)}</dd><dd className="text-xs text-student-muted">{t("s32ws.hs.targetNote")}</dd></div></dl>
        <Link href={href} className={LINK} data-testid="link-open-hs-pathway">{t("s32ws.hs.openPathway")}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
      </StaffCard>
      <section aria-label={t("s32ws.hs.credits")} data-testid="hs-credit-summary">
        <StaffCard as="div" className="h-full">
          <StaffSectionHeader level={3} icon={<GraduationCap className="h-5 w-5" />} title={t("s32ws.hs.credits")} description={t("s32ws.hs.creditsDesc")} className="mb-3" />
          <dl className="grid grid-cols-2 gap-4">
            <Stat label={t("s32ws.hs.planned")} value={formatCredits(planned)} hint={t(`s32ws.hs.plannedHint.${isDraftPlan(state) ? "draft" : "pub"}.${courses.length === 1 ? "one" : "many"}`, { n: courses.length })} />
            <Stat label={t("s32ws.hs.earned")} value={formatCredits(credits.earnedHalfUnits)} hint={t("s32ws.hs.earnedHint", { req: formatCredits(credits.requiredHalfUnits) })} />
            <Stat label={t("s32ws.hs.awaiting")} value={formatCredits(credits.awaitingConfirmationHalfUnits)} hint={t("s32ws.hs.awaitingHint")} />
            <Stat label={t("s32ws.hs.queue")} value={String(cur.reviewQueue.length)} hint={cur.reviewQueue.length ? t("s32ws.hs.queueHint.some") : t("s32ws.hs.queueHint.none")} />
          </dl>
          <p className="mt-4 text-sm text-student-muted" data-testid="hs-core-elective">{t("s32ws.hs.coreElective", { coreE: formatCredits(credits.core.earnedHalfUnits), coreR: formatCredits(credits.core.requiredHalfUnits), elE: formatCredits(credits.elective.earnedHalfUnits), elR: formatCredits(credits.elective.requiredHalfUnits) })}</p>
        </StaffCard>
      </section>
    </div>

    <div className="grid gap-5 lg:grid-cols-2">
      <section aria-label={t("s32ws.hs.cp.aria")} className="space-y-3" data-testid="hs-checkpoints">
        <StaffSectionHeader level={3} icon={<CheckCircle2 className="h-5 w-5" />} title={t("s32ws.hs.cp.title")} description={t("s32ws.hs.cp.desc", { done: doneCount, total: checkpoints.length })} className="mb-0" />
        <StaffCard as="div" padded={false}><ul className="divide-y divide-student-line">
          {checkpoints.map((c) => <li key={c.key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" data-testid={`checkpoint-${c.key}`}>
            <div className="min-w-0"><p className="font-medium text-student-ink">{c.label}</p><p className="text-sm text-student-muted">{c.detail}</p></div>
            <StaffPill tone={c.done ? "seal" : "dashed"} icon={c.done ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <CircleDashed className="h-3.5 w-3.5" aria-hidden="true" />}>{c.done ? t("s32ws.hs.done") : t("s32ws.hs.pending")}</StaffPill>
          </li>)}
        </ul></StaffCard>
      </section>
      <section aria-label={t("s32ws.hs.gates.aria")} className="space-y-3" data-testid="hs-contract-gates">
        <StaffSectionHeader level={3} icon={<ShieldCheck className="h-5 w-5" />} title={t("s32ws.hs.gates.title")} description={t("s32ws.hs.gates.desc")} className="mb-0" />
        <StaffCard as="div" padded={false}><ul className="divide-y divide-student-line">
          {contractGates({ state, documents, billing, agreement }, t).map((g) => <li key={g.key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" data-testid={`gate-${g.key}`}>
            <div className="min-w-0"><p className="font-medium text-student-ink">{g.label}</p><p className="text-sm text-student-muted">{g.detail}</p></div>
            <StaffPill tone={g.status === "done" ? "seal" : g.status === "pending" ? "attention" : "dashed"}>{g.status === "done" ? t("s32ws.hs.done") : g.status === "pending" ? t("s32ws.hs.pending") : t("s32ws.hs.dateNotSet")}</StaffPill>
          </li>)}
        </ul></StaffCard>
      </section>
    </div>
    <StudentPortalAccountCard studentId={studentId} />
  </div>;
}

/** Academics: the course roadmap grouped core / electives, with a way into the full pathway. */
export function StudentFileHsAcademics({ studentId, state }: { studentId: string; state: StaffHighSchoolState }) {
  const { t, language, formatCredits } = useT();
  const cur = state.current;
  const href = `/admin/students/${encodeURIComponent(studentId)}/high-school`;
  if (!cur) {
    return <StaffNotice tone="gold" role="status" action={<Link href={href} className={`${staffBtn.primary} inline-flex items-center justify-center`} data-testid="link-open-hs-pathway">{t("s32ws.hs.ac.setup")}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>}>{t("s32ws.hs.ac.noCourses")}</StaffNotice>;
  }
  const courses = plannedCourses(state);
  const areas = (cur.published?.content ?? cur.draft?.content)?.areas ?? [];
  const isElective = (c: HsPlanCourse) => areas.find((a) => a.key === c.areaKey)?.kind === "elective" || c.areaKey === "electives";
  const core = courses.filter((c) => !isElective(c));
  const electives = courses.filter(isElective);
  const group = (title: string, list: readonly HsPlanCourse[], testId: string) => (
    <section aria-label={title} className="space-y-3" data-testid={testId}>
      <StaffSectionHeader level={3} title={title} description={t(list.length === 1 ? "s32ws.hs.ac.group.one" : "s32ws.hs.ac.group.many", { n: list.length, credits: formatCredits(list.reduce((n, c) => n + c.halfUnits, 0)) })} className="mb-0" />
      {list.length === 0 ? <StaffNotice tone="gold" role="status">{t("s32ws.hs.ac.noneYet")}</StaffNotice> : <ul className="grid gap-3 md:grid-cols-2" data-testid={testId === "hs-core" ? "hs-course-list" : undefined}>
        {list.map((c) => {
          const official = cur.results.some((r) => r.courseKey === c.key && r.taskKey === null);
          return <li key={c.key}><StaffCard as="div" className="space-y-1 !p-3.5">
            <div className="flex flex-wrap items-start justify-between gap-2"><p className="min-w-0 break-words font-medium text-student-ink">{c.title}</p>
              <div className="flex flex-wrap gap-1.5">{isTestOnlyTitle(c.title) ? <StaffPill tone="attention">{t("s32ws.hs.ac.approval")}</StaffPill> : null}<StaffPill tone={official ? "seal" : "neutral"}>{official ? t("s32ws.hs.ac.resultRecorded") : t("s32ws.hs.ac.planned")}</StaffPill></div></div>
            <p className="text-sm text-student-muted">{t((language === "fr" ? c.halfUnits <= 2 : c.halfUnits === 2) ? "s32ws.hs.ac.credit.one" : "s32ws.hs.ac.credit.many", { n: formatCredits(c.halfUnits) })} · {c.plannedStart || c.plannedEnd ? t("s32ws.hs.ac.window", { start: fileDate(c.plannedStart, language), end: fileDate(c.plannedEnd, language) }) : coursePhase(c, t) ?? t("s32ws.hs.ac.noWindow")}</p>
          </StaffCard></li>;
        })}
      </ul>}
    </section>
  );
  return <div className="space-y-6" data-testid="student-file-hs-academics">
    <StaffSectionHeader icon={<GraduationCap className="h-5 w-5" />} title={t("s32ws.hs.ac.title")} description={cur.published ? t("s32ws.hs.ac.published", { v: cur.published.versionNumber }) : cur.draft ? t("s32ws.hs.ac.draft") : t("s32ws.hs.ac.nopub")}
      actions={<Link href={href} className={LINK} data-testid="link-open-hs-pathway">{t("s32ws.hs.ac.openPathway")}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>} className="mb-0" />
    {courses.length === 0 ? <StaffNotice tone="gold" role="status">{t("s32ws.hs.ac.noPlanned")}</StaffNotice> : <>
      {group(t("s32ws.hs.ac.core"), core, "hs-core")}
      {group(t("s32ws.hs.ac.electives"), electives, "hs-electives")}
    </>}
  </div>;
}

function Attention({ rows, onTab }: { rows: HsOverviewProps["attention"]; onTab?: (tab: FileTab) => void }) {
  const { t } = useT();
  const total = rows.reduce((n, r) => n + r.count, 0);
  const waiting = rows.filter((r) => r.count > 0);
  const clear = rows.filter((r) => r.count === 0);
  return <section aria-label={t("s32ws.hs.att.title")} className="space-y-3" data-testid="student-file-attention">
    <StaffSectionHeader level={3} title={t("s32ws.hs.att.title")} description={total ? t(total === 1 ? "s32ws.hs.att.some.one" : "s32ws.hs.att.some.many", { n: total }) : t("s32ws.hs.att.none")} className="mb-0" />
    {waiting.length ? <StaffCard as="div" padded={false} tone="attention"><ul className="divide-y divide-student-line">
      {waiting.map((r) => <li key={r.label} className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0"><p className="font-medium text-student-ink">{r.label}</p><p className="text-sm text-student-muted">{r.detail}</p></div>
        {onTab ? <Button type="button" size="sm" variant="outline" className={`${staffBtn.outline} shrink-0`} aria-label={t("s32ws.sh.reviewLbl", { what: r.label })} onClick={() => onTab(r.tab)}>{t("s32ws.sh.review")}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Button> : null}
      </li>)}
    </ul></StaffCard> : null}
    {clear.length ? <p className="flex items-start gap-2 text-sm text-student-muted"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-student-gold-ink" aria-hidden="true" /><span>{t("s32ws.hs.att.clear", { list: clear.map((r) => r.label.toLowerCase()).join(", ") })}</span></p> : null}
  </section>;
}

export function StudentFileSupport({ studentId, tickets, loading, error, onRetry }: { studentId: string; tickets: readonly Ticket[]; loading?: boolean; error?: boolean; onRetry?: () => void }) {
  const { t, language } = useT();
  return <section id="workspace-support" aria-labelledby="workspace-support-heading" className="space-y-4">
    <StaffSectionHeader id="workspace-support-heading" icon={<LifeBuoy className="h-5 w-5" />} title={t("s32ws.sh.support.title")} description={t("s32ws.hs.sup.desc")} actions={<Link href={`/support?studentId=${encodeURIComponent(studentId)}`} className={LINK}>{t("s32ws.sh.support.open")}</Link>} />
    {loading ? <div role="status" className="rounded-md border p-6 text-center text-sm text-student-muted">{t("s32ws.sh.loading")}</div>
      : error ? <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm"><p>{t("s32ws.hs.sup.error")}</p>{onRetry ? <Button className="mt-3" type="button" size="sm" variant="outline" onClick={onRetry}>{t("s32ws.sh.retry")}</Button> : null}</div>
      : tickets.length === 0 ? <StaffNotice tone="gold" role="status">{t("s32ws.hs.sup.empty")}</StaffNotice>
      : <ul className="space-y-3">{tickets.map((ticket) => <li key={ticket.id}><StaffCard as="div" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="min-w-0 break-words font-medium text-student-ink">{ticket.subject}</p><div className="flex flex-wrap gap-2"><StatusPill status={ticketStatusKey(ticket.status)} label={ticketStatusText(ticket.status, language, t)} /><StaffPill tone={ticket.priority === "urgent" ? "urgent-solid" : ticket.priority === "high" ? "attention" : "neutral"}>{tokenLabel(ticket.priority, t) ?? workspaceToken(ticket.priority) ?? ticket.priority}</StaffPill></div></div>
        <p className="text-sm text-student-muted">{ticket.ticket_number} · {ticketTopicText(ticket, language)}</p>
        {formatWorkspaceDateTime(ticket.created_at, undefined, language) ? <p className="text-xs text-student-muted">{t("s32ws.sh.support.opened", { date: formatWorkspaceDateTime(ticket.created_at, undefined, language) ?? "" })}</p> : null}
        <Link href={`/support?studentId=${encodeURIComponent(studentId)}&ticket=${encodeURIComponent(ticket.id)}`} className="inline-flex min-h-10 items-center text-sm font-semibold text-student-gold-ink underline-offset-4 hover:underline" data-testid="link-workspace-ticket">{t("s32ws.sh.support.conversation")}</Link>
      </StaffCard></li>)}</ul>}
  </section>;
}

export function studentDisplayName(s: StudentFileRecord, tr: WsTr = enTr): string {
  const first = s.preferred_name || s.first_name || "";
  const full = [first, s.last_name].filter(Boolean).join(" ").trim();
  return full || s.email || s.student_code || tr("s32ws.hs.studentFallback");
}

/** Full student file for a student without a university workspace. */
export default function StudentFileHs({ studentId, student }: { studentId: string; student: StudentFileRecord }) {
  const { user } = useAuth();
  const { t, language } = useT();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "admin";
  const [tab, setTab] = useHashTab(STUDENT_FILE_TABS, "overview", TAB_ALIASES);
  const [photoOpen, setPhotoOpen] = useState(false);
  const hs = useHsState(studentId);
  const documentsQuery = useDocuments(studentId);
  const billingQuery = useStaffBilling(studentId);
  const agreementQuery = useAgreement(studentId);
  const ticketsQuery = useTickets({ studentId });
  const { profileQuery } = useStaffProfileData(studentId);
  const record = useQuery<StudentFileRecord>({ queryKey: [`/api/students/${encodeURIComponent(studentId)}`], initialData: student });
  const experience = useExperienceAction(studentId);
  const current = record.data ?? student;
  const name = studentDisplayName(current, t);
  const profile = profileQuery.data;
  const profileCount = profile ? profileDecisionCount(profile) : 0;
  const docsPending = (documentsQuery.data ?? []).filter((d: StudentDocument) => documentNeedsReview(d.status)).length;
  const tickets = ticketsQuery.data?.tickets ?? [];
  const supportAwaiting = tickets.filter((x) => awaitingFor(x.status) === "staff").length;
  const activeTab: FileTab = tab === "ai" && !isAdmin ? "overview" : tab;
  const demo = isDemoStudent({ first_name: current.first_name ?? "", last_name: current.last_name ?? "", preferred_name: current.preferred_name, email: current.email });
  const programTitle = hs.data?.current?.enrollment.programTitle;
  const tabs: StaffTab[] = [
    { key: "overview", label: t("s32ws.sh.tab.overview"), icon: <LayoutDashboard className="h-4 w-4" /> },
    { key: "academics", label: t("s32ws.sh.tab.academics"), icon: <GraduationCap className="h-4 w-4" /> },
    { key: "documents", label: t("s32ws.sh.tab.documents"), icon: <FileText className="h-4 w-4" />, count: docsPending, countLabel: t("s32ws.sh.cnt.review") },
    { key: "billing", label: t("s32ws.sh.tab.billing"), icon: <CreditCard className="h-4 w-4" /> },
    { key: "support", label: t("s32ws.sh.tab.support"), icon: <LifeBuoy className="h-4 w-4" />, count: supportAwaiting, countLabel: t("s32ws.sh.cnt.response") },
    { key: "profile", label: t("s32ws.sh.tab.profile"), icon: <Fingerprint className="h-4 w-4" />, count: profileCount, countLabel: t("s32ws.sh.cnt.decisions") },
    ...(isAdmin ? [{ key: "activity", label: t("s32ws.sh.tab.activity"), icon: <Activity className="h-4 w-4" /> }, { key: "ai", label: t("s32ws.sh.tab.ai"), icon: <BrainCircuit className="h-4 w-4" /> }] : []),
  ];
  const attention = [
    { label: t("s32ws.sh.att.profile"), count: profileCount, detail: t("s32ws.sh.att.profileDetail", { n: profileCount }), none: t("s32ws.sh.att.profileNone"), tab: "profile" as const },
    { label: t("s32ws.sh.att.docs"), count: docsPending, detail: t("s32ws.sh.att.docsDetail", { n: docsPending }), none: t("s32ws.sh.att.docsNone"), tab: "documents" as const },
    { label: t("s32ws.sh.att.support"), count: supportAwaiting, detail: t("s32ws.sh.att.supportDetail", { n: supportAwaiting }), none: t("s32ws.sh.att.supportNone"), tab: "support" as const },
    { label: t("s32ws.hs.att.hsReports"), count: hs.data?.current?.reviewQueue.length ?? 0, detail: t("s32ws.hs.att.hsReportsDetail", { n: hs.data?.current?.reviewQueue.length ?? 0 }), none: t("s32ws.hs.att.hsReportsNone"), tab: "academics" as const },
  ];
  const step = nextStep({
    status: current.status, profileDecisions: profileCount, docsPending, supportAwaiting,
    hasProgram: hs.data ? !!hs.data.current : undefined,
    billingConfigured: billingQuery.data ? billingQuery.data.student.state === "configured" : undefined,
    canActivate: canActivateLeadForRole(user?.role, current.status),
  }, studentId, t);
  const identity = { studentId, firstName: profile?.identity.firstName ?? current.first_name, lastName: profile?.identity.lastName ?? current.last_name, name, photoUrl: profile?.identity.photoUrl };

  return <StaffPage testId="admin-student-workspace">
    <StaffFileHeader
      testId="student-file-header"
      back={<span className="flex flex-wrap items-center gap-x-5 gap-y-1">
        {/* S32-B (SA-09): this older layout lives inside the Advanced Workspace; the way back is the Student File. */}
        <Link href={studentFilePath(studentId)} className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-student-gold-ink underline-offset-4 hover:underline" data-testid="link-back-to-file"><ArrowLeft className="h-4 w-4" aria-hidden="true" />{t("s32.ws.backToFile")}</Link>
        <Link href="/admin/students" className="inline-flex min-h-10 items-center text-sm font-medium text-student-muted underline-offset-4 hover:underline">{t("s32.ws.backToStudents")}</Link>
      </span>}
      eyebrow={t("s32.ws.eyebrow")}
      portrait={<AccountAvatar identity={identity} className="h-16 w-16 shrink-0 text-xl ring-2 ring-student-gold/50 sm:h-20 sm:w-20 sm:text-2xl" />}
      title={name}
      description={<>{current.email ?? profile?.contact.email ?? t("s32ws.sh.emailNone")} · <span className="font-mono">{current.student_code ?? profile?.identity.studentCode ?? t("s32ws.sh.codeNone")}</span></>}
      meta={<div className="flex flex-wrap items-center gap-2">
        <StaffPill tone="seal">{studentStatusText(current.status, t)}</StaffPill>
        {demo ? <DemoPill /> : null}
        <StaffPill tone="neutral" icon={<GraduationCap className="h-3.5 w-3.5" aria-hidden="true" />}>{programTitle ? shortProgram(programTitle) : hs.data ? t("s32ws.hs.noProgramYet") : t("s32ws.hs.loadingProgram")}</StaffPill>
      </div>}
      actions={<>
        <ViewAsStudentLink studentId={studentId} />
        {canActivateLeadForRole(user?.role, current.status) ? <ActivateStudentButton studentId={studentId} studentName={name} className={staffBtn.seal} onActivated={() => record.refetch()} /> : null}
        <Button type="button" variant="outline" size="sm" className={staffBtn.outline} onClick={() => setPhotoOpen(true)} data-testid="button-student-photo">{t("staff.photo.button")}</Button>
        {isAdmin ? <Link href={`/admin/assistant?studentId=${encodeURIComponent(studentId)}`} className={LINK} data-testid="link-student-ai"><BrainCircuit className="h-4 w-4" aria-hidden="true" />{t("s32ws.sh.askAi")}</Link> : null}
      </>}
    />
    <ExperienceError action={experience} />
    {demo ? <StaffNotice tone="attention" role="status">{t("s32ws.sh.demo")}</StaffNotice> : null}
    <NextStepBanner step={step} onTab={(k) => setTab(k as FileTab)} experience={experience} />
    <PhotoDialog
      open={photoOpen}
      onOpenChange={setPhotoOpen}
      identity={identity}
      title={t("staff.photo.title")}
      description={t("staff.photo.desc")}
      onChanged={() => { void queryClient.invalidateQueries({ queryKey: STAFF_PROFILE_QUERY_KEY(studentId) }); }}
    />
    <StaffTabList tabs={tabs} active={activeTab} onChange={(key) => setTab(key as FileTab)} label={t("s32ws.hs.sections")} idPrefix="ws" />

    <StaffTabPanel idPrefix="ws" tabKey="overview" active={activeTab === "overview"}>
      <div id="workspace-overview" aria-label={t("s32ws.sh.tab.overview")}>
        {hs.isLoading ? <div role="status" className="rounded-md border p-6 text-center text-sm text-student-muted">{t("s32ws.hs.loadingHs")}</div>
          : hs.isError || !hs.data ? <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm"><p>{t("s32ws.hs.hsError")}</p><Button className="mt-3" type="button" size="sm" variant="outline" onClick={() => void hs.refetch()}>{t("s32ws.sh.retry")}</Button></div>
          : <StudentFileHsOverview studentId={studentId} student={current} state={hs.data} profile={profile} attention={attention} onTab={setTab} documents={documentsQuery.data} billing={billingQuery.data} billingLoading={billingQuery.isLoading} billingError={billingQuery.isError} agreement={agreementQuery.isSuccess ? agreementQuery.data : undefined} />}
      </div>
    </StaffTabPanel>
    <StaffTabPanel idPrefix="ws" tabKey="academics" active={activeTab === "academics"}>
      {hs.isLoading ? <div role="status" className="rounded-md border p-6 text-center text-sm text-student-muted">{t("s32ws.hs.loadingCourses")}</div>
        : hs.data ? <StudentFileHsAcademics studentId={studentId} state={hs.data} />
        : <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm"><p>{t("s32ws.hs.coursesError")}</p><Button className="mt-3" type="button" size="sm" variant="outline" onClick={() => void hs.refetch()}>{t("s32ws.sh.retry")}</Button></div>}
    </StaffTabPanel>
    <StaffTabPanel idPrefix="ws" tabKey="documents" active={activeTab === "documents"}>
      <section id="workspace-documents" aria-labelledby="workspace-documents-heading" className="space-y-4">
        <StaffSectionHeader id="workspace-documents-heading" icon={<FileText className="h-5 w-5" />} title={t("s32ws.sh.docs.title")} description={t("s32ws.sh.docs.desc")} />
        {documentsQuery.isLoading ? <div role="status" className="rounded-md border p-6 text-center text-sm text-student-muted">{t("s32ws.sh.loading")}</div>
          : documentsQuery.isError ? <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm"><p>{t("s32ws.hs.docsError")}</p><Button className="mt-3" type="button" size="sm" variant="outline" onClick={() => void documentsQuery.refetch()}>{t("s32ws.sh.retry")}</Button></div>
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
