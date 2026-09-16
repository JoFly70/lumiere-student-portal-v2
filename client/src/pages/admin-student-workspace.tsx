import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { AlertCircle, ArrowLeft, ChevronDown, Fingerprint, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ADMIN_STUDENT_WORKSPACE_QUERY_KEY,
  attentionItemLabel,
  attentionItemStatus,
  selectWorkspaceState,
  type WorkspaceAttentionItem,
  type WorkspaceRecord,
} from "./admin-student-workspace-presentation";

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
export default function AdminStudentWorkspace() {
  const { studentId = "" } = useParams<{ studentId: string }>();
  const query = useQuery({ queryKey: ADMIN_STUDENT_WORKSPACE_QUERY_KEY(studentId) });
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
  return <div className="mx-auto max-w-6xl space-y-6">
    <Link href="/admin" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Back to Students</Link>
    <header className="flex flex-col justify-between gap-4 border-b border-border/70 pb-6 md:flex-row md:items-end">
      <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Lumière / student workspace</p><h1 className="text-3xl font-semibold tracking-tight">{name}</h1><p className="mt-1 text-muted-foreground">{value(student, "email")} · <span className="font-mono">{value(student, "student_code", "studentCode")}</span></p></div>
      <Badge variant="outline" className="w-fit gap-2"><ShieldCheck className="h-3.5 w-3.5" />Read-only canonical view</Badge>
    </header>
    <section className="grid gap-4 md:grid-cols-3">
       <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">Current program</CardTitle></CardHeader><CardContent><p className="text-lg font-semibold">{label("programs", value(vm.program, "id")) ?? value(vm.program, "name", "code")}</p><p className="mt-1 text-sm text-muted-foreground">Version {label("programVersions", value(vm.programVersion, "id")) ?? value(vm.programVersion, "versionLabel", "id")}</p></CardContent></Card>
       <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">Progress status</CardTitle></CardHeader><CardContent><p className="text-lg font-semibold">{value(vm.report, "status")}</p><p className="mt-1 text-sm text-muted-foreground">Canonical degree-progress result</p></CardContent></Card>
       <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">Snapshot</CardTitle></CardHeader><CardContent><p className="text-sm">{String(snapshot.asOf ?? vm.asOf ?? "As-of unavailable")}</p><p className="mt-2 flex items-center gap-1 truncate font-mono text-xs text-muted-foreground"><Fingerprint className="h-3.5 w-3.5 shrink-0" />{String(snapshot.fingerprint ?? vm.snapshotFingerprint ?? "Fingerprint unavailable")}</p></CardContent></Card>
    </section>
     <Card className={vm.attention.hasAttention ? "border-amber-500/40" : ""}><CardHeader><div className="flex items-center justify-between"><div><CardTitle>Needs attention</CardTitle><p className="mt-1 text-sm text-muted-foreground">Prioritized items retained from the canonical report.</p></div><Badge variant={vm.attention.hasAttention ? "destructive" : "secondary"}>{vm.attention.total} items</Badge></div></CardHeader><CardContent>{vm.attention.total === 0 ? <div className="rounded-md bg-muted/50 px-4 py-8 text-center text-sm text-muted-foreground">No manual-review, conflict, missing, or partial items reported.</div> : <div className="divide-y">{vm.attention.items.map((item, i) => <div key={i} className="py-3">{("kind" in item) ? <div className="flex items-center gap-2"><Badge variant="outline">MANUAL_REVIEW</Badge><span className="font-medium">{item.kind === "integration-diagnostic" ? "Integration diagnostic" : "Diagnostic"}</span><span className="text-sm text-muted-foreground">{typeof item.diagnostic === "object" ? JSON.stringify(item.diagnostic) : String(item.diagnostic)}</span></div> : <><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{attentionItemStatus(vm, item)}</Badge><span className="font-medium">{attentionItemLabel(vm.labels, item)}</span>{item.reason && <span className="text-sm text-muted-foreground">· {item.reason}</span>}</div><Evidence item={item} /></>}</div>)}</div>}</CardContent></Card>
    <Card><CardHeader><CardTitle>Report provenance</CardTitle></CardHeader><CardContent className="grid gap-4 text-sm md:grid-cols-3"><div><p className="text-muted-foreground">Report status</p><p className="mt-1 font-medium">{vm.provenance.reportStatus}</p></div><div><p className="text-muted-foreground">Reasons</p><p className="mt-1 font-medium">{vm.provenance.reasons.length || "None reported"}</p></div><div><p className="text-muted-foreground">Diagnostics</p><p className="mt-1 font-medium">{vm.provenance.integrationDiagnostics.length + vm.provenance.diagnostics.length || "None reported"}</p></div></CardContent></Card>
  </div>;
}