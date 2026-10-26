import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { AlertCircle, ArrowLeft, CheckCircle2, FileSpreadsheet, Loader2, RefreshCw } from "lucide-react";
import type { AdminRoadmapDraftView, AdminRoadmapState, RoadmapException, RoadmapItem } from "@shared/student-roadmap-contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  buildReviewPlan, groupAckState, groupSelectionState, toggleGroupSelection, REVIEW_CATEGORY_LABEL, type ReviewGroup,
} from "@shared/student-roadmap-review-groups";
import { useAuth } from "@/lib/auth";
import { adminRoadmapApi, RoadmapApiError } from "@/lib/admin-roadmap-api";
import {
  ADMIN_ROADMAP_QUERY_KEY, acknowledgeBody, acknowledgedKeys, applyItemForm, diffHeadline, discardBody,
  exceptionLocation, exceptionsByItem, groupExceptions, itemToForm, parsePastedPackage, publishBody, publishGate,
  itemFacts, removeItemFromContent, reportedHistoryLine, saveDraftBody, type ItemFormValues,
} from "@/lib/admin-roadmap-logic";

type PendingImport = { kind: "file"; file: File; companion?: File | null } | { kind: "package"; pkg: unknown };

const SEVERITY_LABEL = { blocking: "Blocking — must be fixed", warning: "Warnings — acknowledge before publishing", info: "Information" } as const;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function formatDate(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "—";
}

export default function AdminStudentRoadmap() {
  const { studentId = "" } = useParams<{ studentId: string }>();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const queryClient = useQueryClient();
  const queryKey = ADMIN_ROADMAP_QUERY_KEY(studentId);

  const query = useQuery<AdminRoadmapState>({ queryKey, queryFn: () => adminRoadmapApi.get(studentId), staleTime: Infinity });
  const state = query.data ?? null;
  const draft = state?.draft ?? null;

  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);
  const [packageText, setPackageText] = useState("");
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [confirm, setConfirm] = useState<null | "publish" | "discard">(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [ackNote, setAckNote] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [form, setForm] = useState<ItemFormValues | null>(null);
  const [removeKey, setRemoveKey] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const companionRef = useRef<HTMLInputElement>(null);

  const apply = (next: AdminRoadmapState) => {
    queryClient.setQueryData(queryKey, next);
    setSelectedKeys(new Set());
  };

  async function run(label: string, action: () => Promise<AdminRoadmapState>, success?: string): Promise<boolean> {
    setBusy(label);
    setMessage(null);
    try {
      apply(await action());
      if (success) setMessage({ tone: "success", text: success });
      return true;
    } catch (err) {
      if (err instanceof RoadmapApiError) {
        if (err.failure.kind === "stale" || err.failure.kind === "not_publishable") {
          await query.refetch(); // authoritative state replaces anything stale
        }
        setMessage({ tone: "error", text: err.failure.message });
      } else {
        setMessage({ tone: "error", text: "Something went wrong. Check your connection and try again." });
      }
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function startImport(pending: PendingImport, replaceDraft: boolean) {
    setBusy("import");
    setMessage(null);
    try {
      const next = pending.kind === "file"
        ? await adminRoadmapApi.importWorkbook(studentId, pending.file, replaceDraft, pending.companion)
        : await adminRoadmapApi.importPackage(studentId, pending.pkg, replaceDraft);
      apply(next);
      setPendingImport(null);
      setShowPreview(false);
      if (fileRef.current) fileRef.current.value = "";
      if (companionRef.current) companionRef.current.value = "";
      setMessage({ tone: "success", text: "Import converted into a draft. Review the exceptions below before publishing." });
    } catch (err) {
      if (err instanceof RoadmapApiError && err.failure.kind === "draft_exists") {
        setPendingImport(pending); // ask before replacing
      } else {
        setPendingImport(null);
        setMessage({ tone: "error", text: err instanceof RoadmapApiError ? err.failure.message : "The import failed. Try again." });
      }
    } finally {
      setBusy(null);
    }
  }

  const onUploadFile = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return setMessage({ tone: "error", text: "Choose an .xlsx workbook first." });
    void startImport({ kind: "file", file, companion: companionRef.current?.files?.[0] ?? null }, false);
  };
  const onImportPackage = () => {
    try {
      void startImport({ kind: "package", pkg: parsePastedPackage(packageText) }, false);
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Invalid package." });
    }
  };

  const grouped = useMemo(() => groupExceptions(draft?.exceptions ?? []), [draft]);
  const acked = useMemo(() => acknowledgedKeys(draft?.acknowledgements ?? []), [draft]);
  const itemIssues = useMemo(() => exceptionsByItem(draft?.exceptions ?? []), [draft]);
  const gate = publishGate(draft, isAdmin, busy !== null);

  const editingItem: RoadmapItem | undefined = draft?.content.items.find((i) => i.key === editingKey);

  function openEditor(item: RoadmapItem) {
    setEditingKey(item.key);
    setForm(itemToForm(item));
  }
  async function saveEditor() {
    if (!draft || !editingKey || !form) return;
    const ok = await run("save", () => adminRoadmapApi.saveDraft(studentId, saveDraftBody(draft.draftRevision, applyItemForm(draft.content, editingKey, form))), "Draft saved and re-validated.");
    if (ok) {
      setEditingKey(null);
      setForm(null);
    }
  }

  if (query.isLoading) {
    return <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" />Loading roadmap…</div>;
  }
  if (query.isError || !state) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Link href={`/admin/students/${encodeURIComponent(studentId)}`} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Back to student</Link>
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
          <p>The roadmap could not be loaded.</p>
          <Button className="mt-3" type="button" size="sm" variant="outline" onClick={() => void query.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-6">
      <Link href={`/admin/students/${encodeURIComponent(studentId)}`} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Back to student</Link>
      <header className="border-b border-border/70 pb-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Lumière / student roadmap</p>
        <h1 className="text-3xl font-semibold tracking-tight">Roadmap</h1>
        <p className="mt-1 text-sm text-muted-foreground">Upload Excel, convert, review exceptions, preview, then publish. Nothing imported is an institutional decision; credit comes only from the verified academic record.</p>
      </header>

      <div aria-live="polite">
        {message && (
          <div role={message.tone === "error" ? "alert" : "status"} className={`flex items-start gap-2 rounded-md border px-4 py-3 text-sm ${message.tone === "error" ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/40"}`}>
            {message.tone === "error" ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
            <span>{message.text}</span>
          </div>
        )}
      </div>

      {/* Published + history */}
      <section aria-labelledby="published-heading" className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle id="published-heading" className="text-base">Current published version</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {state.published ? (
              <>
                <p className="break-words text-lg font-semibold">{state.published.title}</p>
                <p className="break-words text-muted-foreground">Version {state.published.versionNumber} · published {formatDate(state.published.publishedAt)}</p>
                <p className="text-muted-foreground">{state.published.content.items.length} items in {state.published.content.phases.length} phases</p>
                {!draft && (
                  <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => void run("from-published", () => adminRoadmapApi.fromPublished(studentId), "Opened a draft copied from the published version.")}>
                    Edit published as new draft
                  </Button>
                )}
              </>
            ) : <p className="text-muted-foreground">Nothing is published yet. The student sees no roadmap until you publish a draft.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Version history</CardTitle></CardHeader>
          <CardContent>
            {state.versions.length === 0 ? <p className="text-sm text-muted-foreground">No versions yet.</p> : (
              <ul className="divide-y text-sm">
                {state.versions.map((v) => (
                  <li key={v.versionId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>v{v.versionNumber} · {v.title}</span>
                    <span className="flex items-center gap-2 text-muted-foreground"><Badge variant="outline">{v.status}</Badge>{formatDate(v.publishedAt ?? v.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Import */}
      <section aria-labelledby="import-heading">
        <Card>
          <CardHeader>
            <CardTitle id="import-heading" className="flex items-center gap-2 text-base"><FileSpreadsheet className="h-4 w-4" />Import</CardTitle>
            <CardDescription>Creates a draft only. Start from the lumiere-roadmap-v1 template (docs/templates).</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <Label htmlFor="roadmap-workbook">Excel workbook (.xlsx)</Label>
              <Input id="roadmap-workbook" ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
              <Label htmlFor="roadmap-companion">Execution workbook (companion, optional)</Label>
              <Input id="roadmap-companion" ref={companionRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
              <p className="text-xs text-muted-foreground">Add the weekly execution schedule next to the master academic workbook to get ONE draft. Execution rows are matched to master courses and never added as new courses.</p>
              <Button type="button" disabled={busy !== null} onClick={onUploadFile}>{busy === "import" ? "Converting…" : "Upload and convert"}</Button>
            </div>
            <div className="space-y-3">
              <Label htmlFor="roadmap-package">AI package (JSON from ChatGPT, Claude, …)</Label>
              <Textarea id="roadmap-package" rows={5} value={packageText} onChange={(e) => setPackageText(e.target.value)} placeholder='{"format":"lumiere-roadmap-package/1", …}' className="font-mono text-xs" />
              <Button type="button" variant="outline" disabled={busy !== null} onClick={onImportPackage}>Convert package</Button>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Draft review */}
      {draft && (
        <DraftReview
          draft={draft}
          grouped={grouped}
          acked={acked}
          selectedKeys={selectedKeys}
          setSelectedKeys={setSelectedKeys}
          ackNote={ackNote}
          setAckNote={setAckNote}
          busy={busy}
          itemIssues={itemIssues}
          onAcknowledge={() => void run("ack", () => adminRoadmapApi.acknowledge(studentId, acknowledgeBody(draft.draftRevision, [...selectedKeys], ackNote)), "Warnings acknowledged.").then((ok) => ok && setAckNote(""))}
          onEdit={openEditor}
          onRemove={setRemoveKey}
        />
      )}

      {draft && (
        <section aria-labelledby="actions-heading">
          <Card>
            <CardHeader><CardTitle id="actions-heading" className="text-base">Preview and publish</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" aria-pressed={showPreview} onClick={() => setShowPreview((v) => !v)}>{showPreview ? "Hide preview" : "Preview as student"}</Button>
                <Button type="button" disabled={!gate.enabled} aria-describedby="publish-reason" onClick={() => setConfirm("publish")}>Publish</Button>
                <Button type="button" variant="outline" disabled={busy !== null} onClick={() => setConfirm("discard")}>Discard draft</Button>
              </div>
              <p id="publish-reason" className="text-sm text-muted-foreground">{gate.reason ?? "Ready to publish. Publishing creates a new immutable version; student progress is kept."}</p>
              {showPreview && <PreviewPanel studentId={studentId} draftRevision={draft.draftRevision} />}
            </CardContent>
          </Card>
        </section>
      )}

      {/* Replace draft confirmation (409 ROADMAP_DRAFT_EXISTS) */}
      <AlertDialog open={pendingImport !== null} onOpenChange={(o) => !o && setPendingImport(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace the open draft?</AlertDialogTitle>
            <AlertDialogDescription>A draft already exists for this student. Importing again discards that draft, including any edits and acknowledgements. The published version is not affected.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current draft</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingImport && void startImport(pendingImport, true)}>Replace draft</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirm === "publish"} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish this roadmap?</AlertDialogTitle>
            <AlertDialogDescription>The student will immediately follow this version. Existing progress stays attached to items with the same key; progress on removed items is preserved in history only.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => draft && void run("publish", () => adminRoadmapApi.publish(studentId, publishBody(draft.draftRevision, state.published?.versionId ?? null)), "Roadmap published.").then(() => setShowPreview(false))}>Publish</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirm === "discard"} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this draft?</AlertDialogTitle>
            <AlertDialogDescription>The draft, its edits and acknowledgements are removed. The published version is unchanged.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => draft && void run("discard", () => adminRoadmapApi.discard(studentId, discardBody(draft.draftRevision)), "Draft discarded.").then(() => setShowPreview(false))}>Discard draft</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={removeKey !== null} onOpenChange={(o) => !o && setRemoveKey(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove "{draft?.content.items.find((i) => i.key === removeKey)?.title}" from the draft?</AlertDialogTitle>
            <AlertDialogDescription>Other items that depend on it will show a blocking exception until fixed. Any student progress on it is preserved in history and is not transferred to another item.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const key = removeKey; setRemoveKey(null); if (draft && key) void run("save", () => adminRoadmapApi.saveDraft(studentId, saveDraftBody(draft.draftRevision, removeItemFromContent(draft.content, key))), "Item removed from the draft."); }}>Remove item</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={editingItem !== undefined && form !== null} onOpenChange={(o) => { if (!o) { setEditingKey(null); setForm(null); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit item</DialogTitle>
            <DialogDescription>Key <span className="font-mono">{editingItem?.key}</span> stays the same so student progress is kept.</DialogDescription>
          </DialogHeader>
          {form && draft && (
            <div className="grid gap-4">
              <Field id="edit-title" label="Title"><Input id="edit-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
              <Field id="edit-code" label="Code"><Input id="edit-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
              <Field id="edit-phase" label="Phase">
                <Select value={form.phaseKey} onValueChange={(v) => setForm({ ...form, phaseKey: v })}>
                  <SelectTrigger id="edit-phase"><SelectValue /></SelectTrigger>
                  <SelectContent>{draft.content.phases.map((p) => <SelectItem key={p.key} value={p.key}>{p.title}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field id="edit-objective" label="Objective">
                <Select value={form.objectiveKey} onValueChange={(v) => setForm({ ...form, objectiveKey: v })}>
                  <SelectTrigger id="edit-objective"><SelectValue /></SelectTrigger>
                  <SelectContent>{draft.content.objectives.map((o) => <SelectItem key={o.key} value={o.key}>{o.title}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field id="edit-start" label="Planned start"><Input id="edit-start" type="date" value={form.plannedStart} onChange={(e) => setForm({ ...form, plannedStart: e.target.value })} /></Field>
                <Field id="edit-end" label="Planned end"><Input id="edit-end" type="date" value={form.plannedEnd} onChange={(e) => setForm({ ...form, plannedEnd: e.target.value })} /></Field>
              </div>
              <Field id="edit-status" label="Plan status">
                <Select value={form.planStatus} onValueChange={(v) => setForm({ ...form, planStatus: v as ItemFormValues["planStatus"] })}>
                  <SelectTrigger id="edit-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(["planned", "hold", "alternative", "dropped"] as const).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              {form.planStatus === "hold" && (
                <Field id="edit-hold" label="Hold reason (shown to the student)"><Input id="edit-hold" value={form.holdReason} onChange={(e) => setForm({ ...form, holdReason: e.target.value })} /></Field>
              )}
              <Field id="edit-depends" label="Depends on (item keys, comma separated)"><Input id="edit-depends" value={form.dependsOn} onChange={(e) => setForm({ ...form, dependsOn: e.target.value })} className="font-mono" /></Field>
            </div>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="outline" className="text-destructive" onClick={() => { setRemoveKey(editingKey); setEditingKey(null); setForm(null); }}>Remove item</Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => { setEditingKey(null); setForm(null); }}>Cancel</Button>
              <Button type="button" disabled={busy !== null} onClick={() => void saveEditor()}>Save changes</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label>{children}</div>;
}

interface DraftReviewProps {
  draft: AdminRoadmapDraftView;
  grouped: ReturnType<typeof groupExceptions>;
  acked: Set<string>;
  selectedKeys: Set<string>;
  setSelectedKeys: (s: Set<string>) => void;
  ackNote: string;
  setAckNote: (s: string) => void;
  busy: string | null;
  itemIssues: Map<string, RoadmapException[]>;
  onAcknowledge: () => void;
  onEdit: (item: RoadmapItem) => void;
  onRemove: (key: string) => void;
}

function DraftReview(props: DraftReviewProps) {
  const { draft, acked, selectedKeys, setSelectedKeys, ackNote, setAckNote, busy, itemIssues } = props;
  const src = draft.import;
  const removedProgress = new Set(draft.diff.removed.filter((r) => r.hasProgress).map((r) => r.itemKey));

  return (
    <section aria-labelledby="draft-heading" className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle id="draft-heading" className="flex flex-wrap items-center gap-2 text-base">
            Draft v{draft.versionNumber} · {draft.content.title}
            <Badge variant={draft.publishable ? "secondary" : "outline"}>{draft.publishable ? "Publishable" : "Not publishable yet"}</Badge>
          </CardTitle>
          <CardDescription>
            {src
              ? `Imported from ${src.fileName ?? src.summary.generator ?? "package"} (${src.templateId}): ${src.summary.rowsRead} rows read, ${src.summary.rowsConverted} converted, ${src.summary.rowsSkipped} skipped.`
              : "Opened from the published version for manual edits."}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {plural(draft.content.objectives.length, "objective")} · {plural(draft.content.phases.length, "phase")} · {plural(draft.content.items.length, "item")} · {plural(draft.content.milestones.length, "milestone")}
        </CardContent>
      </Card>

      <ReviewPanel
        draft={draft}
        acked={acked}
        selectedKeys={selectedKeys}
        setSelectedKeys={setSelectedKeys}
        ackNote={ackNote}
        setAckNote={setAckNote}
        busy={busy}
        onAcknowledge={props.onAcknowledge}
      />

      {draft.content.reportedHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Reported history (not credit)</CardTitle>
            <CardDescription>Staff only. Prior education and completed work as REPORTED by the workbook. It is unverified, is never shown to the student and never counts as credit; the verified academic record is the only credit authority.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-md border text-sm">
              {draft.content.reportedHistory.map((h) => (
                <li key={h.key} className="p-3">
                  <span className="font-medium">{h.title}</span>
                  <Badge variant="outline" className="ml-2">unverified</Badge>
                  <span className="block text-xs text-muted-foreground">{reportedHistoryLine(h)}</span>
                  {h.note && <span className="block text-xs text-muted-foreground">{h.note}</span>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Changes compared with the published plan</CardTitle>
          <CardDescription>{diffHeadline(draft.diff)}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {draft.diff.added.length > 0 && <DiffList title="Added" rows={draft.diff.added.map((a) => `${a.title} (${a.itemKey})`)} />}
          {draft.diff.removed.length > 0 && (
            <div>
              <h3 className="mb-1 font-semibold">Removed</h3>
              <ul className="space-y-1">
                {draft.diff.removed.map((r) => (
                  <li key={r.itemKey} className={r.hasProgress ? "rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2" : ""}>
                    {r.title} <span className="font-mono text-xs text-muted-foreground">({r.itemKey})</span>
                    {r.hasProgress && <span className="ml-2 font-medium">Student has progress here. It is kept in history and is not moved to any replacement.</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {draft.diff.changed.length > 0 && (
            <div>
              <h3 className="mb-1 font-semibold">Changed</h3>
              <ul className="space-y-1">
                {draft.diff.changed.map((c) => (
                  <li key={c.itemKey}>
                    {c.title} <span className="font-mono text-xs text-muted-foreground">{c.fields.join(", ")}</span>
                    {c.rescheduleOnly && <Badge variant="secondary" className="ml-2">reschedule only — harmless</Badge>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(draft.diff.objectivesAdded.length > 0 || draft.diff.objectivesRemoved.length > 0 || draft.diff.objectivesChanged.length > 0 || draft.diff.phasesChanged || draft.diff.milestonesChanged) && (
            <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
              {draft.diff.objectivesAdded.length > 0 && <li>Objectives added: {draft.diff.objectivesAdded.join(", ")}</li>}
              {draft.diff.objectivesRemoved.length > 0 && <li>Objectives removed: {draft.diff.objectivesRemoved.join(", ")}</li>}
              {draft.diff.objectivesChanged.length > 0 && <li>Objectives changed: {draft.diff.objectivesChanged.join(", ")}</li>}
              {draft.diff.phasesChanged && <li>Phases changed</li>}
              {draft.diff.milestonesChanged && <li>Milestones changed</li>}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Items</CardTitle><CardDescription>Edit the most common fixes here; use a new import for larger changes.</CardDescription></CardHeader>
        <CardContent>
          {draft.content.items.length === 0 ? <p className="text-sm text-muted-foreground">The draft has no items.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Draft roadmap items</caption>
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr><th scope="col" className="py-2 pr-3">Item</th><th scope="col" className="hidden py-2 pr-3 sm:table-cell">Phase</th><th scope="col" className="hidden py-2 pr-3 md:table-cell">Dates</th><th scope="col" className="py-2 pr-3">Status</th><th scope="col" className="py-2"><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody className="divide-y">
                  {draft.content.items.map((item) => {
                    const issues = itemIssues.get(item.key) ?? [];
                    return (
                      <tr key={item.key} className={removedProgress.has(item.key) ? "bg-amber-500/10" : ""}>
                        <td className="py-2 pr-3"><span className="font-medium">{item.title}</span>{item.code && <span className="text-muted-foreground"> · {item.code}</span>}<span className="block break-all font-mono text-xs text-muted-foreground">{item.key}</span>{itemFacts(item).map((f) => <span key={f} className="block text-xs text-muted-foreground">{f}</span>)}<span className="block text-xs text-muted-foreground sm:hidden">{phaseTitle(draft, item)} · {formatDate(item.plannedStart)} → {formatDate(item.plannedEnd)}</span></td>
                        <td className="hidden py-2 pr-3 sm:table-cell">{phaseTitle(draft, item)}<span className="block text-xs text-muted-foreground md:hidden">{formatDate(item.plannedStart)} → {formatDate(item.plannedEnd)}</span></td>
                        <td className="hidden whitespace-nowrap py-2 pr-3 md:table-cell">{formatDate(item.plannedStart)} → {formatDate(item.plannedEnd)}</td>
                        <td className="py-2 pr-3"><Badge variant="outline">{item.planStatus}</Badge>{issues.length > 0 && <Badge variant={issues.some((i) => i.severity === "blocking") ? "destructive" : "secondary"} className="ml-1">{issues.length} issue{issues.length === 1 ? "" : "s"}</Badge>}</td>
                        <td className="py-2 text-right"><Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => props.onEdit(item)} aria-label={`Edit ${item.title}`}>Edit</Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function phaseTitle(draft: AdminRoadmapDraftView, item: RoadmapItem): string {
  return draft.content.phases.find((p) => p.key === item.phaseKey)?.title ?? item.phaseKey;
}


/**
 * Review findings grouped for reading (S10): by issue type (severity order; academic uncertainty before operational
 * scheduling) or by course. Grouping only changes what staff read and click: every member keeps its own exception key and
 * acknowledging a group submits all of its open warning keys, so each warning is still recorded as acknowledged.
 */
export function ReviewPanel(props: {
  draft: AdminRoadmapDraftView;
  acked: Set<string>;
  selectedKeys: Set<string>;
  setSelectedKeys: (s: Set<string>) => void;
  ackNote: string;
  setAckNote: (s: string) => void;
  busy: string | null;
  onAcknowledge: () => void;
}) {
  const { draft, acked, selectedKeys, setSelectedKeys, ackNote, setAckNote, busy } = props;
  const [view, setView] = useState<"issue" | "course">("issue");
  const review = useMemo(() => buildReviewPlan(draft.exceptions, draft.content.items), [draft.exceptions, draft.content.items]);
  const warningKeys = useMemo(() => draft.exceptions.filter((e) => e.severity === "warning").map((e) => e.key), [draft.exceptions]);
  const openWarningKeys = warningKeys.filter((k) => !acked.has(k));
  const { raw, groups } = review.counts;
  const toggleKeys = (keys: readonly string[], on: boolean) => {
    const next = new Set(selectedKeys);
    for (const k of keys) {
      if (on && !acked.has(k)) next.add(k);
      else if (!on) next.delete(k);
    }
    setSelectedKeys(next);
  };

  const GroupRow = ({ g, selectable }: { g: ReviewGroup; selectable: boolean }) => {
    const ack = groupAckState(g, acked);
    const sel = groupSelectionState(g, selectedKeys, acked);
    const id = `grp-${g.id}`;
    return (
      <li className="p-3">
        <div className="flex items-start gap-3">
          {selectable && (
            <Checkbox
              id={id}
              checked={ack.state === "all" || sel === "all"}
              disabled={ack.state === "all" || busy !== null}
              onCheckedChange={(v) => setSelectedKeys(toggleGroupSelection(selectedKeys, g, acked, v === true))}
              aria-label={`Acknowledge ${g.title}${g.count > 1 ? `, ${g.count} findings` : ""}`}
              className="mt-1"
            />
          )}
          <div className="min-w-0 flex-1 text-sm">
            <label htmlFor={selectable ? id : undefined} className={selectable ? "cursor-pointer" : undefined}>
              <span className="font-medium">{g.title}</span>
              {g.count > 1 && <Badge variant="secondary" className="ml-2">×{g.count}</Badge>}
              {ack.state === "all" && <span className="ml-2 text-xs text-muted-foreground">acknowledged</span>}
              {ack.state === "partial" && <span className="ml-2 text-xs text-muted-foreground">{ack.acknowledged} of {g.count} acknowledged</span>}
              {sel === "some" && <span className="ml-2 text-xs text-muted-foreground">some selected</span>}
              <span className="mt-0.5 block">{g.count === 1 ? g.example : g.hint || g.example}</span>
            </label>
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                {g.count === 1 ? "Source" : `Show all ${g.count} (${g.courses.length > 0 ? `${plural(g.courses.length, "course")}` : "rows"}) with their sources`}
              </summary>
              <ul className="mt-1 space-y-1 border-l pl-3">
                {g.evidence.map((ev) => (
                  <li key={ev.key} className="text-xs">
                    {g.count > 1 && <span className="block">{ev.message}</span>}
                    <span className="block text-muted-foreground"><span className="font-mono">{g.code}</span>{ev.location && ` · ${ev.location}`}{acked.has(ev.key) ? " · acknowledged" : ""}</span>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        </div>
      </li>
    );
  };

  const section = (severity: "blocking" | "warning") => {
    const sec = review.sections[severity];
    if (sec.groupCount === 0) return null;
    const open = severity === "warning" ? openWarningKeys.length : 0;
    return (
      <div role="group" aria-label={SEVERITY_LABEL[severity]}>
        <h3 className={`mb-2 text-sm font-semibold ${severity === "blocking" ? "text-destructive" : ""}`}>
          {SEVERITY_LABEL[severity]} ({severity === "warning" ? `${plural(sec.groupCount, "group")} · ${open} of ${sec.exceptionCount} findings open` : `${plural(sec.groupCount, "group")} · ${sec.exceptionCount} findings`})
        </h3>
        <div className="space-y-4">
          {sec.categories.map((c) => (
            <div key={c.category}>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{REVIEW_CATEGORY_LABEL[c.category]} · {plural(c.groups.length, "group")}</h4>
              <ul className="divide-y rounded-md border">
                {c.groups.map((g) => <GroupRow key={g.id} g={g} selectable={severity === "warning"} />)}
              </ul>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Review findings</CardTitle>
        <CardDescription>
          {raw.total === 0
            ? "Nothing to review."
            : `${plural(raw.total, "finding")} in ${plural(groups.total, "group")}: ${groups.blocking} blocking, ${groups.warning} to acknowledge, ${groups.info} for information. Findings of the same kind are grouped; acknowledging a group acknowledges each finding in it.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {draft.exceptions.length === 0 && <p className="text-sm text-muted-foreground">No exceptions. Everything converted cleanly.</p>}
        {draft.exceptions.length > 0 && (
          <div role="group" aria-label="Group findings by" className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant={view === "issue" ? "default" : "outline"} aria-pressed={view === "issue"} onClick={() => setView("issue")}>By issue type</Button>
            <Button type="button" size="sm" variant={view === "course" ? "default" : "outline"} aria-pressed={view === "course"} onClick={() => setView("course")}>By course</Button>
          </div>
        )}
        {view === "issue" && (
          <>
            {section("blocking")}
            {section("warning")}
            {review.sections.info.groupCount > 0 && (
              <details>
                <summary className="cursor-pointer text-sm font-semibold">{SEVERITY_LABEL.info} ({plural(review.sections.info.groupCount, "group")} · {review.sections.info.exceptionCount} findings)</summary>
                <ul className="mt-2 divide-y rounded-md border">
                  {review.sections.info.categories.flatMap((c) => c.groups).map((g) => <GroupRow key={g.id} g={g} selectable={false} />)}
                </ul>
              </details>
            )}
          </>
        )}
        {view === "course" && (
          <ul className="space-y-2">
            {review.byCourse.map((c) => {
              const warnKeys = c.exceptions.filter((e) => e.severity === "warning").map((e) => e.key);
              const openKeys = warnKeys.filter((k) => !acked.has(k));
              return (
                <li key={c.itemKey ?? "__plan__"} className="rounded-md border">
                  <details open={c.severity !== "info"}>
                    <summary className="cursor-pointer p-3 text-sm font-medium">
                      {c.title}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">{plural(c.exceptions.length, "finding")} · {c.severity === "blocking" ? "blocking" : c.severity === "warning" ? `${openKeys.length} open warning${openKeys.length === 1 ? "" : "s"}` : "information only"}</span>
                    </summary>
                    <ul className="divide-y border-t">
                      {c.exceptions.map((e) => (
                        <li key={e.key} className="flex items-start gap-3 p-3 text-sm">
                          {e.severity === "warning" && (
                            <Checkbox
                              id={`ack-${e.key}`}
                              checked={acked.has(e.key) || selectedKeys.has(e.key)}
                              disabled={acked.has(e.key) || busy !== null}
                              onCheckedChange={(v) => toggleKeys([e.key], v === true)}
                              aria-label={`Acknowledge: ${e.message}`}
                              className="mt-1"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <span className="block">{e.message}</span>
                            <span className="block text-xs text-muted-foreground"><span className="font-mono">{e.code}</span> {exceptionLocation(e) && `· ${exceptionLocation(e)}`}{acked.has(e.key) ? " · acknowledged" : ""}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                    {openKeys.length > 0 && (
                      <div className="border-t p-2">
                        <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => toggleKeys(openKeys, true)}>Select this course's {openKeys.length} open warning{openKeys.length === 1 ? "" : "s"}</Button>
                      </div>
                    )}
                  </details>
                </li>
              );
            })}
          </ul>
        )}
        {openWarningKeys.length > 0 && (
          <div className="space-y-2">
            <Label htmlFor="ack-note">Note for the selected warnings (optional)</Label>
            <Input id="ack-note" value={ackNote} maxLength={500} onChange={(e) => setAckNote(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" disabled={selectedKeys.size === 0 || busy !== null} onClick={props.onAcknowledge}>Acknowledge selected ({selectedKeys.size} finding{selectedKeys.size === 1 ? "" : "s"})</Button>
              <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => setSelectedKeys(new Set(openWarningKeys))}>Select all open ({openWarningKeys.length})</Button>
              {selectedKeys.size > 0 && <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => setSelectedKeys(new Set())}>Clear selection</Button>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DiffList({ title, rows }: { title: string; rows: string[] }) {
  const list = <ul className="list-disc space-y-0.5 pl-5 break-words">{rows.map((r) => <li key={r}>{r}</li>)}</ul>;
  if (rows.length <= 5) return <div><h3 className="mb-1 font-semibold">{title}</h3>{list}</div>;
  return <details><summary className="cursor-pointer font-semibold">{title} ({rows.length})</summary><div className="mt-1">{list}</div></details>;
}

/** Deliberately compact, read-only: phases -> items with stage. The polished student UI lives elsewhere. */
function PreviewPanel({ studentId, draftRevision }: { studentId: string; draftRevision: number }) {
  const preview = useQuery({
    queryKey: ["admin-roadmap-preview", studentId, draftRevision],
    queryFn: () => adminRoadmapApi.preview(studentId),
    staleTime: Infinity,
  });
  if (preview.isLoading) return <p className="text-sm text-muted-foreground" role="status">Loading preview…</p>;
  if (preview.isError || !preview.data) {
    return <div role="alert" className="text-sm text-destructive">The preview could not be loaded. <Button type="button" size="sm" variant="outline" onClick={() => void preview.refetch()}>Retry</Button></div>;
  }
  const view = preview.data;
  return (
    <div className="space-y-4 rounded-md border bg-muted/30 p-4" aria-label="Student preview">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preview — what the student would see (not published)</p>
      <h3 className="text-lg font-semibold">{view.plan?.title}</h3>
      {view.plan?.summary && <p className="text-sm text-muted-foreground">{view.plan.summary}</p>}
      {view.phases.map((phase) => (
        <div key={phase.key}>
          <h4 className="text-sm font-semibold">{phase.title} <span className="font-normal text-muted-foreground">· {phase.items.length} items</span></h4>
          <ul className="mt-1 divide-y rounded-md border bg-background text-sm">
            {phase.items.map((item) => (
              <li key={item.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>{item.title}{item.code && <span className="text-muted-foreground"> · {item.code}</span>}{item.planStatus === "hold" && item.holdReason && <span className="block text-xs text-muted-foreground">On hold: {item.holdReason}</span>}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">{formatDate(item.plannedStart)} → {formatDate(item.plannedEnd)}<Badge variant="outline">{item.stage.replace(/_/g, " ")}</Badge></span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
