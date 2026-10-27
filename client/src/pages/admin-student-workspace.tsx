import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useParams, Link } from "wouter";
import { AlertCircle, ArrowLeft, ArrowRight, ChevronDown, Database, FileCheck2, FileText, Fingerprint, LayoutDashboard, LifeBuoy, RefreshCw, Route, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  StaffCard,
  StaffNotice,
  StaffPage,
  StaffPageHeader,
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
  documentStatusKey,
  resolveWorkspaceStudentIdentity,
  workspaceStudentIdFromData,
  formatWorkspaceDateTime,
  workspaceProgressStatusLabel,
  workspaceToken,
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
import StudentProfileReview, { useStaffProfileData } from "@/components/admin/student-profile-review";
import { profileDecisionCount } from "@/components/admin/student-profile-review-logic";
import { useDocuments } from "@/hooks/use-documents";
import { useTickets, type Ticket } from "@/hooks/use-tickets";
import { SUPPORT_TOPIC_INFO, awaitingFor, staffStatusLabel, topicForTicket } from "@shared/support-contract";
import { docStatusLabel, docTypeLabel } from "@/lib/document-type-labels";

const WORKSPACE_TABS = ["overview", "profile", "documents", "support"] as const;
type WorkspaceTab = typeof WORKSPACE_TABS[number];
/** Older anchors (#workspace-documents, ...) keep working as deep links. */
const WORKSPACE_TAB_ALIASES: Readonly<Record<string, WorkspaceTab>> = {
  "workspace-overview": "overview",
  "workspace-profile": "profile",
  "workspace-documents": "documents",
  "workspace-support": "support",
};

function value(row: unknown, ...keys: string[]) {
  const record = row && typeof row === "object" && !Array.isArray(row) ? row as WorkspaceRecord : {};
  for (const key of keys) if (record[key] !== undefined && record[key] !== null && record[key] !== "") return String(record[key]);
  return "Not provided";
}
function Evidence({ item }: { item: WorkspaceAttentionItem }) {
  return <details className="group border-t border-border/70 py-3">
    <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium">
      <span className="flex items-center gap-2"><ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />Evidence, reason & provenance</span>
      <span className="font-mono text-[11px] text-muted-foreground">{item.requirementId ?? item.academicRuleId}</span>
    </summary>
    <pre className="mt-3 overflow-auto rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">{JSON.stringify({ reason: item.reason, evidence: item.evidence, provenance: item.provenance, requiredAmount: item.requiredAmount, appliedAmount: item.appliedAmount, remainingAmount: item.remainingAmount }, null, 2)}</pre>
  </details>;
}
function displayDate(value: unknown): string {
  return formatWorkspaceDateTime(value) ?? "Date not recorded";
}
/** Enum-ish record value as readable text; "Not provided" only when truly absent. */
/** Join only the parts that are actually recorded. */
function provided(...parts: string[]): string {
  return parts.filter((part) => part !== "Not provided").join(" · ");
}
function humanValue(row: unknown, ...keys: string[]) {
  const raw = value(row, ...keys);
  return raw === "Not provided" ? raw : workspaceToken(raw) ?? raw;
}
function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="mt-1 text-sm">{children}</dd></div>;
}
function Reference({ value: reference }: { value: unknown }) {
  if (typeof reference !== "string" || !reference) return null;
  return <p className="mt-2 font-mono text-[11px] text-muted-foreground">Reference: {reference}</p>;
}
function InlinePlacementFeedback({ feedback }: { feedback?: PlacementActionFeedback }) {
  if (!feedback) return null;
  return <div
    role={feedback.kind === "error" ? "alert" : "status"}
    className={`mt-3 rounded-md border px-3 py-2 text-sm ${
      feedback.kind === "error"
        ? "border-destructive/40 bg-destructive/5 text-destructive"
        : "border-green-600/30 bg-green-600/5 text-green-800 dark:text-green-300"
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
  if (loading) return <div role="status" aria-live="polite" className="rounded-md border p-6 text-center text-sm text-muted-foreground">Loading…</div>;
  if (error) return <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm"><p>Could not load this section.</p><Button className="mt-3" type="button" size="sm" variant="outline" onClick={onRetry}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button></div>;
  if (empty) return <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No records are available for this student.</div>;
  return <>{children}</>;
}
export default function AdminStudentWorkspace() {
  const { studentId = "" } = useParams<{ studentId: string }>();
  const [snapshotUnavailable, setSnapshotUnavailable] = useState(false);
  const [placementFeedback, setPlacementFeedback] = useState<Record<string, PlacementActionFeedback>>({});
  const query = useQuery({
    queryKey: ADMIN_STUDENT_WORKSPACE_QUERY_KEY(studentId),
    ...ADMIN_STUDENT_WORKSPACE_QUERY_OPTIONS,
  });
  // Route param only locates the workspace; every panel keys off the id of the
  // student record the workspace endpoint returned.
  const canonicalStudentId = workspaceStudentIdFromData(query.data) ?? null;
  const documentsQuery = useDocuments(canonicalStudentId);
  const ticketsQuery = useTickets({ studentId: canonicalStudentId });
  const { profileQuery } = useStaffProfileData(canonicalStudentId ?? "");
  const [tab, setTab] = useHashTab(WORKSPACE_TABS, "overview", WORKSPACE_TAB_ALIASES);
  const state = selectWorkspaceState(query);
  if (state.kind === "loading") return <div role={state.role} aria-live={state.ariaLive} className="space-y-4"><span className="sr-only">Loading student workspace</span><div className="h-8 w-64 animate-pulse rounded bg-muted" /><div className="h-32 animate-pulse rounded-lg bg-muted" /><div className="h-64 animate-pulse rounded-lg bg-muted" /></div>;
  if (state.kind === "error") return <Card><CardContent className="flex flex-col items-center gap-3 py-16 text-center"><AlertCircle className="h-8 w-8 text-destructive" /><h2 className="text-lg font-semibold">Workspace unavailable</h2><p className="text-sm text-muted-foreground">The canonical student workspace could not be loaded.</p><Button onClick={() => query.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button></CardContent></Card>;
  if (state.kind === "empty") return <Card><CardContent className="flex flex-col items-center gap-3 py-16 text-center"><h2 className="text-lg font-semibold">{state.reason === "not-found" ? "Student workspace not found" : "Workspace unavailable"}</h2><p className="text-sm text-muted-foreground">{state.reason === "not-found" ? "There is no canonical workspace for this student." : "No workspace record is available for this student."}</p></CardContent></Card>;
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
  const reviewButton = (label: string, onClick: () => void) => <Button type="button" size="sm" variant="outline" className={staffBtn.outline} aria-label={`Review ${label}`} onClick={onClick}>Review<ArrowRight className="h-4 w-4" aria-hidden="true" /></Button>;
  const attentionRows = [
    { key: "profile", label: "Identity and guardian decisions", count: profileCount, detail: `${profileCount} waiting for a decision`, none: "No decisions waiting", action: reviewButton("identity and guardian decisions", () => setTab("profile")) },
    { key: "documents", label: "Documents to review", count: docsPending, detail: `${docsPending} waiting for review`, none: "No documents waiting", action: reviewButton("documents", () => setTab("documents")) },
    { key: "support", label: "Requests waiting on Lumière", count: supportAwaiting, detail: `${supportAwaiting} waiting for a response`, none: "No requests waiting", action: reviewButton("support requests", () => setTab("support")) },
    { key: "report", label: "Academic report items", count: vm.attention.total, detail: `${vm.attention.total} manual-review, conflict, missing or partial`, none: "None reported", action: reviewButton("academic report items", () => document.getElementById("workspace-report-review")?.scrollIntoView({ block: "start" })) },
  ];
  const tabs: StaffTab[] = [
    { key: "overview", label: "Overview", icon: <LayoutDashboard className="h-4 w-4" /> },
    { key: "profile", label: "Profile & identity", icon: <Fingerprint className="h-4 w-4" />, count: profileCount, countLabel: "decisions waiting" },
    { key: "documents", label: "Documents", icon: <FileText className="h-4 w-4" />, count: docsPending, countLabel: "waiting for review" },
    { key: "support", label: "Support", icon: <LifeBuoy className="h-4 w-4" />, count: supportAwaiting, countLabel: "waiting for a response" },
  ];
  const identity = resolveWorkspaceStudentIdentity(vm.student);
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
  const writesDisabled = !placementStudentId || !placementWritesEnabled(
    snapshotFingerprint,
    snapshotUnavailable,
    query.isFetching,
  );
  const writesDisabledReason = !snapshotFingerprint
    ? "Placement changes are unavailable until this student has a valid current snapshot."
    : snapshotUnavailable
      ? "Placement changes are unavailable because the latest student record could not be loaded."
      : query.isFetching
        ? "Placement changes are temporarily unavailable while the student workspace refreshes."
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
    <StaffPageHeader
      back={<Link href={ADMIN_STUDENTS_PATH} className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-student-gold-ink underline-offset-4 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to Students</Link>}
      eyebrow="Staff Portal · Student workspace"
      title={name}
      description={<>{identity.email ?? "Not provided"} · <span className="font-mono">{identity.studentCode ?? "Not provided"}</span></>}
      meta={<StaffPill tone="neutral" icon={<ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />}>Canonical view · controlled placement writes</StaffPill>}
      actions={<><Link href={`/admin/students/${encodeURIComponent(studentId)}/roadmap`} className={`${staffBtn.outline} inline-flex items-center justify-center border`} data-testid="link-student-roadmap"><Route className="h-4 w-4" aria-hidden="true" />View roadmap</Link><Link href={`/admin/students/${encodeURIComponent(studentId)}/high-school`} className={`${staffBtn.outline} inline-flex items-center justify-center border`} data-testid="link-student-high-school">High school pathway</Link></>}
    />
    <StaffTabList tabs={tabs} active={tab} onChange={(key) => setTab(key as WorkspaceTab)} label="Student workspace sections" idPrefix="ws" />

    <StaffTabPanel idPrefix="ws" tabKey="overview" active={tab === "overview"}>
    <div id="workspace-overview" aria-label="Overview" className="space-y-6">
    <section className="grid gap-4 md:grid-cols-3" aria-label="Summary">
      <StaffCard as="div"><p className={staffLabel}>Current program</p>{programName === "Not provided" ? <p className="mt-2 font-serif text-xl text-student-ink">No program assigned</p> : <><p className="mt-2 font-serif text-xl leading-snug text-student-ink">{programName}</p>{programVersionName !== "Not provided" ? <p className="mt-1 text-sm text-student-muted">Version {programVersionName}</p> : null}</>}</StaffCard>
      <StaffCard as="div">
        <p className={staffLabel}>Progress status</p>
        <p className="mt-2 break-words font-serif text-xl text-student-ink">{workspaceProgressStatusLabel(vm.report?.status)}</p>
        <p className="mt-1 text-sm text-student-muted">Canonical degree-progress result</p>
        {standingTotal > 0 ? <div className="mt-3 space-y-2" data-testid="credit-record-bar">
          <div role="img" aria-label={`${standingTotal} credit records: ${standingCounts.verified} verified, ${standingCounts.waiting} waiting for verification, ${standingCounts.not_accepted} not accepted`} className="flex h-2.5 overflow-hidden rounded-full bg-student-line">
            {standingCounts.verified > 0 ? <span className="bg-st-official" style={{ width: `${(standingCounts.verified / standingTotal) * 100}%` }} /> : null}
            {standingCounts.waiting > 0 ? <span className="bg-st-submitted" style={{ width: `${(standingCounts.waiting / standingTotal) * 100}%` }} /> : null}
            {standingCounts.not_accepted > 0 ? <span className="bg-st-attention" style={{ width: `${(standingCounts.not_accepted / standingTotal) * 100}%` }} /> : null}
          </div>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-student-muted">
            {standingCounts.verified > 0 ? <li><span className="font-semibold text-student-ink">{standingCounts.verified}</span> verified</li> : null}
            {standingCounts.waiting > 0 ? <li><span className="font-semibold text-student-ink">{standingCounts.waiting}</span> waiting for verification</li> : null}
            {standingCounts.not_accepted > 0 ? <li><span className="font-semibold text-student-ink">{standingCounts.not_accepted}</span> not accepted</li> : null}
          </ul>
        </div> : null}
      </StaffCard>
      <StaffCard as="div"><p className={staffLabel}>Snapshot</p><p className="mt-2 font-serif text-xl text-student-ink">{formatWorkspaceDateTime(snapshot.asOf ?? vm.asOf) ?? "No snapshot yet"}</p>{snapshotFingerprint ? <p className="mt-1 flex items-center gap-1 font-mono text-xs text-student-muted"><Fingerprint className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="min-w-0 truncate" title={snapshotFingerprint}>{snapshotFingerprint}</span></p> : null}</StaffCard>
    </section>
    {!snapshotFingerprint || snapshotUnavailable
      ? <StaffNotice tone="attention" role="status" icon={<AlertCircle className="h-4 w-4" />} action={<Button type="button" size="sm" variant="outline" className={staffBtn.outline} disabled={query.isFetching} onClick={() => void refreshCanonical()}>
            <RefreshCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
            Refresh workspace
          </Button>}>
          Placement changes are paused: this student has no current academic snapshot yet. Refresh the workspace once the degree report has been generated.
        </StaffNotice>
      : null}
    <StaffCard tone={attentionTotal > 0 ? "attention" : "default"} aria-labelledby="needs-attention-heading" data-testid="needs-attention">
      <StaffSectionHeader id="needs-attention-heading" title="Needs attention" description={attentionTotal > 0 ? "Everything waiting on a staff member for this student, in one list." : "Nothing is waiting on a staff member for this student."} actions={attentionTotal > 0 ? <StaffPill tone="attention">{attentionTotal} {attentionTotal === 1 ? "item" : "items"}</StaffPill> : null} />
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
    {vm.attention.total > 0 ? <StaffCard id="workspace-report-review" aria-labelledby="report-review-heading" tone="attention">
      <StaffSectionHeader id="report-review-heading" title="Academic report review" description="Manual-review, conflict, missing or partial items from the canonical degree report." actions={<StaffPill tone="attention">{vm.attention.total} {vm.attention.total === 1 ? "item" : "items"}</StaffPill>} />
      <div className="divide-y">{vm.attention.items.map((item, i) => <div key={i} className="py-3">{isDiagnosticAttentionItem(item) ? <div className="flex items-center gap-2">{diagnosticItemStatus(item) && <Badge variant="outline">{diagnosticItemStatus(item)}</Badge>}<span className="font-medium">{item.kind === "integration-diagnostic" ? "Integration diagnostic" : "Diagnostic"}</span><span className="text-sm text-muted-foreground">{typeof item.diagnostic === "object" ? JSON.stringify(item.diagnostic) : String(item.diagnostic)}</span></div> : <><div className="flex flex-wrap items-center gap-2">{attentionItemStatus(vm, item) && <Badge variant="outline">{attentionItemStatus(vm, item)}</Badge>}<span className="font-medium">{attentionItemLabel(vm.labels, item)}</span>{item.reason && <span className="text-sm text-muted-foreground">· {item.reason}</span>}</div><Evidence item={item} /></>}</div>)}</div>
    </StaffCard> : null}
    <section aria-labelledby="operator-academic-detail" className="space-y-4">
      <div>
        <h2 id="operator-academic-detail" className="font-serif text-2xl tracking-tight text-student-ink">Operator academic detail</h2>
        <p className="mt-1 text-sm text-muted-foreground">Canonical source, credit, latest verification, latest decision, and placement records. No academic values are recomputed here.</p>
      </div>
      {academicRows.length === 0
        ? <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No canonical credit records are available.</CardContent></Card>
        : academicRows.map((row) => {
          const credit = row.creditRecord;
          const source = row.source;
          const verification = row.latestVerification;
          const decision = row.latestDecision;
          const creditFeedbackKey = `credit:${String(credit.id)}`;
          const standing = creditRecordStanding(credit.status);
          return <Card key={String(credit.id)}>
            <CardHeader className="space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><CardTitle className="font-serif text-xl font-normal tracking-tight">{value(credit, "rawCourseCode") !== "Not provided" ? `${value(credit, "rawCourseCode")} · ${value(credit, "rawTitle")}` : value(credit, "rawTitle")}</CardTitle>{provided(value(credit, "term"), humanValue(credit, "recordType")) ? <p className="mt-1 text-sm text-muted-foreground">{provided(value(credit, "term"), humanValue(credit, "recordType"))}</p> : null}</div>
                <StatusPill status={standing.status} label={standing.label} />
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <dl className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <DetailField label="Source"><span className="font-medium">{source ? value(source, "title") : "Source unavailable"}</span><span className="block text-muted-foreground">{source ? `${humanValue(source, "sourceType")} · ${humanValue(source, "status")}` : "Canonical source record not supplied"}</span></DetailField>
                <DetailField label={standing.key === "verified" ? "Verified credit" : "Reported credit"}><span className="font-medium">{value(credit, "normalizedCredits", "rawCredits")} credits</span>{provided(value(credit, "rawGrade") !== "Not provided" ? `Grade ${value(credit, "rawGrade")}` : "Not provided", value(credit, "normalizedLevel", "rawLevel") !== "Not provided" ? `Level ${value(credit, "normalizedLevel", "rawLevel")}` : "Not provided") ? <span className="block text-muted-foreground">{provided(value(credit, "rawGrade") !== "Not provided" ? `Grade ${value(credit, "rawGrade")}` : "Not provided", value(credit, "normalizedLevel", "rawLevel") !== "Not provided" ? `Level ${value(credit, "normalizedLevel", "rawLevel")}` : "Not provided")}</span> : null}</DetailField>
                <DetailField label="Latest verification">{verification ? <><Badge variant="secondary">{humanValue(verification, "action")}</Badge><span className="mt-1 block text-muted-foreground">{displayDate(verification.createdAt)}</span></> : "No verification recorded"}</DetailField>
                <DetailField label="Latest decision">{decision ? <><Badge variant="secondary">{humanValue(decision, "action")}</Badge><span className="mt-1 block text-muted-foreground">{value(decision, "creditsAwarded")} credits awarded · {displayDate(decision.createdAt)}</span></> : "No decision for the active assignment"}</DetailField>
              </dl>
              <div className="border-t pt-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold"><FileCheck2 className="h-4 w-4" />Placement</h3>
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
                  ? <p className="mt-2 text-sm text-muted-foreground">No placement tied to the latest decision.</p>
                  : <div className="mt-3 grid gap-3 md:grid-cols-2">
                      {row.placements.map((placement) => {
                        const placementKey = `placement:${String(placement.id)}`;
                        const currentLabel = placementLabel(placement);
                        const currentStatus = humanValue(placement, "status");
                        const currentRationale = value(placement, "rationale");
                        const reportFeedback = (feedback: PlacementActionFeedback) =>
                          setPlacementFeedback((current) => ({ ...current, [placementKey]: feedback }));
                        return <div key={String(placement.id)} className="rounded-md border bg-muted/20 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-medium">{currentLabel}</span>
                            <Badge variant="outline">{currentStatus}</Badge>
                          </div>
                          <p className="mt-2 text-sm text-muted-foreground">{currentRationale}</p>
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
                            <summary className="cursor-pointer text-xs font-medium">Lifecycle & provenance</summary>
                            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                              <DetailField label="Recorded">{displayDate(placement.createdAt)}</DetailField>
                              <DetailField label="Updated">{displayDate(placement.updatedAt)}</DetailField>
                              {value(placement, "revocationRationale") !== "Not provided" ? <DetailField label="Revocation">{value(placement, "revocationRationale")}</DetailField> : null}
                              {value(placement, "supersedeRationale") !== "Not provided" ? <DetailField label="Supersession">{value(placement, "supersedeRationale")}</DetailField> : null}
                            </dl>
                            <pre className="mt-3 overflow-auto rounded bg-muted p-3 text-xs text-muted-foreground">{JSON.stringify({ provenance: placement.provenance, metadata: placement.metadata }, null, 2)}</pre>
                            <Reference value={placement.id} />
                          </details>
                        </div>;
                      })}
                    </div>}
              </div>
              <details className="border-t pt-4">
                <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold"><Database className="h-4 w-4" />Provenance references</summary>
                <div className="mt-3 grid gap-3 md:grid-cols-3"><Reference value={source?.id} /><Reference value={credit.id} /><Reference value={decision?.basisClaimVersionId} /></div>
              </details>
            </CardContent>
          </Card>;
        })}
    </section>
    {vm.academicDetail.placements.filter((placement) => !academicRows.some((row) => row.placements.includes(placement))).length > 0 && <Card>
      <CardHeader>
        <CardTitle className="font-serif text-xl font-normal tracking-tight">Historical placement records</CardTitle>
        <p className="text-sm text-muted-foreground">Placements retained for earlier decisions in this active assignment. An active record can still be revoked here.</p>
      </CardHeader>
      <CardContent className="divide-y">
        {vm.academicDetail.placements.filter((placement) => !academicRows.some((row) => row.placements.includes(placement))).map((placement) => {
          const placementKey = `placement:${String(placement.id)}`;
          const currentLabel = placementLabel(placement);
          const currentStatus = humanValue(placement, "status");
          const currentRationale = value(placement, "rationale");
          return <div key={String(placement.id)} className="py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{currentLabel}</span>
              <Badge variant="outline">{currentStatus}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{currentRationale}</p>
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
              <summary className="cursor-pointer text-xs font-medium">Lifecycle & provenance</summary>
              <pre className="mt-2 overflow-auto rounded bg-muted p-3 text-xs text-muted-foreground">{JSON.stringify({ provenance: placement.provenance, metadata: placement.metadata, supersedesPlacementId: placement.supersedesPlacementId, supersededByPlacementId: placement.supersededByPlacementId }, null, 2)}</pre>
              <Reference value={placement.id} />
            </details>
          </div>;
        })}
      </CardContent>
    </Card>}
     <Card><CardHeader><CardTitle className="font-serif text-xl font-normal tracking-tight">Report provenance</CardTitle></CardHeader><CardContent className="grid gap-4 text-sm md:grid-cols-3"><div><p className="text-muted-foreground">Report status</p><p className="mt-1 font-medium">{workspaceProgressStatusLabel(vm.provenance.reportStatus)}</p></div><div><p className="text-muted-foreground">Reasons</p><p className="mt-1 font-medium">{vm.provenance.reasons.length || "None reported"}</p></div><div><p className="text-muted-foreground">Diagnostics</p><p className="mt-1 font-medium">{vm.provenance.integrationDiagnostics.length + vm.provenance.diagnostics.length || "None reported"}</p></div></CardContent></Card>
     </div>
    </StaffTabPanel>

    <StaffTabPanel idPrefix="ws" tabKey="profile" active={tab === "profile"}>
      {canonicalStudentId ? <StudentProfileReview studentId={canonicalStudentId} /> : null}
    </StaffTabPanel>

    <StaffTabPanel idPrefix="ws" tabKey="documents" active={tab === "documents"}>
     <section id="workspace-documents" aria-labelledby="workspace-documents-heading" className="space-y-4">
       <StaffSectionHeader id="workspace-documents-heading" icon={<FileText className="h-5 w-5" />} title="Documents" description="Documents already recorded for this student. This workspace is read-only." />
       <WorkspaceResourceState loading={documentsQuery.isLoading} error={documentsQuery.isError} empty={!documentsQuery.data?.length} onRetry={() => void documentsQuery.refetch()}>
         <ul className="grid gap-3 md:grid-cols-2">{documentsQuery.data?.map((document) => <li key={document.id}><StaffCard as="div" className="space-y-2"><div className="flex flex-wrap items-start justify-between gap-3"><p className="min-w-0 break-words font-medium text-student-ink">{document.file_name}</p><StatusPill status={documentStatusKey(document.status)} label={docStatusLabel(document.status)} /></div><p className="text-sm text-student-muted">{docTypeLabel(document.doc_type)}{document.issuer ? ` · ${document.issuer}` : ""}</p>{formatWorkspaceDateTime(document.uploaded_at ?? document.created_at) ? <p className="text-xs text-student-muted">Uploaded {formatWorkspaceDateTime(document.uploaded_at ?? document.created_at)}</p> : null}</StaffCard></li>)}</ul>
       </WorkspaceResourceState>
     </section>
    </StaffTabPanel>

    <StaffTabPanel idPrefix="ws" tabKey="support" active={tab === "support"}>
     <section id="workspace-support" aria-labelledby="workspace-support-heading" className="space-y-4">
       <StaffSectionHeader id="workspace-support-heading" icon={<LifeBuoy className="h-5 w-5" />} title="Support" description="Support tickets associated with this student. This workspace is read-only; replies happen in the Support desk." actions={<Link href="/support" className={`${staffBtn.outline} inline-flex items-center justify-center border`}>Open Support desk</Link>} />
       <WorkspaceResourceState loading={ticketsQuery.isLoading} error={ticketsQuery.isError} empty={!ticketsQuery.data?.tickets.length} onRetry={() => void ticketsQuery.refetch()}>
         <ul className="space-y-3">{ticketsQuery.data?.tickets.map((ticket: Ticket) => <li key={ticket.id}><StaffCard as="div" className="space-y-2"><div className="flex flex-wrap items-center justify-between gap-3"><p className="font-medium text-student-ink">{ticket.subject}</p><div className="flex flex-wrap gap-2"><StatusPill status={ticketStatusKey(ticket.status)} label={staffStatusLabel(ticket.status)} /><StaffPill tone={ticket.priority === "urgent" ? "urgent-solid" : ticket.priority === "high" ? "attention" : "neutral"}>{workspaceToken(ticket.priority) ?? ticket.priority}</StaffPill></div></div><p className="text-sm text-student-muted">{ticket.ticket_number} · {SUPPORT_TOPIC_INFO[ticket.topic ?? topicForTicket(null, ticket.category)].label}</p>{formatWorkspaceDateTime(ticket.created_at) ? <p className="text-xs text-student-muted">Opened {formatWorkspaceDateTime(ticket.created_at)}</p> : null}</StaffCard></li>)}</ul>
       </WorkspaceResourceState>
     </section>
    </StaffTabPanel>
  </StaffPage>;
}
