import React, { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/api";

type Institution = { id: string; name: string; slug: string };
type Source = {
  id: string; title: string; sourceType: string; sourceUrl: string | null;
  institutionId: string | null; academicYear: number | null; versionLabel: string | null;
  lifecycleStatus: "current" | "historical" | "superseded" | "pending_review";
  externalFileId: string | null; contentHash: string | null;
};
const sourceTypes = ["official_catalog", "official_pdf", "official_web", "institutional_document", "provider_document"];
const statuses = ["current", "historical", "superseded", "pending_review"] as const;
export type SourceOperation = "upload" | "download";
export function operationLabel(operation: SourceOperation, pending: boolean) {
  if (operation === "upload") return pending ? "Uploading…" : "Upload PDF";
  return pending ? "Opening…" : "View / download";
}
export function canRetryOperation(operation: SourceOperation, hasRetryInput: boolean) {
  return hasRetryInput;
}

export function KnowledgeSources() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [institutionId, setInstitutionId] = useState("all");
  const [title, setTitle] = useState("");
  const [sourceType, setSourceType] = useState("official_catalog");
  const [sourceUrl, setSourceUrl] = useState("");
  const [academicYear, setAcademicYear] = useState("");
  const [versionLabel, setVersionLabel] = useState("");
  const [lifecycleStatus, setLifecycleStatus] = useState<typeof statuses[number]>("pending_review");
  const [selected, setSelected] = useState<Source | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [uploadingSourceId, setUploadingSourceId] = useState<string | null>(null);
  const [downloadingSourceId, setDownloadingSourceId] = useState<string | null>(null);
  const [lastUpload, setLastUpload] = useState<{ source: Source; file: File } | null>(null);
  const [lastDownload, setLastDownload] = useState<Source | null>(null);
  const institutions = useQuery<{ institutions: Institution[] }>({ queryKey: ["/api/admin/knowledge/institutions"] });
  const sources = useQuery<{ items: Source[] }>({
    queryKey: ["/api/admin/knowledge/evidence-sources", { institutionId: institutionId === "all" ? undefined : institutionId }],
  });
  const create = useMutation({
    mutationFn: () => apiRequest("/api/admin/knowledge/evidence-sources", { method: "POST", body: JSON.stringify({
      title, sourceType, sourceUrl: sourceUrl || null, institutionId: institutionId === "all" ? null : institutionId,
      academicYear: academicYear ? Number(academicYear) : null, versionLabel: versionLabel || null, lifecycleStatus,
    }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/admin/knowledge/evidence-sources"] }); setTitle(""); setSourceUrl(""); setAcademicYear(""); setVersionLabel(""); },
    onError: (error) => setOperationError(error instanceof Error ? error.message : "Unable to create source"),
  });
  const update = useMutation({
    mutationFn: ({ id, status, academicYear, versionLabel }: { id: string; status?: typeof statuses[number]; academicYear?: number | null; versionLabel?: string | null }) =>
      apiRequest(`/api/admin/knowledge/evidence-sources/${id}`, { method: "PATCH", body: JSON.stringify({ ...(status ? { lifecycleStatus: status } : {}), ...(academicYear !== undefined ? { academicYear } : {}), ...(versionLabel !== undefined ? { versionLabel } : {}) }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/knowledge/evidence-sources"] }),
    onError: (error) => setOperationError(error instanceof Error ? error.message : "Unable to update source"),
  });

  async function upload(source: Source, file: File) {
    setOperationError(null);
    setUploadingSourceId(source.id);
    setLastUpload({ source, file });
    try {
    if (file.type !== "application/pdf") throw new Error("Only PDF files are allowed");
    const signed = await apiRequest(`/api/admin/knowledge/evidence-sources/${source.id}/upload`, { method: "POST", body: JSON.stringify({ fileName: file.name, fileSize: file.size, mimeType: file.type }) });
    const uploadResponse = await fetch(signed.upload_url, { method: "PUT", headers: { "Content-Type": "application/pdf", "x-upsert": "false" }, body: file });
    if (!uploadResponse.ok) throw new Error("PDF upload failed");
    await apiRequest(`/api/admin/knowledge/evidence-sources/${source.id}/upload/complete`, { method: "POST", body: JSON.stringify({ storagePath: signed.storage_path }) });
    qc.invalidateQueries({ queryKey: ["/api/admin/knowledge/evidence-sources"] });
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "Unable to upload source");
      throw error;
    } finally { setUploadingSourceId(null); }
  }
  async function download(source: Source) {
    setOperationError(null); setDownloadingSourceId(source.id); setLastDownload(source);
    try {
      const result = await apiRequest(`/api/admin/knowledge/evidence-sources/${source.id}/download`);
      window.open(result.download_url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "Unable to download source");
      throw error;
    } finally { setDownloadingSourceId(null); }
  }

  if (institutions.isLoading || sources.isLoading) return <div role="status" className="py-12 text-center">Loading Knowledge sources...</div>;
  if (institutions.isError || sources.isError) return <div role="alert" className="space-y-3 py-12 text-center"><p>Unable to load Knowledge sources.</p><Button variant="outline" onClick={() => { institutions.refetch(); sources.refetch(); }}>Retry</Button></div>;
  const rows = sources.data?.items ?? [];
  return <div className="space-y-6">
    {operationError && <div role="alert" className="space-y-2 rounded border border-destructive/40 bg-destructive/10 p-3 text-sm"><span>{operationError}</span><div className="flex gap-2">
      {lastUpload && canRetryOperation("upload", true) && <Button size="sm" variant="outline" onClick={() => upload(lastUpload.source, lastUpload.file).catch(() => undefined)}>Retry upload</Button>}
      {lastDownload && canRetryOperation("download", true) && <Button size="sm" variant="outline" onClick={() => download(lastDownload).catch(() => undefined)}>Retry download</Button>}
      <Button size="sm" variant="ghost" onClick={() => setOperationError(null)}>Dismiss</Button>
    </div></div>}
    <Card><CardHeader><CardTitle>Evidence Source Library</CardTitle><CardDescription>Manage provenance-backed institutional evidence. No source records are fabricated.</CardDescription></CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-3">
        <div><Label>Institution filter</Label><Select value={institutionId} onValueChange={setInstitutionId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All institutions</SelectItem>{institutions.data?.institutions.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Source title" /></div>
        <div><Label>Type</Label><Select value={sourceType} onValueChange={setSourceType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{sourceTypes.map((t) => <SelectItem key={t} value={t}>{t.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>URL</Label><Input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://..." /></div>
        <div><Label>Academic year</Label><Input type="number" value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} placeholder="2025" /></div>
        <div><Label>Version label</Label><Input value={versionLabel} onChange={(e) => setVersionLabel(e.target.value)} placeholder="Version" /></div>
        <div><Label>Status</Label><Select value={lifecycleStatus} onValueChange={(v) => setLifecycleStatus(v as typeof lifecycleStatus)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{statuses.map((s) => <SelectItem key={s} value={s}>{s.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></div>
        <div className="flex items-end"><Button disabled={!title.trim() || create.isPending} onClick={() => { setOperationError(null); create.mutate(); }}>{create.isPending ? "Creating…" : "Create source"}</Button></div>
      </CardContent>
    </Card>
    {rows.length === 0 ? <Card><CardContent className="py-12 text-center text-muted-foreground">No evidence sources found.</CardContent></Card> :
      <Card><CardContent className="divide-y p-0">{rows.map((source) => <div key={source.id} className="flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-56 flex-1"><p className="font-medium">{source.title}</p><p className="text-sm text-muted-foreground">{source.sourceType} {source.versionLabel ? `· ${source.versionLabel}` : ""}</p></div>
        <Badge variant="outline">{source.lifecycleStatus}</Badge>
        <Input className="w-24" type="number" defaultValue={source.academicYear ?? ""} aria-label={`Academic year for ${source.title}`} onBlur={(e) => { const value = e.target.value ? Number(e.target.value) : null; if (value !== source.academicYear) update.mutate({ id: source.id, academicYear: value }); }} />
        <Input className="w-28" defaultValue={source.versionLabel ?? ""} aria-label={`Version for ${source.title}`} onBlur={(e) => { const value = e.target.value || null; if (value !== source.versionLabel) update.mutate({ id: source.id, versionLabel: value }); }} />
        <Button variant="outline" size="sm" disabled={uploadingSourceId === source.id} onClick={() => { setSelected(source); setOperationError(null); fileRef.current?.click(); }}>{operationLabel("upload", uploadingSourceId === source.id)}</Button>
        {source.externalFileId && <Button variant="outline" size="sm" disabled={downloadingSourceId === source.id} onClick={() => download(source).catch(() => undefined)}>{operationLabel("download", downloadingSourceId === source.id)}</Button>}
        <Select value={source.lifecycleStatus} onValueChange={(s) => { setOperationError(null); update.mutate({ id: source.id, status: s as typeof statuses[number] }); }}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent>{statuses.map((s) => <SelectItem key={s} value={s}>{s.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select>
      </div>)}</CardContent></Card>}
    <input ref={fileRef} className="hidden" type="file" accept="application/pdf,.pdf" onChange={(e) => { const file = e.target.files?.[0]; if (file && selected) upload(selected, file).catch(() => undefined); e.currentTarget.value = ""; }} />
  </div>;
}