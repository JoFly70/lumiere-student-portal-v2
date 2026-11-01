import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { ReportedRecordsPanel } from "@/components/s30/imports/reported-records-panel";
import { AlertCircle, ArrowLeft, CheckCircle2, ChevronRight, FileSpreadsheet, Loader2, RefreshCw, Upload } from "lucide-react";
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
import { StaffPageHeader } from "@/components/staff/staff-ui";
import { useAuth } from "@/lib/auth";
import { useT, type TranslationKey } from "@/i18n";
import { hsx } from "@/components/admin/high-school/hs-i18n";
import { adminRoadmapApi, RoadmapApiError } from "@/lib/admin-roadmap-api";
import {
  ADMIN_ROADMAP_QUERY_KEY, acknowledgeBody, acknowledgedKeys, applyItemForm, diffHeadline, discardBody,
  exceptionLocation, exceptionsByItem, groupExceptions, itemToForm, parsePastedPackage, publishBody, publishGate,
  itemFacts, removeItemFromContent, reportedHistoryLine, saveDraftBody, type ItemFormValues,
} from "@/lib/admin-roadmap-logic";

type PendingImport = { kind: "file"; file: File; companion?: File | null } | { kind: "package"; pkg: unknown };

type Tr = (key: TranslationKey, vars?: Record<string, string | number>) => string;
const sevLabel = (t: Tr, s: "blocking" | "warning" | "info") => t(`s32dir.rd.sev.${s}` as TranslationKey);

/** "3 groups" / "1 course" in the current language (one key pair per noun). */
function pl(t: Tr, n: number, noun: "objective" | "phase" | "item" | "milestone" | "group" | "finding" | "course"): string {
  return t(`s32dir.rd.n.${noun}.${n === 1 ? "one" : "other"}` as TranslationKey, { n });
}

/** Known English output of the roadmap logic module (publish gate, diff headline) in French; unknown text is data and stays as is. */
function rmx(t: Tr, language: string, s: string | null | undefined): string {
  if (!s || language !== "fr") return s ?? "";
  const fixed: Record<string, string> = {
    "There is no draft to publish.": "Il n’y a aucun brouillon à publier.",
    "Only an administrator can publish a roadmap. Staff can prepare and review the draft.": "Seul un administrateur peut publier une feuille de route. Le personnel peut préparer et examiner le brouillon.",
    "The server reports this draft is not publishable yet.": "Le serveur indique que ce brouillon n’est pas encore publiable.",
    "Another action is in progress.": "Une autre action est en cours.",
  };
  if (fixed[s]) return fixed[s]!;
  let m = /^Fix (\d+) blocking exceptions? first\.$/.exec(s);
  if (m) return `Corrigez d’abord ${m[1]} exception${Number(m[1]) === 1 ? " bloquante" : "s bloquantes"}.`;
  m = /^Acknowledge (\d+) warnings? first\.$/.exec(s);
  if (m) return `Reconnaissez d’abord ${m[1]} avertissement${Number(m[1]) === 1 ? "" : "s"}.`;
  if (s === "First roadmap for this student (nothing published to compare with).") return t("s32dir.rd.diff.first");
  m = /^Compared with published version (\d+): (\d+) added, (\d+) removed, (\d+) changed(?: \((\d+) reschedule only\))?, (\d+) unchanged\.$/.exec(s);
  if (m) return t("s32dir.rd.diff.compared", { v: m[1]!, a: m[2]!, r: m[3]!, c: m[4]!, h: m[5] ? t("s32dir.rd.diff.harmless", { n: m[5] }) : "", u: m[6]! });
  return s;
}

function formatDate(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "—";
}

export default function AdminStudentRoadmap() {
  const { t, language } = useT();
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
        setMessage({ tone: "error", text: t("s32dir.rd.msg.generic") });
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
      setMessage({ tone: "success", text: t("s32dir.rd.msg.imported") });
    } catch (err) {
      if (err instanceof RoadmapApiError && err.failure.kind === "draft_exists") {
        setPendingImport(pending); // ask before replacing
      } else {
        setPendingImport(null);
        setMessage({ tone: "error", text: err instanceof RoadmapApiError ? err.failure.message : t("s32dir.rd.msg.importFailed") });
      }
    } finally {
      setBusy(null);
    }
  }

  const onUploadFile = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return setMessage({ tone: "error", text: t("s32dir.rd.msg.chooseXlsx") });
    void startImport({ kind: "file", file, companion: companionRef.current?.files?.[0] ?? null }, false);
  };
  const onImportPackage = () => {
    try {
      void startImport({ kind: "package", pkg: parsePastedPackage(packageText) }, false);
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : t("s32dir.rd.msg.invalidPackage") });
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
    const ok = await run("save", () => adminRoadmapApi.saveDraft(studentId, saveDraftBody(draft.draftRevision, applyItemForm(draft.content, editingKey, form))), t("s32dir.rd.msg.saved"));
    if (ok) {
      setEditingKey(null);
      setForm(null);
    }
  }

  if (query.isLoading) {
    return <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" />{t("s32dir.rd.loading")}</div>;
  }
  if (query.isError || !state) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Link href={`/admin/students/${encodeURIComponent(studentId)}`} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />{t("s32dir.rd.back")}</Link>
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
          <p>{t("s32dir.rd.loadErr")}</p>
          <Button className="mt-3" type="button" size="sm" variant="outline" onClick={() => void query.refetch()}><RefreshCw className="mr-2 h-4 w-4" />{t("owner.retry")}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-6">
      <StaffPageHeader
        back={<Link href={`/admin/students/${encodeURIComponent(studentId)}`} className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-student-gold-ink underline-offset-4 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden="true" />{t("s32dir.hs.back")}</Link>}
        eyebrow={t("s32dir.rd.eyebrow")}
        title={t("s32dir.hs.tab.roadmap")}
        description={t("s32dir.rd.desc")}
      />

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
            <CardTitle id="published-heading" className="font-serif text-xl font-normal">{t("s32dir.rd.cur.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {state.published ? (
              <>
                <p className="break-words text-lg font-semibold">{state.published.title}</p>
                <p className="break-words text-muted-foreground">{t("s32dir.rd.cur.line", { n: state.published.versionNumber, date: formatDate(state.published.publishedAt) })}</p>
                <p className="text-muted-foreground">{t("s32dir.rd.cur.counts", { n: state.published.content.items.length, m: state.published.content.phases.length })}</p>
                {!draft && (
                  <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => void run("from-published", () => adminRoadmapApi.fromPublished(studentId), t("s32dir.rd.msg.fromPublished"))}>
                    {t("s32dir.rd.cur.edit")}
                  </Button>
                )}
              </>
            ) : <p className="text-muted-foreground">{t("s32dir.rd.cur.none")}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="font-serif text-xl font-normal">{t("s32dir.hs.rm.ver.title")}</CardTitle></CardHeader>
          <CardContent>
            {state.versions.length === 0 ? <p className="text-sm text-muted-foreground">{t("s32dir.rd.ver.empty")}</p> : (
              <ul className="divide-y text-sm">
                {state.versions.map((v) => (
                  <li key={v.versionId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>v{v.versionNumber} · {v.title}</span>
                    <span className="flex items-center gap-2 text-muted-foreground"><Badge variant="outline">{language === "fr" ? hsx(language, v.status.charAt(0).toUpperCase() + v.status.slice(1)) : v.status}</Badge>{formatDate(v.publishedAt ?? v.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {state.published ? <PublishedPlan content={state.published.content} /> : null}

      {/* Import: folded behind a button once a plan exists, so the plan itself comes first. */}
      <details className="group" open={!state.published}>
        <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-md border bg-background px-4 text-sm font-medium [&::-webkit-details-marker]:hidden" data-testid="roadmap-import-toggle">
          <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />{state.published ? t("s32dir.rd.imp.replace") : t("s32dir.rd.imp.import")}
          <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" aria-hidden="true" />
        </summary>
      <section aria-labelledby="import-heading" className="mt-3">
        <Card>
          <CardHeader>
            <CardTitle id="import-heading" className="flex items-center gap-2 font-serif text-xl font-normal"><FileSpreadsheet className="h-4 w-4" />{t("s32dir.rd.imp.title")}</CardTitle>
            <CardDescription>{t("s32dir.rd.imp.desc")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <Label htmlFor="roadmap-workbook">{t("s32dir.rd.imp.workbook")}</Label>
              <FilePicker id="roadmap-workbook" inputRef={fileRef} resetKey={busy} />
              <Label htmlFor="roadmap-companion">{t("s32dir.rd.imp.companion")}</Label>
              <FilePicker id="roadmap-companion" inputRef={companionRef} resetKey={busy} />
              <p className="text-xs text-muted-foreground">{t("s32dir.rd.imp.companionHint")}</p>
              <Button type="button" disabled={busy !== null} onClick={onUploadFile}>{busy === "import" ? t("s32dir.rd.imp.converting") : t("s32dir.rd.imp.upload")}</Button>
            </div>
            <div className="space-y-3">
              <Label htmlFor="roadmap-package">{t("s32dir.rd.imp.package")}</Label>
              <Textarea id="roadmap-package" rows={5} value={packageText} onChange={(e) => setPackageText(e.target.value)} placeholder='{"format":"lumiere-roadmap-package/1", …}' className="font-mono text-xs" />
              <Button type="button" variant="outline" disabled={busy !== null} onClick={onImportPackage}>{t("s32dir.rd.imp.convertPkg")}</Button>
            </div>
          </CardContent>
        </Card>
      </section>
      </details>

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
          onAcknowledge={() => void run("ack", () => adminRoadmapApi.acknowledge(studentId, acknowledgeBody(draft.draftRevision, [...selectedKeys], ackNote)), t("s32dir.rd.msg.acked")).then((ok) => ok && setAckNote(""))}
          onEdit={openEditor}
          onRemove={setRemoveKey}
        />
      )}

      {draft && (
        <section aria-labelledby="actions-heading">
          <Card>
            <CardHeader><CardTitle id="actions-heading" className="font-serif text-xl font-normal">{t("s32dir.rd.act.title")}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" aria-pressed={showPreview} onClick={() => setShowPreview((v) => !v)}>{showPreview ? t("s32dir.rd.act.hide") : t("s32dir.rd.act.show")}</Button>
                <Button type="button" disabled={!gate.enabled} aria-describedby="publish-reason" onClick={() => setConfirm("publish")}>{t("s32dir.rd.act.publish")}</Button>
                <Button type="button" variant="outline" disabled={busy !== null} onClick={() => setConfirm("discard")}>{t("s32dir.rd.act.discard")}</Button>
              </div>
              <p id="publish-reason" className="text-sm text-muted-foreground">{rmx(t, language, gate.reason) || t("s32dir.rd.act.ready")}</p>
              {showPreview && <PreviewPanel studentId={studentId} draftRevision={draft.draftRevision} />}
            </CardContent>
          </Card>
        </section>
      )}

      {/* Replace draft confirmation (409 ROADMAP_DRAFT_EXISTS) */}
      <AlertDialog open={pendingImport !== null} onOpenChange={(o) => !o && setPendingImport(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("s32dir.rd.dlg.replace.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("s32dir.rd.dlg.replace.desc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("s32dir.rd.dlg.replace.keep")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingImport && void startImport(pendingImport, true)}>{t("s32dir.rd.dlg.replace.go")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirm === "publish"} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("s32dir.rd.dlg.publish.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("s32dir.rd.dlg.publish.desc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("owner.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => draft && void run("publish", () => adminRoadmapApi.publish(studentId, publishBody(draft.draftRevision, state.published?.versionId ?? null)), t("s32dir.rd.msg.published")).then(() => setShowPreview(false))}>{t("s32dir.rd.act.publish")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirm === "discard"} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("s32dir.rd.dlg.discard.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("s32dir.rd.dlg.discard.desc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("owner.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => draft && void run("discard", () => adminRoadmapApi.discard(studentId, discardBody(draft.draftRevision)), t("s32dir.rd.msg.discarded")).then(() => setShowPreview(false))}>{t("s32dir.rd.act.discard")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={removeKey !== null} onOpenChange={(o) => !o && setRemoveKey(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("s32dir.rd.dlg.remove.title", { title: draft?.content.items.find((i) => i.key === removeKey)?.title ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("s32dir.rd.dlg.remove.desc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("owner.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const key = removeKey; setRemoveKey(null); if (draft && key) void run("save", () => adminRoadmapApi.saveDraft(studentId, saveDraftBody(draft.draftRevision, removeItemFromContent(draft.content, key))), t("s32dir.rd.msg.removed")); }}>{t("s32dir.rd.dlg.remove.go")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={editingItem !== undefined && form !== null} onOpenChange={(o) => { if (!o) { setEditingKey(null); setForm(null); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("s32dir.rd.edit.title")}</DialogTitle>
            <DialogDescription>{t("s32dir.rd.edit.key.a")}<span className="font-mono">{editingItem?.key}</span>{t("s32dir.rd.edit.key.b")}</DialogDescription>
          </DialogHeader>
          {form && draft && (
            <div className="grid gap-4">
              <Field id="edit-title" label={t("s32dir.rd.edit.f.title")}><Input id="edit-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
              <Field id="edit-code" label={t("s32dir.rd.edit.f.code")}><Input id="edit-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
              <Field id="edit-phase" label={t("s32dir.rd.edit.f.phase")}>
                <Select value={form.phaseKey} onValueChange={(v) => setForm({ ...form, phaseKey: v })}>
                  <SelectTrigger id="edit-phase"><SelectValue /></SelectTrigger>
                  <SelectContent>{draft.content.phases.map((p) => <SelectItem key={p.key} value={p.key}>{p.title}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field id="edit-objective" label={t("s32dir.rd.edit.f.objective")}>
                <Select value={form.objectiveKey} onValueChange={(v) => setForm({ ...form, objectiveKey: v })}>
                  <SelectTrigger id="edit-objective"><SelectValue /></SelectTrigger>
                  <SelectContent>{draft.content.objectives.map((o) => <SelectItem key={o.key} value={o.key}>{o.title}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field id="edit-start" label={t("s32dir.hs.rm.pstart")}><Input id="edit-start" type="date" value={form.plannedStart} onChange={(e) => setForm({ ...form, plannedStart: e.target.value })} /></Field>
                <Field id="edit-end" label={t("s32dir.hs.rm.pend")}><Input id="edit-end" type="date" value={form.plannedEnd} onChange={(e) => setForm({ ...form, plannedEnd: e.target.value })} /></Field>
              </div>
              <Field id="edit-status" label={t("s32dir.rd.edit.f.status")}>
                <Select value={form.planStatus} onValueChange={(v) => setForm({ ...form, planStatus: v as ItemFormValues["planStatus"] })}>
                  <SelectTrigger id="edit-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(["planned", "hold", "alternative", "dropped"] as const).map((s) => <SelectItem key={s} value={s}>{language === "fr" ? t(`s32dir.rd.ps.${s}` as TranslationKey) : s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              {form.planStatus === "hold" && (
                <Field id="edit-hold" label={t("s32dir.rd.edit.f.hold")}><Input id="edit-hold" value={form.holdReason} onChange={(e) => setForm({ ...form, holdReason: e.target.value })} /></Field>
              )}
              <Field id="edit-depends" label={t("s32dir.rd.edit.f.depends")}><Input id="edit-depends" value={form.dependsOn} onChange={(e) => setForm({ ...form, dependsOn: e.target.value })} className="font-mono" /></Field>
            </div>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="outline" className="text-destructive" onClick={() => { setRemoveKey(editingKey); setEditingKey(null); setForm(null); }}>{t("s32dir.rd.dlg.remove.go")}</Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => { setEditingKey(null); setForm(null); }}>{t("owner.cancel")}</Button>
              <Button type="button" disabled={busy !== null} onClick={() => void saveEditor()}>{t("s32dir.hs.p.saveChanges")}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* S30: provider/school-reported records (Needs Attention import items link here, for staff and admins). */}
      <div className="s27 occ"><ReportedRecordsPanel studentId={studentId} /></div>
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
  const { t, language } = useT();
  const { draft, acked, selectedKeys, setSelectedKeys, ackNote, setAckNote, busy, itemIssues } = props;
  const src = draft.import;
  const removedProgress = new Set(draft.diff.removed.filter((r) => r.hasProgress).map((r) => r.itemKey));

  return (
    <section aria-labelledby="draft-heading" className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle id="draft-heading" className="flex flex-wrap items-center gap-2 font-serif text-xl font-normal">
            {t("s32dir.rd.dr.heading", { n: draft.versionNumber, title: draft.content.title })}
            <Badge variant={draft.publishable ? "secondary" : "outline"}>{draft.publishable ? t("s32dir.rd.dr.publishable") : t("s32dir.rd.dr.notPublishable")}</Badge>
          </CardTitle>
          <CardDescription>
            {src
              ? t("s32dir.rd.dr.imported", { file: src.fileName ?? src.summary.generator ?? t("s32dir.rd.dr.pkg"), tpl: src.templateId, r: src.summary.rowsRead, c: src.summary.rowsConverted, s: src.summary.rowsSkipped })
              : t("s32dir.rd.dr.opened")}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {pl(t, draft.content.objectives.length, "objective")} · {pl(t, draft.content.phases.length, "phase")} · {pl(t, draft.content.items.length, "item")} · {pl(t, draft.content.milestones.length, "milestone")}
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
            <CardTitle className="font-serif text-xl font-normal">{t("s32dir.rd.rh.title")}</CardTitle>
            <CardDescription>{t("s32dir.rd.rh.desc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-md border text-sm">
              {draft.content.reportedHistory.map((h) => (
                <li key={h.key} className="p-3">
                  <span className="font-medium">{h.title}</span>
                  <Badge variant="outline" className="ml-2">{t("s32dir.rd.rh.unverified")}</Badge>
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
          <CardTitle className="font-serif text-xl font-normal">{t("s32dir.rd.diff.title")}</CardTitle>
          <CardDescription>{rmx(t, language, diffHeadline(draft.diff))}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {draft.diff.added.length > 0 && <DiffList title={t("s32dir.rd.diff.added")} rows={draft.diff.added.map((a) => `${a.title} (${a.itemKey})`)} />}
          {draft.diff.removed.length > 0 && (
            <div>
              <h3 className="mb-1 font-semibold">{t("s32dir.rd.diff.removed")}</h3>
              <ul className="space-y-1">
                {draft.diff.removed.map((r) => (
                  <li key={r.itemKey} className={r.hasProgress ? "rounded-md border border-st-attention/50 bg-st-attention/10 px-3 py-2" : ""}>
                    {r.title} <span className="font-mono text-xs text-muted-foreground">({r.itemKey})</span>
                    {r.hasProgress && <span className="ml-2 font-medium">{t("s32dir.rd.diff.progress")}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {draft.diff.changed.length > 0 && (
            <div>
              <h3 className="mb-1 font-semibold">{t("s32dir.rd.diff.changed")}</h3>
              <ul className="space-y-1">
                {draft.diff.changed.map((c) => (
                  <li key={c.itemKey}>
                    {c.title} <span className="font-mono text-xs text-muted-foreground">{c.fields.join(", ")}</span>
                    {c.rescheduleOnly && <Badge variant="secondary" className="ml-2">{t("s32dir.rd.diff.resched")}</Badge>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(draft.diff.objectivesAdded.length > 0 || draft.diff.objectivesRemoved.length > 0 || draft.diff.objectivesChanged.length > 0 || draft.diff.phasesChanged || draft.diff.milestonesChanged) && (
            <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
              {draft.diff.objectivesAdded.length > 0 && <li>{t("s32dir.rd.diff.objAdded")}{draft.diff.objectivesAdded.join(", ")}</li>}
              {draft.diff.objectivesRemoved.length > 0 && <li>{t("s32dir.rd.diff.objRemoved")}{draft.diff.objectivesRemoved.join(", ")}</li>}
              {draft.diff.objectivesChanged.length > 0 && <li>{t("s32dir.rd.diff.objChanged")}{draft.diff.objectivesChanged.join(", ")}</li>}
              {draft.diff.phasesChanged && <li>{t("s32dir.rd.diff.phases")}</li>}
              {draft.diff.milestonesChanged && <li>{t("s32dir.rd.diff.milestones")}</li>}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="font-serif text-xl font-normal">{t("s32dir.rd.items.title")}</CardTitle><CardDescription>{t("s32dir.rd.items.desc")}</CardDescription></CardHeader>
        <CardContent>
          {draft.content.items.length === 0 ? <p className="text-sm text-muted-foreground">{t("s32dir.rd.items.none")}</p> : (
            <div className="relative overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">{t("s32dir.rd.items.caption")}</caption>
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr><th scope="col" className="py-2 pr-3">{t("s32dir.rd.items.col.item")}</th><th scope="col" className="hidden py-2 pr-3 sm:table-cell">{t("s32dir.rd.items.col.phase")}</th><th scope="col" className="hidden py-2 pr-3 md:table-cell">{t("s32dir.rd.items.col.dates")}</th><th scope="col" className="py-2 pr-3">{t("s32dir.hs.p.status")}</th><th scope="col" className="py-2"><span className="sr-only">{t("s32dir.rd.items.col.actions")}</span></th></tr>
                </thead>
                <tbody className="divide-y">
                  {draft.content.items.map((item) => {
                    const issues = itemIssues.get(item.key) ?? [];
                    return (
                      <tr key={item.key} className={removedProgress.has(item.key) ? "bg-st-attention/10" : ""}>
                        <td className="py-2 pr-3"><span className="font-medium">{item.title}</span>{item.code && <span className="text-muted-foreground"> · {item.code}</span>}<span className="block break-all font-mono text-xs text-muted-foreground">{item.key}</span>{itemFacts(item).map((f) => <span key={f} className="block text-xs text-muted-foreground">{f}</span>)}<span className="block text-xs text-muted-foreground sm:hidden">{phaseTitle(draft, item)} · {formatDate(item.plannedStart)} → {formatDate(item.plannedEnd)}</span></td>
                        <td className="hidden py-2 pr-3 sm:table-cell">{phaseTitle(draft, item)}<span className="block text-xs text-muted-foreground md:hidden">{formatDate(item.plannedStart)} → {formatDate(item.plannedEnd)}</span></td>
                        <td className="hidden whitespace-nowrap py-2 pr-3 md:table-cell">{formatDate(item.plannedStart)} → {formatDate(item.plannedEnd)}</td>
                        <td className="py-2 pr-3"><Badge variant="outline">{language === "fr" ? t(`s32dir.rd.ps.${item.planStatus}` as TranslationKey) : item.planStatus}</Badge>{issues.length > 0 && <Badge variant={issues.some((i) => i.severity === "blocking") ? "destructive" : "secondary"} className="ml-1">{t(issues.length === 1 ? "s32dir.rd.items.issue.one" : "s32dir.rd.items.issue.other", { n: issues.length })}</Badge>}</td>
                        <td className="py-2 text-right"><Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => props.onEdit(item)} aria-label={t("s32dir.rd.items.editAria", { title: item.title })}>{t("s32dir.rd.items.edit")}</Button></td>
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

const XLSX_ACCEPT = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Styled file picker: a visually hidden native input driven by a button, with translated labels. */
function FilePicker({ id, inputRef, resetKey }: { id: string; inputRef: React.RefObject<HTMLInputElement>; resetKey?: unknown }) {
  const { t } = useT();
  const [name, setName] = useState<string | null>(null);
  useEffect(() => { setName(inputRef.current?.files?.[0]?.name ?? null); }, [resetKey, inputRef]);
  return (
    <div className="flex min-w-0 items-center gap-3">
      <input id={id} ref={inputRef} type="file" accept={XLSX_ACCEPT} className="sr-only" onChange={(e) => setName(e.currentTarget.files?.[0]?.name ?? null)} />
      <Button type="button" variant="outline" className="shrink-0" onClick={() => inputRef.current?.click()}><Upload className="mr-2 h-4 w-4" aria-hidden="true" />{t("staff.docs.upload.choose")}</Button>
      <span className={`min-w-0 truncate text-sm ${name ? "text-foreground" : "text-muted-foreground"}`} title={name ?? undefined}>{name ?? t("staff.docs.upload.noFile")}</span>
    </div>
  );
}

/** Read-only view of the published plan: phases with their items, status and planned dates (no draft needed to see it). */
function PublishedPlan({ content }: { content: AdminRoadmapDraftView["content"] }) {
  const { t } = useT();
  const planStatus = (s: string) => (["planned", "hold", "alternative", "dropped"].includes(s) ? t(`s32dir.rd.ps.${s}` as TranslationKey) : s);
  return (
    <section aria-labelledby="published-plan-heading" data-testid="published-plan">
      <Card>
        <CardHeader>
          <CardTitle id="published-plan-heading" className="font-serif text-xl font-normal">{t("s32dir.rd.pub.title")}</CardTitle>
          <CardDescription>{t("s32dir.rd.pub.desc", { n: content.items.length, m: content.phases.length })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {content.phases.map((ph) => {
            const items = content.items.filter((i) => i.phaseKey === ph.key);
            if (items.length === 0) return null;
            return (
              <div key={ph.key}>
                <h3 className="mb-1 font-serif text-lg">{ph.title} <span className="text-sm text-muted-foreground">· {items.length}</span></h3>
                <ul className="divide-y rounded-md border text-sm">
                  {items.map((i) => (
                    <li key={i.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2" data-testid="published-item">
                      <span className="min-w-0 break-words"><span className="font-medium">{i.title}</span>{i.code ? <span className="text-muted-foreground"> · {i.code}</span> : null}</span>
                      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                        {i.plannedStart ? <span className="tabular-nums">{formatDate(i.plannedStart)}</span> : null}
                        <Badge variant="outline">{planStatus(i.planStatus)}</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
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
  const { t } = useT();
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
              aria-label={t("s32dir.rd.rv.ackAria", { title: g.title, extra: g.count > 1 ? t("s32dir.rd.rv.ackExtra", { n: g.count }) : "" })}
              className="mt-1"
            />
          )}
          <div className="min-w-0 flex-1 text-sm">
            <label htmlFor={selectable ? id : undefined} className={selectable ? "cursor-pointer" : undefined}>
              <span className="font-medium">{g.title}</span>
              {g.count > 1 && <Badge variant="secondary" className="ml-2">×{g.count}</Badge>}
              {ack.state === "all" && <span className="ml-2 text-xs text-muted-foreground">{t("s32dir.rd.rv.acknowledged")}</span>}
              {ack.state === "partial" && <span className="ml-2 text-xs text-muted-foreground">{t("s32dir.rd.rv.partial", { a: ack.acknowledged, b: g.count })}</span>}
              {sel === "some" && <span className="ml-2 text-xs text-muted-foreground">{t("s32dir.rd.rv.someSelected")}</span>}
              <span className="mt-0.5 block">{g.count === 1 ? g.example : g.hint || g.example}</span>
            </label>
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                {g.count === 1 ? t("s32dir.rd.rv.source") : t("s32dir.rd.rv.showAll", { n: g.count, what: g.courses.length > 0 ? pl(t, g.courses.length, "course") : t("s32dir.rd.rv.rows") })}
              </summary>
              <ul className="mt-1 space-y-1 border-l pl-3">
                {g.evidence.map((ev) => (
                  <li key={ev.key} className="text-xs">
                    {g.count > 1 && <span className="block">{ev.message}</span>}
                    <span className="block text-muted-foreground"><span className="font-mono">{g.code}</span>{ev.location && ` · ${ev.location}`}{acked.has(ev.key) ? ` · ${t("s32dir.rd.rv.acknowledged")}` : ""}</span>
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
      <div role="group" aria-label={sevLabel(t, severity)}>
        <h3 className={`mb-2 text-sm font-semibold ${severity === "blocking" ? "text-destructive" : ""}`}>
          {severity === "warning" ? t("s32dir.rd.rv.warnHead", { label: sevLabel(t, severity), groups: pl(t, sec.groupCount, "group"), open, total: sec.exceptionCount }) : t("s32dir.rd.rv.blockHead", { label: sevLabel(t, severity), groups: pl(t, sec.groupCount, "group"), n: sec.exceptionCount })}
        </h3>
        <div className="space-y-4">
          {sec.categories.map((c) => (
            <div key={c.category}>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{REVIEW_CATEGORY_LABEL[c.category]} · {pl(t, c.groups.length, "group")}</h4>
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
        <CardTitle className="font-serif text-xl font-normal">{t("s32dir.rd.rv.title")}</CardTitle>
        <CardDescription>
          {raw.total === 0
            ? t("s32dir.rd.rv.nothing")
            : t("s32dir.rd.rv.summary", { findings: pl(t, raw.total, "finding"), groups: pl(t, groups.total, "group"), b: groups.blocking, w: groups.warning, i: groups.info })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {draft.exceptions.length === 0 && <p className="text-sm text-muted-foreground">{t("s32dir.rd.rv.none")}</p>}
        {draft.exceptions.length > 0 && (
          <div role="group" aria-label={t("s32dir.rd.rv.groupBy")} className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant={view === "issue" ? "default" : "outline"} aria-pressed={view === "issue"} onClick={() => setView("issue")}>{t("s32dir.rd.rv.byIssue")}</Button>
            <Button type="button" size="sm" variant={view === "course" ? "default" : "outline"} aria-pressed={view === "course"} onClick={() => setView("course")}>{t("s32dir.rd.rv.byCourse")}</Button>
          </div>
        )}
        {view === "issue" && (
          <>
            {section("blocking")}
            {section("warning")}
            {review.sections.info.groupCount > 0 && (
              <details>
                <summary className="cursor-pointer text-sm font-semibold">{t("s32dir.rd.rv.blockHead", { label: sevLabel(t, "info"), groups: pl(t, review.sections.info.groupCount, "group"), n: review.sections.info.exceptionCount })}</summary>
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
                      <span className="ml-2 text-xs font-normal text-muted-foreground">{pl(t, c.exceptions.length, "finding")} · {c.severity === "blocking" ? t("s32dir.rd.rv.blocking") : c.severity === "warning" ? t(openKeys.length === 1 ? "s32dir.rd.rv.openWarn.one" : "s32dir.rd.rv.openWarn.other", { n: openKeys.length }) : t("s32dir.rd.rv.infoOnly")}</span>
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
                              aria-label={t("s32dir.rd.rv.ackMsg", { msg: e.message })}
                              className="mt-1"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <span className="block">{e.message}</span>
                            <span className="block text-xs text-muted-foreground"><span className="font-mono">{e.code}</span> {exceptionLocation(e) && `· ${exceptionLocation(e)}`}{acked.has(e.key) ? ` · ${t("s32dir.rd.rv.acknowledged")}` : ""}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                    {openKeys.length > 0 && (
                      <div className="border-t p-2">
                        <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => toggleKeys(openKeys, true)}>{t(openKeys.length === 1 ? "s32dir.rd.rv.selectCourse.one" : "s32dir.rd.rv.selectCourse.other", { n: openKeys.length })}</Button>
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
            <Label htmlFor="ack-note">{t("s32dir.rd.rv.noteLabel")}</Label>
            <Input id="ack-note" value={ackNote} maxLength={500} onChange={(e) => setAckNote(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" disabled={selectedKeys.size === 0 || busy !== null} onClick={props.onAcknowledge}>{t(selectedKeys.size === 1 ? "s32dir.rd.rv.ackSelected.one" : "s32dir.rd.rv.ackSelected.other", { n: selectedKeys.size })}</Button>
              <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => setSelectedKeys(new Set(openWarningKeys))}>{t("s32dir.rd.rv.selectAll", { n: openWarningKeys.length })}</Button>
              {selectedKeys.size > 0 && <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => setSelectedKeys(new Set())}>{t("s32dir.rd.rv.clear")}</Button>}
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
  const { t } = useT();
  const preview = useQuery({
    queryKey: ["admin-roadmap-preview", studentId, draftRevision],
    queryFn: () => adminRoadmapApi.preview(studentId),
    staleTime: Infinity,
  });
  if (preview.isLoading) return <p className="text-sm text-muted-foreground" role="status">{t("s32dir.rd.pv.loading")}</p>;
  if (preview.isError || !preview.data) {
    return <div role="alert" className="text-sm text-destructive">{t("s32dir.rd.pv.err")} <Button type="button" size="sm" variant="outline" onClick={() => void preview.refetch()}>{t("owner.retry")}</Button></div>;
  }
  const view = preview.data;
  return (
    <div className="space-y-4 rounded-md border bg-muted/30 p-4" aria-label={t("s32dir.rd.pv.aria")}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("s32dir.rd.pv.head")}</p>
      <h3 className="text-lg font-semibold">{view.plan?.title}</h3>
      {view.plan?.summary && <p className="text-sm text-muted-foreground">{view.plan.summary}</p>}
      {view.phases.map((phase) => (
        <div key={phase.key}>
          <h4 className="text-sm font-semibold">{phase.title} <span className="font-normal text-muted-foreground">{t("s32dir.rd.pv.items", { n: phase.items.length })}</span></h4>
          <ul className="mt-1 divide-y rounded-md border bg-background text-sm">
            {phase.items.map((item) => (
              <li key={item.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>{item.title}{item.code && <span className="text-muted-foreground"> · {item.code}</span>}{item.planStatus === "hold" && item.holdReason && <span className="block text-xs text-muted-foreground">{t("s32dir.rd.pv.onHold", { r: item.holdReason })}</span>}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">{formatDate(item.plannedStart)} → {formatDate(item.plannedEnd)}<Badge variant="outline">{item.stage.replace(/_/g, " ")}</Badge></span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
