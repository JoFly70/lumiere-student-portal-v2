import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useParams, Link } from "wouter";
import { Activity, AlertCircle, ArrowLeft, BrainCircuit, ArrowRight, ChevronDown, CreditCard, Database, FileCheck2, FileText, Fingerprint, GraduationCap, LayoutDashboard, LifeBuoy, RefreshCw, Route } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  StaffCard,
  StaffNotice,
  StaffPage,
  StaffFileHeader,
  StaffPill,
  StaffSectionHeader,
  StaffTabList,
  StaffTabPanel,
  StatusPill,
  staffBtn,
  staffLabel,
  useHashTab,
  type StaffTab,
} from "@/components/staff/staff-ui";
import { ticketStatusKey } from "@/components/support/support-presentation";
import {
  PlacementActionDialog,
  type PlacementActionFeedback,
} from "@/components/placement-action-dialog";
import {
  ADMIN_STUDENT_WORKSPACE_QUERY_KEY,
  ADMIN_STUDENT_WORKSPACE_QUERY_OPTIONS,
  ADMIN_STUDENTS_PATH,
  attentionItemLabel,
  attentionItemStatus,
  diagnosticItemStatus,
  isDiagnosticAttentionItem,
  selectWorkspaceState,
  academicCreditRows,
  creditRecordStanding,
  creditRecordStandingCounts,
  documentNeedsReview,
  tokenLabel,
  resolveWorkspaceStudentIdentity,
  workspaceStudentIdFromData,
  formatWorkspaceDateTime,
  workspaceProgressStatusLabel,
  workspaceToken,
  type WsTr,
  type WorkspaceAttentionItem,
  type WorkspaceRecord,
} from "./admin-student-workspace-presentation";
import {
  canCreatePlacement,
  canRevokePlacement,
  canSupersedePlacement,
  canonicalLabelOptions,
  placementWritesEnabled,
  placementRequirementLabel,
  validSnapshotFingerprint,
} from "./controlled-placement-workflow";
import { StudentDocumentsReview } from "@/components/admin/student-documents-review";
import StudentFileHs, { fileDate, studentStatusText, ticketStatusText, ticketTopicText, type StudentFileRecord } from "@/components/admin/student-file-hs";
import { OwnerAssistantPanel } from "@/components/owner-assistant/owner-assistant-panel";
import { StudentPortalAccountCard, errorMessage } from "@/components/admin/student-portal-account-card";
import StudentProfileReview, { useStaffProfileData } from "@/components/admin/student-profile-review";
import { STAFF_PROFILE_QUERY_KEY } from "@/components/admin/student-profile-review-logic";
import { AccountAvatar, PhotoDialog } from "@/components/os/account-menu";
import { DossierActivity, DossierBilling, ExperienceButton, ExperienceError, NextStepBanner, ViewAsStudentLink, nextStep, useExperienceAction } from "@/components/admin/dossier/dossier-parts";
import { DemoPill, isDemoStudent, shortProgram, studentStatusLabel } from "@/components/admin/directory/directory-data";
import { useStaffBilling } from "@/lib/billing-queries";
import { useT } from "@/i18n";
import { profileDecisionCount } from "@/components/admin/student-profile-review-logic";
import { useDocuments } from "@/hooks/use-documents";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTickets, type Ticket } from "@/hooks/use-tickets";
import { SUPPORT_TOPIC_INFO, awaitingFor, staffStatusLabel, topicForTicket } from "@shared/support-contract";
import { canActivateLeadForRole } from "@/components/admin/student-documents-upload-logic";
import { ActivateStudentButton } from "@/components/admin/activate-student";
import { studentFilePath } from "@shared/staff-links";

const WORKSPACE_TABS = ["overview", "academics", "documents", "billing", "support", "profile", "activity", "ai"] as const;
type WorkspaceTab = typeof WORKSPACE_TABS[number];
/** Older anchors (#workspace-documents, ...) keep working as deep links. */
const WORKSPACE_TAB_ALIASES: Readonly<Record<string, WorkspaceTab>> = {
  "workspace-overview": "overview",
  "workspace-profile": "profile",
  "workspace-documents": "documents",
  "workspace-support": "support",
  guardian: "profile",
  guardians: "profile",
  "workspace-billing": "billing",
  "workspace-academics": "academics",
  courses: "academics",
};

function value(row: unknown, ...keys: string[]) {
  const record = row && typeof row === "object" && !Array.isArray(row) ? row as WorkspaceRecord : {};
  for (const key of keys) if (record[key] !== undefined && record[key] !== null && record[key] !== "") return String(record[key]);
  return NP;
}
/** The "Not provided" sentinel is only a marker for comparisons; it is translated where it is shown. */
const NP = "Not provided";
const show = (tr: WsTr, v: string): string => (v === NP ? tr("s32ws.ws.notProvided") : v);
function Evidence({ item }: { item: WorkspaceAttentionItem }) {
  const { t } = useT();
  return <details className="group border-t border-border/70 py-3">
    <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium">
      <span className="flex items-center gap-2"><ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />{t("s32ws.ws.evidence")}</span>
      <span className="font-mono text-[11px] text-muted-foreground">{item.requirementId ?? item.academicRuleId}</span>
    </summary>
    <pre className="mt-3 overflow-auto rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">{JSON.stringify({ reason: item.reason, evidence: item.evidence, provenance: item.provenance, requiredAmount: item.requiredAmount, appliedAmount: item.appliedAmount, remainingAmount: item.remainingAmount }, null, 2)}</pre>
  </details>;
}
function displayDate(value: unknown, language: "en" | "fr", tr: WsTr): string {
  return formatWorkspaceDateTime(value, undefined, language) ?? tr("s32ws.ws.dateNone");
}
/** Enum-ish record value as readable text; "Not provided" only when truly absent. */
/** Join only the parts that are actually recorded. */
function provided(...parts: string[]): string {
  return parts.filter((part) => part !== NP).join(" · ");
}
function humanValue(tr: WsTr, row: unknown, ...keys: string[]) {
  const raw = value(row, ...keys);
  return raw === NP ? raw : tokenLabel(raw, tr) ?? workspaceToken(raw) ?? raw;
}
function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="mt-1 text-sm">{children}</dd></div>;
}
function Reference({ value: reference }: { value: unknown }) {
  const { t } = useT();
  if (typeof reference !== "string" || !reference) return null;
  return <p className="mt-2 font-mono text-[11px] text-muted-foreground">{t("s32ws.ws.reference", { ref: reference })}</p>;
}
function InlinePlacementFeedback({ feedback }: { feedback?: PlacementActionFeedback }) {
  if (!feedback) return null;
  return <div
    role={feedback.kind === "error" ? "alert" : "status"}
    className={`mt-3 rounded-md border px-3 py-2 text-sm ${
      feedback.kind === "error"
        ? "border-destructive/40 bg-destructive/5 text-destructive"
        : "border-st-applied/30 bg-st-applied/5 text-st-applied"
    }`}
  >
    {feedback.message}
  </div>;
}
function WorkspaceResourceState({
  loading,
  error,
  empty,
  onRetry,
  children,
}: {
  loading?: boolean;
  error?: boolean;
  empty: boolean;
  onRetry: () => void;
  children: ReactNode;
}) {
  const { t } = useT();
  if (loading) return <div role="status" aria-live="polite" className="rounded-md border p-6 text-center text-sm text-muted-foreground">{t("s32ws.sh.loading")}</div>;
  if (error) return <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm"><p>{t("s32ws.ws.section.loadError")}</p><Button className="mt-3" type="button" size="sm" variant="outline" onClick={onRetry}><RefreshCw className="mr-2 h-4 w-4" />{t("s32ws.sh.retry")}</Button></div>;
  if (empty) return <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{t("s32ws.ws.section.empty")}</div>;
  return <>{children}</>;
}
export default function AdminStudentWorkspace() {
  const { studentId = "" } = useParams<{ studentId: string }>();
  const [snapshotUnavailable, setSnapshotUnavailable] = useState(false);
  const [placementFeedback, setPlacementFeedback] = useState<Record<string, PlacementActionFeedback>>({});
  const [activationFeedback, setActivationFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const query = useQuery({
    queryKey: ADMIN_STUDENT_WORKSPACE_QUERY_KEY(studentId),
    ...ADMIN_STUDENT_WORKSPACE_QUERY_OPTIONS,
  });
  const state = selectWorkspaceState(query);
  // New leads can exist before an academic assignment. Keep lifecycle actions
  // available without changing the canonical academic workspace's 404 contract.
  const unassignedStudent = useQuery<StudentFileRecord>({
    queryKey: [`/api/students/${encodeURIComponent(studentId)}`],
    enabled: state.kind === "empty" && state.reason === "not-found" && !!studentId,
  });
  // Route param only locates the workspace; every panel keys off the id of the
  // student record the workspace endpoint returned.
  const canonicalStudentId = workspaceStudentIdFromData(query.data) ?? null;
  const documentsQuery = useDocuments(canonicalStudentId);
  const ticketsQuery = useTickets({ studentId: canonicalStudentId });
  const billingQuery = useStaffBilling(canonicalStudentId ?? null);
  const { profileQuery } = useStaffProfileData(canonicalStudentId ?? "");
  const queryClient = useQueryClient();
  const { t, language } = useT();
  const { user } = useAuth();
  const [photoOpen, setPhotoOpen] = useState(false);
  const experience = useExperienceAction(canonicalStudentId ?? studentId);
  const [tab, setTab] = useHashTab(WORKSPACE_TABS, "overview", WORKSPACE_TAB_ALIASES);
  if (state.kind === "loading") return <div role={state.role} aria-live={state.ariaLive} className="space-y-4"><span className="sr-only">{t("s32ws.ws.loadingWs")}</span><div className="h-8 w-64 animate-pulse rounded bg-muted" /><div className="h-32 animate-pulse rounded-lg bg-muted" /><div className="h-64 animate-pulse rounded-lg bg-muted" /></div>;
  if (state.kind === "error") return <Card><CardContent className="flex flex-col items-center gap-3 py-16 text-center"><AlertCircle className="h-8 w-8 text-destructive" /><h2 className="text-lg font-semibold">{t("s32ws.ws.unavailable")}</h2><p className="text-sm text-muted-foreground">{t("s32ws.ws.unavailableBody")}</p><Button onClick={() => query.refetch()}><RefreshCw className="mr-2 h-4 w-4" />{t("s32ws.sh.retry")}</Button></CardContent></Card>;
  if (state.kind === "empty") {
    const student = unassignedStudent.data?.id === studentId ? unassignedStudent.data : undefined;
    // No university workspace (e.g. a high-school-only student): show the full student file.
    if (student) return <StudentFileHs studentId={studentId} student={student} />;
    return <Card><CardContent className="flex flex-col items-center gap-3 py-16 text-center"><h2 className="text-lg font-semibold">{state.reason === "not-found" ? t("s32ws.ws.notFound") : t("s32ws.ws.unavailable")}</h2><p className="text-sm text-muted-foreground">{unassignedStudent.isLoading ? t("s32ws.ws.loadingStatus") : state.reason === "not-found" ? t("s32ws.ws.noCanonical") : t("s32ws.ws.noRecord")}</p></CardContent></Card>;
  }
  const vm = state.viewModel;
  const snapshot = vm.snapshot && typeof vm.snapshot === "object" && !Array.isArray(vm.snapshot) ? vm.snapshot as WorkspaceRecord : {};
  const label = (kind: "programs" | "programVersions" | "requirements", id: unknown): string | undefined => {
    const labels = vm.labels[kind];
    if (!labels || typeof labels !== "object" || Array.isArray(labels) || typeof id !== "string") return undefined;
    const entry = (labels as Record<string, unknown>)[id];
    return entry && typeof entry === "object" && !Array.isArray(entry) && typeof (entry as WorkspaceRecord).label === "string"
      ? String((entry as WorkspaceRecord).label) : undefined;
  };
  const profileCount = profileQuery.data ? profileDecisionCount(profileQuery.data) : 0;
  const docsPending = (documentsQuery.data ?? []).filter((d) => documentNeedsReview(d.status)).length;
  const supportAwaiting = (ticketsQuery.data?.tickets ?? []).filter((t) => awaitingFor(t.status) === "staff").length;
  // One count for everything waiting on staff, so the tabs, this list and the page agree.
  const attentionTotal = profileCount + docsPending + supportAwaiting + vm.attention.total;
  const standingCounts = creditRecordStandingCounts(vm.academicDetail.creditRecords);
  const standingTotal = standingCounts.verified + standingCounts.waiting + standingCounts.not_accepted;
  const reviewButton = (label: string, onClick: () => void) => <Button type="button" size="sm" variant="outline" className={staffBtn.outline} aria-label={t("s32ws.sh.reviewAria", { what: label })} onClick={onClick}>{t("s32ws.sh.review")}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Button>;
  const attentionRows = [
    { key: "profile", label: t("s32ws.sh.att.profile"), count: profileCount, detail: t("s32ws.sh.att.profileDetail", { n: profileCount }), none: t("s32ws.sh.att.profileNone"), action: reviewButton(t("s32ws.ws.rev.profile"), () => setTab("profile")) },
    { key: "documents", label: t("s32ws.sh.att.docs"), count: docsPending, detail: t("s32ws.sh.att.docsDetail", { n: docsPending }), none: t("s32ws.sh.att.docsNone"), action: reviewButton(t("s32ws.ws.rev.documents"), () => setTab("documents")) },
    { key: "support", label: t("s32ws.sh.att.support"), count: supportAwaiting, detail: t("s32ws.sh.att.supportDetail", { n: supportAwaiting }), none: t("s32ws.sh.att.supportNone"), action: reviewButton(t("s32ws.ws.rev.support"), () => setTab("support")) },
    { key: "report", label: t("s32ws.ws.att.report"), count: vm.attention.total, detail: t("s32ws.ws.att.reportDetail", { n: vm.attention.total }), none: t("s32ws.ws.att.reportNone"), action: reviewButton(t("s32ws.ws.rev.report"), () => document.getElementById("workspace-report-review")?.scrollIntoView({ block: "start" })) },
  ];
  const tabs: StaffTab[] = [
    { key: "overview", label: t("s32ws.sh.tab.overview"), icon: <LayoutDashboard className="h-4 w-4" /> },
    { key: "academics", label: t("s32ws.sh.tab.academics"), icon: <GraduationCap className="h-4 w-4" />, count: vm.attention.total, countLabel: t("s32ws.ws.cnt.report") },
    { key: "documents", label: t("s32ws.sh.tab.documents"), icon: <FileText className="h-4 w-4" />, count: docsPending, countLabel: t("s32ws.sh.cnt.review") },
    { key: "billing", label: t("s32ws.sh.tab.billing"), icon: <CreditCard className="h-4 w-4" /> },
    { key: "support", label: t("s32ws.sh.tab.support"), icon: <LifeBuoy className="h-4 w-4" />, count: supportAwaiting, countLabel: t("s32ws.sh.cnt.response") },
    { key: "profile", label: t("s32ws.sh.tab.profile"), icon: <Fingerprint className="h-4 w-4" />, count: profileCount, countLabel: t("s32ws.sh.cnt.decisions") },
    ...(user?.role === "admin" ? [{ key: "activity", label: t("s32ws.sh.tab.activity"), icon: <Activity className="h-4 w-4" /> }, { key: "ai", label: t("s32ws.sh.tab.ai"), icon: <BrainCircuit className="h-4 w-4" /> }] : []),
  ];
  const activeTab = tab === "ai" && user?.role !== "admin" ? "overview" : tab;
  const identity = resolveWorkspaceStudentIdentity(vm.student, t);
  const demo = isDemoStudent({ first_name: value(vm.student, "firstName", "first_name") === NP ? identity.name : value(vm.student, "firstName", "first_name"), last_name: value(vm.student, "lastName", "last_name") === NP ? "" : value(vm.student, "lastName", "last_name"), preferred_name: value(vm.student, "preferredName", "preferred_name") === NP ? null : value(vm.student, "preferredName", "preferred_name"), email: identity.email });
  const name = identity.name;
  const placementStudentId = identity.id;
  const academicRows = academicCreditRows(vm.academicDetail);
  const snapshotFingerprint = validSnapshotFingerprint(vm.snapshotFingerprint)
    ? vm.snapshotFingerprint
    : validSnapshotFingerprint(snapshot.fingerprint)
      ? snapshot.fingerprint
      : undefined;
  const programName = label("programs", value(vm.program, "id")) ?? value(vm.program, "name", "code");
  const programVersionName = label("programVersions", value(vm.programVersion, "id")) ?? value(vm.programVersion, "versionLabel", "id");
  const requirementOptions = canonicalLabelOptions(vm.labels.requirements);
  const academicRuleOptions = canonicalLabelOptions(vm.labels.academicRules);
  const studentStatus = value(vm.student, "status").toLowerCase();
  const canActivateLead = canActivateLeadForRole(user?.role, studentStatus);
  const step = nextStep({
    status: studentStatus, profileDecisions: profileCount, docsPending, supportAwaiting: supportAwaiting,
    hasProgram: programName !== NP ? true : undefined,
    billingConfigured: billingQuery.data ? billingQuery.data.student.state === "configured" : undefined,
    canActivate: canActivateLead,
  }, studentId, t);
  const writesDisabled = !placementStudentId || !placementWritesEnabled(
    snapshotFingerprint,
    snapshotUnavailable,
    query.isFetching,
  );
  const writesDisabledReason = !snapshotFingerprint
    ? t("s32ws.ws.pl.noSnapshot")
    : snapshotUnavailable
      ? t("s32ws.ws.pl.unavailable")
      : query.isFetching
        ? t("s32ws.ws.pl.refreshing")
        : undefined;
  const refreshCanonical = async (): Promise<boolean> => {
    const refreshed = await query.refetch();
    const refreshedState = selectWorkspaceState(refreshed);
    if (refreshedState.kind !== "ready") return false;
    const refreshedSnapshot = refreshedState.viewModel.snapshot;
    const refreshedSnapshotRecord = refreshedSnapshot
      && typeof refreshedSnapshot === "object"
      && !Array.isArray(refreshedSnapshot)
      ? refreshedSnapshot as WorkspaceRecord
      : {};
    const hasValidFingerprint = validSnapshotFingerprint(
      refreshedState.viewModel.snapshotFingerprint,
    ) || validSnapshotFingerprint(refreshedSnapshotRecord.fingerprint);
    if (hasValidFingerprint) setSnapshotUnavailable(false);
    return hasValidFingerprint;
  };
  const placementLabel = (placement: WorkspaceRecord) => {
    return placementRequirementLabel(placement, vm.labels);
  };
  return <StaffPage testId="admin-student-workspace">
    <StaffFileHeader
      testId="student-file-header"
      back={<span className="flex flex-wrap items-center gap-x-5 gap-y-1">
        {/* S32-B (SA-09): the way back to the primary Student File, then the directory. */}
        <Link href={studentFilePath(studentId)} className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-student-gold-ink underline-offset-4 hover:underline" data-testid="link-back-to-file"><ArrowLeft className="h-4 w-4" aria-hidden="true" />{t("s32.ws.backToFile")}</Link>
        <Link href={ADMIN_STUDENTS_PATH} className="inline-flex min-h-10 items-center text-sm font-medium text-student-muted underline-offset-4 hover:underline">{t("s32.ws.backToStudents")}</Link>
      </span>}
      eyebrow={t("s32.ws.eyebrow")}
      portrait={<AccountAvatar identity={{ studentId: identity.id, firstName: profileQuery.data?.identity.firstName, lastName: profileQuery.data?.identity.lastName, name, email: identity.email, photoUrl: profileQuery.data?.identity.photoUrl }} className="h-16 w-16 shrink-0 text-xl ring-2 ring-student-gold/50 sm:h-20 sm:w-20 sm:text-2xl" />}
      title={name}
      description={<>{identity.email ?? t("s32ws.sh.emailNone")} · <span className="font-mono">{identity.studentCode ?? t("s32ws.sh.codeNone")}</span></>}
      meta={<div className="flex flex-wrap items-center gap-2">
        <StaffPill tone="seal">{studentStatusText(studentStatus, t)}</StaffPill>
        {demo ? <DemoPill /> : null}
        <StaffPill tone="neutral" icon={<GraduationCap className="h-3.5 w-3.5" aria-hidden="true" />}>{programName === NP ? t("s32ws.sh.noProgram") : shortProgram(programName)}</StaffPill>
      </div>}
      actions={<>
        <ViewAsStudentLink studentId={studentId} />
        {canActivateLead && canonicalStudentId ? <ActivateStudentButton studentId={canonicalStudentId} studentName={name} className={staffBtn.seal} onActivated={async () => {
          const refreshed = unassignedStudent.data?.id === studentId ? await unassignedStudent.refetch() : await query.refetch();
          setActivationFeedback(refreshed.isError ? { kind: "error", message: t("s32.ws.refreshFailed") } : null);
        }} /> : null}
        <Button type="button" variant="outline" size="sm" className={staffBtn.outline} onClick={() => setPhotoOpen(true)} data-testid="button-student-photo">{t("staff.photo.button")}</Button>
        <Link href={`/admin/students/${encodeURIComponent(studentId)}/roadmap`} className={`${staffBtn.outline} inline-flex items-center justify-center border`} data-testid="link-student-roadmap"><Route className="h-4 w-4" aria-hidden="true" />{t("s32ws.ws.roadmap")}</Link>
        {user?.role === "admin" && canonicalStudentId ? <Link href={`/admin/assistant?studentId=${encodeURIComponent(canonicalStudentId)}`} className={`${staffBtn.outline} inline-flex items-center justify-center border`} data-testid="link-student-ai"><BrainCircuit className="h-4 w-4" aria-hidden="true" />{t("s32ws.sh.askAi")}</Link> : null}
      </>}
    />
    <ExperienceError action={experience} />
    {demo ? <StaffNotice tone="attention" role="status">{t("s32ws.sh.demo")}</StaffNotice> : null}
    {activationFeedback ? <StaffNotice tone={activationFeedback.kind === "error" ? "urgent" : "gold"} role={activationFeedback.kind === "error" ? "alert" : "status"}>{activationFeedback.message}</StaffNotice> : null}
    {identity.id ? <PhotoDialog
      open={photoOpen}
      onOpenChange={setPhotoOpen}
      identity={{ studentId: identity.id, firstName: profileQuery.data?.identity.firstName, lastName: profileQuery.data?.identity.lastName, name, photoUrl: profileQuery.data?.identity.photoUrl }}
      title={t("staff.photo.title")}
      description={t("staff.photo.desc")}
      onChanged={() => {
        void queryClient.invalidateQueries({ queryKey: STAFF_PROFILE_QUERY_KEY(identity.id!) });
        void queryClient.invalidateQueries({ queryKey: ADMIN_STUDENT_WORKSPACE_QUERY_KEY(studentId) });
      }}
    /> : null}
    <NextStepBanner step={step} onTab={(k) => setTab(k as WorkspaceTab)} experience={experience} />
    <StaffTabList tabs={tabs} active={activeTab} onChange={(key) => setTab(key as WorkspaceTab)} label={t("s32ws.ws.sections")} idPrefix="ws" />

    <StaffTabPanel idPrefix="ws" tabKey="overview" active={activeTab === "overview"}>
    <div id="workspace-overview" aria-label={t("s32ws.ws.overview")} className="space-y-6">
    <section className="grid gap-4 md:grid-cols-3" aria-label={t("s32ws.ws.summary")}>
      <StaffCard as="div"><p className={staffLabel}>{t("s32ws.ws.currentProgram")}</p>{programName === NP ? <p className="mt-2 font-serif text-xl text-student-ink">{t("s32ws.sh.noProgram")}</p> : <><p className="mt-2 font-serif text-xl leading-snug text-student-ink">{programName}</p>{programVersionName !== NP ? <p className="mt-1 text-sm text-student-muted">{t("s32ws.ws.version", { v: programVersionName })}</p> : null}</>}</StaffCard>
      <StaffCard as="div">
        <p className={staffLabel}>{t("s32ws.ws.progressStatus")}</p>
        <p className="mt-2 break-words font-serif text-xl text-student-ink">{workspaceProgressStatusLabel(vm.report?.status, t)}</p>
        <p className="mt-1 text-sm text-student-muted">{t("s32ws.ws.progressNote")}</p>
        {standingTotal > 0 ? <div className="mt-3 space-y-2" data-testid="credit-record-bar">
          <div role="img" aria-label={t("s32ws.ws.bar.aria", { total: standingTotal, v: standingCounts.verified, w: standingCounts.waiting, n: standingCounts.not_accepted })} className="flex h-2.5 overflow-hidden rounded-full bg-student-line">
            {standingCounts.verified > 0 ? <span className="bg-st-official" style={{ width: `${(standingCounts.verified / standingTotal) * 100}%` }} /> : null}
            {standingCounts.waiting > 0 ? <span className="bg-st-submitted" style={{ width: `${(standingCounts.waiting / standingTotal) * 100}%` }} /> : null}
            {standingCounts.not_accepted > 0 ? <span className="bg-st-attention" style={{ width: `${(standingCounts.not_accepted / standingTotal) * 100}%` }} /> : null}
          </div>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-student-muted">
            {standingCounts.verified > 0 ? <li><span className="font-semibold text-student-ink">{standingCounts.verified}</span> {t("s32ws.ws.bar.verified")}</li> : null}
            {standingCounts.waiting > 0 ? <li><span className="font-semibold text-student-ink">{standingCounts.waiting}</span> {t("s32ws.ws.bar.waiting")}</li> : null}
            {standingCounts.not_accepted > 0 ? <li><span className="font-semibold text-student-ink">{standingCounts.not_accepted}</span> {t("s32ws.ws.bar.notAccepted")}</li> : null}
          </ul>
        </div> : null}
      </StaffCard>
      <StaffCard as="div"><p className={staffLabel}>{t("s32ws.ws.snapshot")}</p><p className="mt-2 font-serif text-xl text-student-ink">{formatWorkspaceDateTime(snapshot.asOf ?? vm.asOf, undefined, language) ?? t("s32ws.ws.snapshotNone")}</p>{snapshotFingerprint ? <p className="mt-1 flex items-center gap-1 font-mono text-xs text-student-muted"><Fingerprint className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="min-w-0 truncate" title={snapshotFingerprint}>{snapshotFingerprint}</span></p> : null}</StaffCard>
    </section>
    {!snapshotFingerprint || snapshotUnavailable
      ? <StaffNotice tone="attention" role="status" icon={<AlertCircle className="h-4 w-4" />} action={<Button type="button" size="sm" variant="outline" className={staffBtn.outline} disabled={query.isFetching} onClick={() => void refreshCanonical()}>
            <RefreshCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
            {t("s32ws.ws.refresh")}
          </Button>}>
          {t("s32ws.ws.paused")}
        </StaffNotice>
      : null}
    <StudentPortalAccountCard studentId={canonicalStudentId ?? studentId} />
    <StaffCard tone={attentionTotal > 0 ? "attention" : "default"} aria-labelledby="needs-attention-heading" data-testid="needs-attention">
      <StaffSectionHeader id="needs-attention-heading" title={t("s32ws.ws.needs.title")} description={attentionTotal > 0 ? t("s32ws.ws.needs.some") : t("s32ws.ws.needs.none")} actions={attentionTotal > 0 ? <StaffPill tone="attention">{attentionTotal} {attentionTotal === 1 ? t("s32ws.ws.item") : t("s32ws.ws.items")}</StaffPill> : null} />
      <ul className="divide-y divide-student-line">
        {attentionRows.map((row) => <li key={row.key} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
          <div className="min-w-0"><p className="text-sm font-semibold text-student-ink">{row.label}</p><p className="text-sm text-student-muted">{row.count > 0 ? row.detail : row.none}</p></div>
          <div className="flex items-center gap-2">
            <StaffPill tone={row.count > 0 ? "attention" : "neutral"}>{row.count}</StaffPill>
            {row.count > 0 ? row.action : null}
          </div>
        </li>)}
      </ul>
    </StaffCard>
     </div>
    </StaffTabPanel>

    <StaffTabPanel idPrefix="ws" tabKey="academics" active={activeTab === "academics"}>
     <div id="workspace-academics" aria-label={t("s32ws.ws.academics")} className="space-y-6">
    <StaffNotice tone="info" action={<Link href={`/admin/students/${encodeURIComponent(studentId)}/high-school`} className={`${staffBtn.outline} inline-flex items-center justify-center border`} data-testid="link-student-high-school">{t("s32ws.ws.hsPathway")}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>}>{t("s32ws.ws.pathwayNote")}</StaffNotice>
    {vm.attention.total > 0 ? <StaffCard id="workspace-report-review" aria-labelledby="report-review-heading" tone="attention">
      <StaffSectionHeader id="report-review-heading" title={t("s32ws.ws.report.title")} description={t("s32ws.ws.report.desc")} actions={<StaffPill tone="attention">{vm.attention.total} {vm.attention.total === 1 ? t("s32ws.ws.item") : t("s32ws.ws.items")}</StaffPill>} />
      <div className="divide-y">{vm.attention.items.map((item, i) => <div key={i} className="py-3">{isDiagnosticAttentionItem(item) ? <div className="flex items-center gap-2">{diagnosticItemStatus(item) && <Badge variant="outline">{tokenLabel(diagnosticItemStatus(item), t)}</Badge>}<span className="font-medium">{item.kind === "integration-diagnostic" ? t("s32ws.ws.diag.integration") : t("s32ws.ws.diag.plain")}</span><span className="text-sm text-muted-foreground">{typeof item.diagnostic === "object" ? JSON.stringify(item.diagnostic) : String(item.diagnostic)}</span></div> : <><div className="flex flex-wrap items-center gap-2">{attentionItemStatus(vm, item) && <Badge variant="outline">{tokenLabel(attentionItemStatus(vm, item), t)}</Badge>}<span className="font-medium">{attentionItemLabel(vm.labels, item, t)}</span>{item.reason && <span className="text-sm text-muted-foreground">· {item.reason}</span>}</div><Evidence item={item} /></>}</div>)}</div>
    </StaffCard> : null}
    <section aria-labelledby="operator-academic-detail" className="space-y-4">
      <div>
        <h2 id="operator-academic-detail" className="font-serif text-2xl tracking-tight text-student-ink">{t("s32ws.ws.detail.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("s32ws.ws.detail.desc")}</p>
      </div>
      {academicRows.length === 0
        ? <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{t("s32ws.ws.detail.empty")}</CardContent></Card>
        : academicRows.map((row) => {
          const credit = row.creditRecord;
          const source = row.source;
          const verification = row.latestVerification;
          const decision = row.latestDecision;
          const creditFeedbackKey = `credit:${String(credit.id)}`;
          const standing = creditRecordStanding(credit.status, t);
          const gradeText = value(credit, "rawGrade") !== NP ? t("s32ws.ws.grade", { g: value(credit, "rawGrade") }) : NP;
          const levelText = value(credit, "normalizedLevel", "rawLevel") !== NP ? t("s32ws.ws.level", { l: value(credit, "normalizedLevel", "rawLevel") }) : NP;
          return <Card key={String(credit.id)}>
            <CardHeader className="space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><CardTitle className="font-serif text-xl font-normal tracking-tight">{value(credit, "rawCourseCode") !== NP ? `${value(credit, "rawCourseCode")} · ${show(t, value(credit, "rawTitle"))}` : show(t, value(credit, "rawTitle"))}</CardTitle>{provided(value(credit, "term"), humanValue(t, credit, "recordType")) ? <p className="mt-1 text-sm text-muted-foreground">{provided(value(credit, "term"), humanValue(t, credit, "recordType"))}</p> : null}</div>
                <StatusPill status={standing.status} label={standing.label} />
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <dl className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <DetailField label={t("s32ws.ws.source")}><span className="font-medium">{source ? show(t, value(source, "title")) : t("s32ws.ws.sourceNone")}</span><span className="block text-muted-foreground">{source ? `${show(t, humanValue(t, source, "sourceType"))} · ${show(t, humanValue(t, source, "status"))}` : t("s32ws.ws.sourceNote")}</span></DetailField>
                <DetailField label={standing.key === "verified" ? t("s32ws.ws.creditVerified") : t("s32ws.ws.creditReported")}><span className="font-medium">{t("s32ws.ws.credits", { n: show(t, value(credit, "normalizedCredits", "rawCredits")) })}</span>{provided(gradeText, levelText) ? <span className="block text-muted-foreground">{provided(gradeText, levelText)}</span> : null}</DetailField>
                <DetailField label={t("s32ws.ws.latestVerification")}>{verification ? <><Badge variant="secondary">{show(t, humanValue(t, verification, "action"))}</Badge><span className="mt-1 block text-muted-foreground">{displayDate(verification.createdAt, language, t)}</span></> : t("s32ws.ws.noVerification")}</DetailField>
                <DetailField label={t("s32ws.ws.latestDecision")}>{decision ? <><Badge variant="secondary">{show(t, humanValue(t, decision, "action"))}</Badge><span className="mt-1 block text-muted-foreground">{t("s32ws.ws.awarded", { n: show(t, value(decision, "creditsAwarded")), date: displayDate(decision.createdAt, language, t) })}</span></> : t("s32ws.ws.noDecision")}</DetailField>
              </dl>
              <div className="border-t pt-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold"><FileCheck2 className="h-4 w-4" />{t("s32ws.ws.placement")}</h3>
                  {canCreatePlacement(decision)
                    ? <PlacementActionDialog
                        operation="create"
                        studentId={placementStudentId ?? ""}
                        studentName={name}
                        snapshotFingerprint={snapshotFingerprint ?? ""}
                        decisionId={String(decision!.id)}
                        requirements={requirementOptions}
                        academicRules={academicRuleOptions}
                        disabled={writesDisabled}
                        disabledReason={writesDisabledReason}
                        onRefreshCanonical={refreshCanonical}
                        onSnapshotUnavailable={() => setSnapshotUnavailable(true)}
                        onFeedback={(feedback) => setPlacementFeedback((current) => ({
                          ...current,
                          [creditFeedbackKey]: feedback,
                        }))}
                      />
                    : null}
                </div>
                <InlinePlacementFeedback feedback={placementFeedback[creditFeedbackKey]} />
                {row.placements.length === 0
                  ? <p className="mt-2 text-sm text-muted-foreground">{t("s32ws.ws.noPlacement")}</p>
                  : <div className="mt-3 grid gap-3 md:grid-cols-2">
                      {row.placements.map((placement) => {
                        const placementKey = `placement:${String(placement.id)}`;
                        const currentLabel = placementLabel(placement);
                        const currentStatus = show(t, humanValue(t, placement, "status"));
                        const currentRationale = value(placement, "rationale");
                        const reportFeedback = (feedback: PlacementActionFeedback) =>
                          setPlacementFeedback((current) => ({ ...current, [placementKey]: feedback }));
                        return <div key={String(placement.id)} className="rounded-md border bg-muted/20 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-medium">{currentLabel}</span>
                            <Badge variant="outline">{currentStatus}</Badge>
                          </div>
                          <p className="mt-2 text-sm text-muted-foreground">{show(t, currentRationale)}</p>
                          {canSupersedePlacement(placement, decision) || canRevokePlacement(placement)
                            ? <div className="mt-3 flex flex-wrap gap-2">
                                {canSupersedePlacement(placement, decision)
                                  ? <PlacementActionDialog
                                      operation="supersede"
                                      studentId={placementStudentId ?? ""}
                                      studentName={name}
                                      snapshotFingerprint={snapshotFingerprint ?? ""}
                                      placementId={String(placement.id)}
                                      placementLabel={currentLabel}
                                      placementStatus={currentStatus}
                                      currentRationale={currentRationale}
                                      requirements={requirementOptions}
                                      academicRules={academicRuleOptions}
                                      disabled={writesDisabled}
                                      disabledReason={writesDisabledReason}
                                      onRefreshCanonical={refreshCanonical}
                                      onSnapshotUnavailable={() => setSnapshotUnavailable(true)}
                                      onFeedback={reportFeedback}
                                    />
                                  : null}
                                {canRevokePlacement(placement)
                                  ? <PlacementActionDialog
                                      operation="revoke"
                                      studentId={placementStudentId ?? ""}
                                      studentName={name}
                                      snapshotFingerprint={snapshotFingerprint ?? ""}
                                      placementId={String(placement.id)}
                                      placementLabel={currentLabel}
                                      placementStatus={currentStatus}
                                      currentRationale={currentRationale}
                                      requirements={requirementOptions}
                                      academicRules={academicRuleOptions}
                                      disabled={writesDisabled}
                                      disabledReason={writesDisabledReason}
                                      onRefreshCanonical={refreshCanonical}
                                      onSnapshotUnavailable={() => setSnapshotUnavailable(true)}
                                      onFeedback={reportFeedback}
                                    />
                                  : null}
                              </div>
                            : null}
                          <InlinePlacementFeedback feedback={placementFeedback[placementKey]} />
                          <details className="mt-3">
                            <summary className="cursor-pointer text-xs font-medium">{t("s32ws.ws.lifecycle")}</summary>
                            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                              <DetailField label={t("s32ws.ws.recorded")}>{displayDate(placement.createdAt, language, t)}</DetailField>
                              <DetailField label={t("s32ws.ws.updated")}>{displayDate(placement.updatedAt, language, t)}</DetailField>
                              {value(placement, "revocationRationale") !== NP ? <DetailField label={t("s32ws.ws.revocation")}>{value(placement, "revocationRationale")}</DetailField> : null}
                              {value(placement, "supersedeRationale") !== NP ? <DetailField label={t("s32ws.ws.supersession")}>{value(placement, "supersedeRationale")}</DetailField> : null}
                            </dl>
                            <pre className="mt-3 overflow-auto rounded bg-muted p-3 text-xs text-muted-foreground">{JSON.stringify({ provenance: placement.provenance, metadata: placement.metadata }, null, 2)}</pre>
                            <Reference value={placement.id} />
                          </details>
                        </div>;
                      })}
                    </div>}
              </div>
              <details className="border-t pt-4">
                <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold"><Database className="h-4 w-4" />{t("s32ws.ws.provRefs")}</summary>
                <div className="mt-3 grid gap-3 md:grid-cols-3"><Reference value={source?.id} /><Reference value={credit.id} /><Reference value={decision?.basisClaimVersionId} /></div>
              </details>
            </CardContent>
          </Card>;
        })}
    </section>
    {vm.academicDetail.placements.filter((placement) => !academicRows.some((row) => row.placements.includes(placement))).length > 0 && <Card>
      <CardHeader>
        <CardTitle className="font-serif text-xl font-normal tracking-tight">{t("s32ws.ws.historical")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("s32ws.ws.historicalDesc")}</p>
      </CardHeader>
      <CardContent className="divide-y">
        {vm.academicDetail.placements.filter((placement) => !academicRows.some((row) => row.placements.includes(placement))).map((placement) => {
          const placementKey = `placement:${String(placement.id)}`;
          const currentLabel = placementLabel(placement);
          const currentStatus = show(t, humanValue(t, placement, "status"));
          const currentRationale = value(placement, "rationale");
          return <div key={String(placement.id)} className="py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{currentLabel}</span>
              <Badge variant="outline">{currentStatus}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{show(t, currentRationale)}</p>
            {canRevokePlacement(placement)
              ? <div className="mt-3">
                  <PlacementActionDialog
                    operation="revoke"
                    studentId={placementStudentId ?? ""}
                    studentName={name}
                    snapshotFingerprint={snapshotFingerprint ?? ""}
                    placementId={String(placement.id)}
                    placementLabel={currentLabel}
                    placementStatus={currentStatus}
                    currentRationale={currentRationale}
                    requirements={requirementOptions}
                    academicRules={academicRuleOptions}
                    disabled={writesDisabled}
                    disabledReason={writesDisabledReason}
                    onRefreshCanonical={refreshCanonical}
                    onSnapshotUnavailable={() => setSnapshotUnavailable(true)}
                    onFeedback={(feedback) => setPlacementFeedback((current) => ({
                      ...current,
                      [placementKey]: feedback,
                    }))}
                  />
                </div>
              : null}
            <InlinePlacementFeedback feedback={placementFeedback[placementKey]} />
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-medium">{t("s32ws.ws.lifecycle")}</summary>
              <pre className="mt-2 overflow-auto rounded bg-muted p-3 text-xs text-muted-foreground">{JSON.stringify({ provenance: placement.provenance, metadata: placement.metadata, supersedesPlacementId: placement.supersedesPlacementId, supersededByPlacementId: placement.supersededByPlacementId }, null, 2)}</pre>
              <Reference value={placement.id} />
            </details>
          </div>;
        })}
      </CardContent>
    </Card>}
     <Card><CardHeader><CardTitle className="font-serif text-xl font-normal tracking-tight">{t("s32ws.ws.provenance")}</CardTitle></CardHeader><CardContent className="grid gap-4 text-sm md:grid-cols-3"><div><p className="text-muted-foreground">{t("s32ws.ws.reportStatus")}</p><p className="mt-1 font-medium">{workspaceProgressStatusLabel(vm.provenance.reportStatus, t)}</p></div><div><p className="text-muted-foreground">{t("s32ws.ws.reasons")}</p><p className="mt-1 font-medium">{vm.provenance.reasons.length || t("s32ws.ws.noneReported")}</p></div><div><p className="text-muted-foreground">{t("s32ws.ws.diagnostics")}</p><p className="mt-1 font-medium">{vm.provenance.integrationDiagnostics.length + vm.provenance.diagnostics.length || t("s32ws.ws.noneReported")}</p></div></CardContent></Card>
     </div>
    </StaffTabPanel>

    <StaffTabPanel idPrefix="ws" tabKey="billing" active={activeTab === "billing"}>
      {canonicalStudentId ? <DossierBilling studentId={canonicalStudentId} billing={billingQuery.data} loading={billingQuery.isLoading} error={billingQuery.isError} /> : null}
    </StaffTabPanel>

    <StaffTabPanel idPrefix="ws" tabKey="profile" active={activeTab === "profile"}>
      {canonicalStudentId ? <StudentProfileReview studentId={canonicalStudentId} /> : null}
    </StaffTabPanel>

    <StaffTabPanel idPrefix="ws" tabKey="documents" active={activeTab === "documents"}>
     <section id="workspace-documents" aria-labelledby="workspace-documents-heading" className="space-y-4">
       <StaffSectionHeader id="workspace-documents-heading" icon={<FileText className="h-5 w-5" />} title={t("s32ws.sh.docs.title")} description={t("s32ws.sh.docs.desc")} />
       <WorkspaceResourceState loading={documentsQuery.isLoading} error={documentsQuery.isError} empty={false} onRetry={() => void documentsQuery.refetch()}>
         {canonicalStudentId ? <StudentDocumentsReview studentId={canonicalStudentId} documents={documentsQuery.data ?? []} /> : null}
       </WorkspaceResourceState>
     </section>
    </StaffTabPanel>

    <StaffTabPanel idPrefix="ws" tabKey="support" active={activeTab === "support"}>
     <section id="workspace-support" aria-labelledby="workspace-support-heading" className="space-y-4">
       <StaffSectionHeader id="workspace-support-heading" icon={<LifeBuoy className="h-5 w-5" />} title={t("s32ws.sh.support.title")} description={t("s32ws.ws.support.desc")} actions={canonicalStudentId ? <Link href={`/support?studentId=${encodeURIComponent(canonicalStudentId)}`} className={`${staffBtn.outline} inline-flex items-center justify-center border`}>{t("s32ws.sh.support.open")}</Link> : undefined} />
       <WorkspaceResourceState loading={ticketsQuery.isLoading} error={ticketsQuery.isError} empty={!ticketsQuery.data?.tickets.length} onRetry={() => void ticketsQuery.refetch()}>
         <ul className="space-y-3">{ticketsQuery.data?.tickets.map((ticket: Ticket) => <li key={ticket.id}><StaffCard as="div" className="space-y-2"><div className="flex flex-wrap items-center justify-between gap-3"><p className="font-medium text-student-ink">{ticket.subject}</p><div className="flex flex-wrap gap-2"><StatusPill status={ticketStatusKey(ticket.status)} label={ticketStatusText(ticket.status, language, t)} /><StaffPill tone={ticket.priority === "urgent" ? "urgent-solid" : ticket.priority === "high" ? "attention" : "neutral"}>{tokenLabel(ticket.priority, t) ?? workspaceToken(ticket.priority) ?? ticket.priority}</StaffPill></div></div><p className="text-sm text-student-muted">{ticket.ticket_number} · {ticketTopicText(ticket, language)}</p>{formatWorkspaceDateTime(ticket.created_at, undefined, language) ? <p className="text-xs text-student-muted">{t("s32ws.sh.support.opened", { date: formatWorkspaceDateTime(ticket.created_at, undefined, language) ?? "" })}</p> : null}<Link href={`/support?studentId=${encodeURIComponent(canonicalStudentId ?? "")}&ticket=${encodeURIComponent(ticket.id)}`} className="inline-flex min-h-10 items-center text-sm font-semibold text-student-gold-ink underline-offset-4 hover:underline" data-testid="link-workspace-ticket">{t("s32ws.sh.support.conversation")}</Link></StaffCard></li>)}</ul>
       </WorkspaceResourceState>
     </section>
    </StaffTabPanel>
    {user?.role === "admin" && canonicalStudentId ? <StaffTabPanel idPrefix="ws" tabKey="activity" active={activeTab === "activity"}>
      <DossierActivity studentId={canonicalStudentId} />
    </StaffTabPanel> : null}
    {user?.role === "admin" && canonicalStudentId ? <StaffTabPanel idPrefix="ws" tabKey="ai" active={activeTab === "ai"}>
      <OwnerAssistantPanel studentId={canonicalStudentId} studentLabel={name} />
    </StaffTabPanel> : null}
  </StaffPage>;
}
