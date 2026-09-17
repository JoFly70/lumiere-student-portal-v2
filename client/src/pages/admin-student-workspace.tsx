import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useParams, Link } from "wouter";
import { AlertCircle, ArrowLeft, ChevronDown, Database, FileCheck2, Fingerprint, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlacementActionDialog } from "@/components/placement-action-dialog";
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
  type WorkspaceAttentionItem,
  type WorkspaceRecord,
} from "./admin-student-workspace-presentation";
import {
  canCreatePlacement,
  canRevokePlacement,
  canSupersedePlacement,
  canonicalLabelOptions,
  placementWritesEnabled,
  validSnapshotFingerprint,
} from "./controlled-placement-workflow";

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
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" && value ? value : "Not provided";
}
function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="mt-1 text-sm">{children}</dd></div>;
}
function Reference({ value: reference }: { value: unknown }) {
  if (typeof reference !== "string" || !reference) return null;
  return <p className="mt-2 font-mono text-[11px] text-muted-foreground">Reference: {reference}</p>;
}
export default function AdminStudentWorkspace() {
  const { studentId = "" } = useParams<{ studentId: string }>();
  const [snapshotUnavailable, setSnapshotUnavailable] = useState(false);
  const query = useQuery({
    queryKey: ADMIN_STUDENT_WORKSPACE_QUERY_KEY(studentId),
    ...ADMIN_STUDENT_WORKSPACE_QUERY_OPTIONS,
  });
  const state = selectWorkspaceState(query);
  if (state.kind === "loading") return <div role={state.role} aria-live={state.ariaLive} className="space-y-4"><span className="sr-only">Loading student workspace</span><div className="h-8 w-64 animate-pulse rounded bg-muted" /><div className="h-32 animate-pulse rounded-lg bg-muted" /><div className="h-64 animate-pulse rounded-lg bg-muted" /></div>;
  if (state.kind === "error") return <Card><CardContent className="flex flex-col items-center gap-3 py-16 text-center"><AlertCircle className="h-8 w-8 text-destructive" /><h2 className="text-lg font-semibold">Workspace unavailable</h2><p className="text-sm text-muted-foreground">The canonical student workspace could not be loaded.</p><Button onClick={() => query.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button></CardContent></Card>;
  if (state.kind === "empty") return <Card><CardContent className="flex flex-col items-center gap-3 py-16 text-center"><h2 className="text-lg font-semibold">{state.reason === "not-found" ? "Student workspace not found" : "Workspace unavailable"}</h2><p className="text-sm text-muted-foreground">{state.reason === "not-found" ? "There is no canonical workspace for this student." : "No workspace record is available for this student."}</p></CardContent></Card>;
  const vm = state.viewModel;
  const student = vm.student ?? {};
  const snapshot = vm.snapshot && typeof vm.snapshot === "object" && !Array.isArray(vm.snapshot) ? vm.snapshot as WorkspaceRecord : {};
  const label = (kind: "programs" | "programVersions" | "requirements", id: unknown): string | undefined => {
    const labels = vm.labels[kind];
    if (!labels || typeof labels !== "object" || Array.isArray(labels) || typeof id !== "string") return undefined;
    const entry = (labels as Record<string, unknown>)[id];
    return entry && typeof entry === "object" && !Array.isArray(entry) && typeof (entry as WorkspaceRecord).label === "string"
      ? String((entry as WorkspaceRecord).label) : undefined;
  };
  const name = value(student, "preferred_name", "preferredName") !== "Not provided" ? value(student, "preferred_name", "preferredName") : `${value(student, "first_name", "firstName")} ${value(student, "last_name", "lastName")}`;
  const academicRows = academicCreditRows(vm.academicDetail);
  const snapshotFingerprint = validSnapshotFingerprint(vm.snapshotFingerprint)
    ? vm.snapshotFingerprint
    : validSnapshotFingerprint(snapshot.fingerprint)
      ? snapshot.fingerprint
      : undefined;
  const requirementOptions = canonicalLabelOptions(vm.labels.requirements);
  const academicRuleOptions = canonicalLabelOptions(vm.labels.academicRules);
  const writesDisabled = !placementWritesEnabled(
    snapshotFingerprint,
    snapshotUnavailable,
    query.isFetching,
  );
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
    const requirementId = placement.requirementId;
    const academicRuleId = placement.academicRuleId;
    return label("requirements", requirementId)
      ?? (typeof academicRuleId === "string"
        ? vm.labels.academicRules[academicRuleId]?.label
        : undefined)
      ?? "Canonical placement";
  };
  return <div className="mx-auto max-w-6xl space-y-6">
    <Link href={ADMIN_STUDENTS_PATH} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Back to Students</Link>
    <header className="flex flex-col justify-between gap-4 border-b border-border/70 pb-6 md:flex-row md:items-end">
      <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Lumière / student workspace</p><h1 className="text-3xl font-semibold tracking-tight">{name}</h1><p className="mt-1 text-muted-foreground">{value(student, "email")} · <span className="font-mono">{value(student, "student_code", "studentCode")}</span></p></div>
      <Badge variant="outline" className="w-fit gap-2"><ShieldCheck className="h-3.5 w-3.5" />Canonical view · controlled placement writes</Badge>
    </header>
    <section className="grid gap-4 md:grid-cols-3">
       <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">Current program</CardTitle></CardHeader><CardContent><p className="text-lg font-semibold">{label("programs", value(vm.program, "id")) ?? value(vm.program, "name", "code")}</p><p className="mt-1 text-sm text-muted-foreground">Version {label("programVersions", value(vm.programVersion, "id")) ?? value(vm.programVersion, "versionLabel", "id")}</p></CardContent></Card>
       <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">Progress status</CardTitle></CardHeader><CardContent><p className="text-lg font-semibold">{value(vm.report, "status")}</p><p className="mt-1 text-sm text-muted-foreground">Canonical degree-progress result</p></CardContent></Card>
       <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">Snapshot</CardTitle></CardHeader><CardContent><p className="text-sm">{String(snapshot.asOf ?? vm.asOf ?? "As-of unavailable")}</p><p className="mt-2 flex items-center gap-1 truncate font-mono text-xs text-muted-foreground"><Fingerprint className="h-3.5 w-3.5 shrink-0" />{String(snapshot.fingerprint ?? vm.snapshotFingerprint ?? "Fingerprint unavailable")}</p></CardContent></Card>
    </section>
    {!snapshotFingerprint || snapshotUnavailable
      ? <div role="status" className="flex flex-col gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-900 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
          <span>Placement controls are disabled until a fresh canonical snapshot with a valid fingerprint is available.</span>
          <Button type="button" size="sm" variant="outline" disabled={query.isFetching} onClick={() => void refreshCanonical()}>
            <RefreshCw className={`mr-2 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
            Refresh workspace
          </Button>
        </div>
      : null}
      <Card className={vm.attention.hasAttention ? "border-amber-500/40" : ""}><CardHeader><div className="flex items-center justify-between"><div><CardTitle>Needs attention</CardTitle><p className="mt-1 text-sm text-muted-foreground">Prioritized items retained from the canonical report.</p></div><Badge variant={vm.attention.hasAttention ? "destructive" : "secondary"}>{vm.attention.total} items</Badge></div></CardHeader><CardContent>{vm.attention.total === 0 ? <div className="rounded-md bg-muted/50 px-4 py-8 text-center text-sm text-muted-foreground">No manual-review, conflict, missing, or partial items reported.</div> : <div className="divide-y">{vm.attention.items.map((item, i) => <div key={i} className="py-3">{isDiagnosticAttentionItem(item) ? <div className="flex items-center gap-2">{diagnosticItemStatus(item) && <Badge variant="outline">{diagnosticItemStatus(item)}</Badge>}<span className="font-medium">{item.kind === "integration-diagnostic" ? "Integration diagnostic" : "Diagnostic"}</span><span className="text-sm text-muted-foreground">{typeof item.diagnostic === "object" ? JSON.stringify(item.diagnostic) : String(item.diagnostic)}</span></div> : <><div className="flex flex-wrap items-center gap-2">{attentionItemStatus(vm, item) && <Badge variant="outline">{attentionItemStatus(vm, item)}</Badge>}<span className="font-medium">{attentionItemLabel(vm.labels, item)}</span>{item.reason && <span className="text-sm text-muted-foreground">· {item.reason}</span>}</div><Evidence item={item} /></>}</div>)}</div>}</CardContent></Card>
    <section aria-labelledby="operator-academic-detail" className="space-y-4">
      <div>
        <h2 id="operator-academic-detail" className="text-xl font-semibold">Operator academic detail</h2>
        <p className="mt-1 text-sm text-muted-foreground">Canonical source, credit, latest verification, latest decision, and placement records. No academic values are recomputed here.</p>
      </div>
      {academicRows.length === 0
        ? <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No canonical credit records are available.</CardContent></Card>
        : academicRows.map((row) => {
          const credit = row.creditRecord;
          const source = row.source;
          const verification = row.latestVerification;
          const decision = row.latestDecision;
          return <Card key={String(credit.id)}>
            <CardHeader className="space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><CardTitle>{value(credit, "rawCourseCode") !== "Not provided" ? `${value(credit, "rawCourseCode")} · ${value(credit, "rawTitle")}` : value(credit, "rawTitle")}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{value(credit, "term")} · {value(credit, "recordType")}</p></div>
                <Badge variant="outline">{value(credit, "status")}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <dl className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <DetailField label="Source"><span className="font-medium">{source ? value(source, "title") : "Source unavailable"}</span><span className="block text-muted-foreground">{source ? `${value(source, "sourceType")} · ${value(source, "status")}` : "Canonical source record not supplied"}</span></DetailField>
                <DetailField label="Credit"><span className="font-medium">{value(credit, "normalizedCredits", "rawCredits")} credits</span><span className="block text-muted-foreground">Grade {value(credit, "rawGrade")} · Level {value(credit, "normalizedLevel", "rawLevel")}</span></DetailField>
                <DetailField label="Latest verification">{verification ? <><Badge variant="secondary">{value(verification, "action")}</Badge><span className="mt-1 block text-muted-foreground">{displayDate(verification.createdAt)}</span></> : "No verification recorded"}</DetailField>
                <DetailField label="Latest decision">{decision ? <><Badge variant="secondary">{value(decision, "action")}</Badge><span className="mt-1 block text-muted-foreground">{value(decision, "creditsAwarded")} credits awarded · {displayDate(decision.createdAt)}</span></> : "No decision for the active assignment"}</DetailField>
              </dl>
              <div className="border-t pt-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold"><FileCheck2 className="h-4 w-4" />Placement</h3>
                  {canCreatePlacement(decision)
                    ? <PlacementActionDialog
                        operation="create"
                        studentId={studentId}
                        snapshotFingerprint={snapshotFingerprint ?? ""}
                        decisionId={String(decision!.id)}
                        requirements={requirementOptions}
                        academicRules={academicRuleOptions}
                        disabled={writesDisabled}
                        onRefreshCanonical={refreshCanonical}
                        onSnapshotUnavailable={() => setSnapshotUnavailable(true)}
                      />
                    : null}
                </div>
                {row.placements.length === 0
                  ? <p className="mt-2 text-sm text-muted-foreground">No placement tied to the latest decision.</p>
                  : <div className="mt-3 grid gap-3 md:grid-cols-2">{row.placements.map((placement) => <div key={String(placement.id)} className="rounded-md border bg-muted/20 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{placementLabel(placement)}</span><Badge variant="outline">{value(placement, "status")}</Badge></div><p className="mt-2 text-sm text-muted-foreground">{value(placement, "rationale")}</p>{canSupersedePlacement(placement, decision) || canRevokePlacement(placement) ? <div className="mt-3 flex flex-wrap gap-2">{canSupersedePlacement(placement, decision) ? <PlacementActionDialog operation="supersede" studentId={studentId} snapshotFingerprint={snapshotFingerprint ?? ""} placementId={String(placement.id)} requirements={requirementOptions} academicRules={academicRuleOptions} disabled={writesDisabled} onRefreshCanonical={refreshCanonical} onSnapshotUnavailable={() => setSnapshotUnavailable(true)} /> : null}{canRevokePlacement(placement) ? <PlacementActionDialog operation="revoke" studentId={studentId} snapshotFingerprint={snapshotFingerprint ?? ""} placementId={String(placement.id)} requirements={requirementOptions} academicRules={academicRuleOptions} disabled={writesDisabled} onRefreshCanonical={refreshCanonical} onSnapshotUnavailable={() => setSnapshotUnavailable(true)} /> : null}</div> : null}<details className="mt-3"><summary className="cursor-pointer text-xs font-medium">Lifecycle & provenance</summary><dl className="mt-3 grid gap-3 sm:grid-cols-2"><DetailField label="Recorded">{displayDate(placement.createdAt)}</DetailField><DetailField label="Updated">{displayDate(placement.updatedAt)}</DetailField><DetailField label="Revocation">{value(placement, "revocationRationale")}</DetailField><DetailField label="Supersession">{value(placement, "supersedeRationale")}</DetailField></dl><pre className="mt-3 overflow-auto rounded bg-muted p-3 text-xs text-muted-foreground">{JSON.stringify({ provenance: placement.provenance, metadata: placement.metadata }, null, 2)}</pre><Reference value={placement.id} /></details></div>)}</div>}
              </div>
              <details className="border-t pt-4">
                <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold"><Database className="h-4 w-4" />Provenance references</summary>
                <div className="mt-3 grid gap-3 md:grid-cols-3"><Reference value={source?.id} /><Reference value={credit.id} /><Reference value={decision?.basisClaimVersionId} /></div>
              </details>
            </CardContent>
          </Card>;
        })}
    </section>
    {vm.academicDetail.placements.filter((placement) => !academicRows.some((row) => row.placements.includes(placement))).length > 0 && <Card><CardHeader><CardTitle>Historical placement records</CardTitle><p className="text-sm text-muted-foreground">Placements retained for earlier canonical decisions in this active assignment.</p></CardHeader><CardContent className="divide-y">{vm.academicDetail.placements.filter((placement) => !academicRows.some((row) => row.placements.includes(placement))).map((placement) => <div key={String(placement.id)} className="py-3"><div className="flex items-center justify-between gap-2"><span className="font-medium">{placementLabel(placement)}</span><Badge variant="outline">{value(placement, "status")}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{value(placement, "rationale")}</p>{canRevokePlacement(placement) ? <div className="mt-3"><PlacementActionDialog operation="revoke" studentId={studentId} snapshotFingerprint={snapshotFingerprint ?? ""} placementId={String(placement.id)} requirements={requirementOptions} academicRules={academicRuleOptions} disabled={writesDisabled} onRefreshCanonical={refreshCanonical} onSnapshotUnavailable={() => setSnapshotUnavailable(true)} /></div> : null}<details className="mt-2"><summary className="cursor-pointer text-xs font-medium">Lifecycle & provenance</summary><pre className="mt-2 overflow-auto rounded bg-muted p-3 text-xs text-muted-foreground">{JSON.stringify({ provenance: placement.provenance, metadata: placement.metadata, supersedesPlacementId: placement.supersedesPlacementId, supersededByPlacementId: placement.supersededByPlacementId }, null, 2)}</pre><Reference value={placement.id} /></details></div>)}</CardContent></Card>}
    <Card><CardHeader><CardTitle>Report provenance</CardTitle></CardHeader><CardContent className="grid gap-4 text-sm md:grid-cols-3"><div><p className="text-muted-foreground">Report status</p><p className="mt-1 font-medium">{vm.provenance.reportStatus}</p></div><div><p className="text-muted-foreground">Reasons</p><p className="mt-1 font-medium">{vm.provenance.reasons.length || "None reported"}</p></div><div><p className="text-muted-foreground">Diagnostics</p><p className="mt-1 font-medium">{vm.provenance.integrationDiagnostics.length + vm.provenance.diagnostics.length || "None reported"}</p></div></CardContent></Card>
  </div>;
}