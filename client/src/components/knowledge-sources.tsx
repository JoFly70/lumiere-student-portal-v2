import React, { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, FileText, RefreshCw, Upload, Download, Plus, Library } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiRequest } from "@/lib/api";

type Institution = { id: string; name: string; slug: string };
type Source = {
  id: string; title: string; sourceType: string; sourceUrl: string | null;
  institutionId: string | null; academicYear: string | null; versionLabel: string | null;
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
export function canRetryOperation(_operation: SourceOperation, hasRetryInput: boolean) {
  return hasRetryInput;
}
export function sourceQueryKey(institutionId: string, page: number, pageSize = 50) {
  return ["/api/admin/knowledge/evidence-sources", {
    institutionId: institutionId === "all" ? undefined : institutionId,
    limit: pageSize,
    offset: page * pageSize,
  }] as const;
}
export function paginationState(page: number, count: number, pageSize = 50) {
  return { page, hasPrevious: page > 0, hasNext: count >= pageSize };
}
export function resetPaginationForInstitutionFilter() {
  return 0;
}
export async function openSignedDownload(
  request: () => Promise<{ download_url: string }>,
  open: (url?: string, target?: string) => Window | null,
) {
  const popup = open("about:blank", "_blank");
  if (!popup) throw new Error("Popup was blocked. Allow popups and retry.");
  try {
    try { popup.opener = null; } catch { /* cross-window security boundary */ }
    const result = await request();
    popup.location.href = result.download_url;
    return popup;
  } catch (error) {
    popup.close();
    throw error;
  }
}

function statusVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  if (status === "current") return "default";
  if (status === "pending_review") return "secondary";
  if (status === "superseded") return "outline";
  return "outline";
}

function institutionName(institutions: Institution[] | undefined, id: string | null): string {
  if (!id || !institutions) return "—";
  const match = institutions.find((i) => i.id === id);
  return match ? match.name : "—";
}

export function KnowledgeSources() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [institutionId, setInstitutionId] = useState("all");
  const [page, setPage] = useState(0);
  const pageSize = 50;
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
  const [showCreate, setShowCreate] = useState(false);

  const institutions = useQuery<{ institutions: Institution[] }>({ queryKey: ["/api/admin/knowledge/institutions"] });
  useEffect(() => { setPage(resetPaginationForInstitutionFilter()); }, [institutionId]);
  const sources = useQuery<{ items: Source[]; pagination: { limit: number; offset: number; count: number } }>({
    queryKey: sourceQueryKey(institutionId, page, pageSize),
  });

  const create = useMutation({
    mutationFn: () => apiRequest("/api/admin/knowledge/evidence-sources", { method: "POST", body: JSON.stringify({
      title, sourceType, sourceUrl: sourceUrl || null, institutionId: institutionId === "all" ? null : institutionId,
      academicYear: academicYear || null, versionLabel: versionLabel || null, lifecycleStatus,
    }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/knowledge/evidence-sources"] });
      setTitle(""); setSourceUrl(""); setAcademicYear(""); setVersionLabel("");
      setShowCreate(false);
    },
    onError: (error) => setOperationError(error instanceof Error ? error.message : "Unable to create source"),
  });
  const update = useMutation({
    mutationFn: ({ id, status, academicYear, versionLabel }: { id: string; status?: typeof statuses[number]; academicYear?: string | null; versionLabel?: string | null }) =>
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
      await openSignedDownload(
        () => apiRequest(`/api/admin/knowledge/evidence-sources/${source.id}/download`),
        (url, target) => window.open(url, target),
      );
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "Unable to download source");
      throw error;
    } finally { setDownloadingSourceId(null); }
  }

  const isLoading = institutions.isLoading || sources.isLoading;
  const isError = institutions.isError || sources.isError;
  const rows = sources.data?.items ?? [];
  const paging = paginationState(page, sources.data?.pagination?.count ?? rows.length, pageSize);
  const pageEmpty = rows.length === 0 && page > 0;
  const institutionList = institutions.data?.institutions ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-4 border-b border-border/70 pb-6 md:flex-row md:items-end">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Lumière / knowledge core</p>
          <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight">
            <Library className="h-7 w-7" />
            Evidence Source Library
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage provenance-backed institutional evidence. No source records are fabricated.</p>
        </div>
        <Button onClick={() => setShowCreate((v) => !v)} variant={showCreate ? "outline" : "default"}>
          <Plus className="mr-2 h-4 w-4" />
          {showCreate ? "Cancel" : "New source"}
        </Button>
      </header>

      {operationError && (
        <div role="alert" className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="flex-1">
            <span>{operationError}</span>
            <div className="mt-2 flex gap-2">
              {lastUpload && canRetryOperation("upload", true) && <Button size="sm" variant="outline" onClick={() => upload(lastUpload.source, lastUpload.file).catch(() => undefined)}>Retry upload</Button>}
              {lastDownload && canRetryOperation("download", true) && <Button size="sm" variant="outline" onClick={() => download(lastDownload).catch(() => undefined)}>Retry download</Button>}
              <Button size="sm" variant="ghost" onClick={() => setOperationError(null)}>Dismiss</Button>
            </div>
          </div>
        </div>
      )}

      {showCreate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Create evidence source</CardTitle>
            <CardDescription>Record a new institutional evidence source with provenance metadata.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. TESU 2025-2026 Catalog" />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={sourceType} onValueChange={setSourceType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {sourceTypes.map((t) => <SelectItem key={t} value={t}>{t.replaceAll("_", " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>URL</Label>
              <Input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://..." />
            </div>
            <div className="space-y-2">
              <Label>Academic year</Label>
              <Input value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} placeholder="2025-2026" />
            </div>
            <div className="space-y-2">
              <Label>Version label</Label>
              <Input value={versionLabel} onChange={(e) => setVersionLabel(e.target.value)} placeholder="v1.0" />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={lifecycleStatus} onValueChange={(v) => setLifecycleStatus(v as typeof lifecycleStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {statuses.map((s) => <SelectItem key={s} value={s}>{s.replaceAll("_", " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end lg:col-span-3">
              <Button disabled={!title.trim() || create.isPending} onClick={() => { setOperationError(null); create.mutate(); }}>
                {create.isPending ? "Creating…" : "Create source"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Label className="text-sm text-muted-foreground">Institution</Label>
          <Select value={institutionId} onValueChange={setInstitutionId}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All institutions</SelectItem>
              {institutionList.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div role="status" className="py-12 text-center">Loading Knowledge sources...</div>
      ) : isError ? (
        <div role="alert" className="space-y-3 py-12 text-center">
          <p>Unable to load Knowledge sources.</p>
          <Button variant="outline" onClick={() => { institutions.refetch(); sources.refetch(); }}>Retry</Button>
        </div>
      ) : rows.length === 0 && page === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">No evidence sources found.</CardContent>
        </Card>
      ) : pageEmpty ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">No sources found on this page.</CardContent>
          <div className="flex items-center justify-between border-t p-3">
            <span>Page {page + 1}</span>
            <Button variant="outline" size="sm" onClick={() => setPage((v) => v - 1)}>Previous</Button>
          </div>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-48">Title</TableHead>
                  <TableHead>Institution</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="w-28">Academic year</TableHead>
                  <TableHead className="w-28">Version</TableHead>
                  <TableHead className="w-32">Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((source) => (
                  <TableRow key={source.id}>
                    <TableCell>
                      <div className="font-medium">{source.title}</div>
                      {source.sourceUrl && (
                        <a href={source.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:underline">
                          {source.sourceUrl}
                        </a>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{institutionName(institutionList, source.institutionId)}</TableCell>
                    <TableCell className="text-sm">{source.sourceType.replaceAll("_", " ")}</TableCell>
                    <TableCell>
                      <Input
                        className="h-8 w-24"
                        defaultValue={source.academicYear ?? ""}
                        aria-label={`Academic year for ${source.title}`}
                        onBlur={(e) => { const value = e.target.value || null; if (value !== source.academicYear) update.mutate({ id: source.id, academicYear: value }); }}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-8 w-24"
                        defaultValue={source.versionLabel ?? ""}
                        aria-label={`Version for ${source.title}`}
                        onBlur={(e) => { const value = e.target.value || null; if (value !== source.versionLabel) update.mutate({ id: source.id, versionLabel: value }); }}
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={source.lifecycleStatus}
                        onValueChange={(s) => { setOperationError(null); update.mutate({ id: source.id, status: s as typeof statuses[number] }); }}
                      >
                        <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {statuses.map((s) => <SelectItem key={s} value={s}>{s.replaceAll("_", " ")}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={uploadingSourceId === source.id}
                          onClick={() => { setSelected(source); setOperationError(null); fileRef.current?.click(); }}
                        >
                          <Upload className="mr-1.5 h-3.5 w-3.5" />
                          {operationLabel("upload", uploadingSourceId === source.id)}
                        </Button>
                        {source.externalFileId && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={downloadingSourceId === source.id}
                            onClick={() => download(source).catch(() => undefined)}
                          >
                            <Download className="mr-1.5 h-3.5 w-3.5" />
                            {operationLabel("download", downloadingSourceId === source.id)}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between border-t p-3">
              <span className="text-sm text-muted-foreground">Page {page + 1}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={!paging.hasPrevious} onClick={() => setPage((v) => v - 1)}>Previous</Button>
                <Button variant="outline" size="sm" disabled={!paging.hasNext} onClick={() => setPage((v) => v + 1)}>Next</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <input
        ref={fileRef}
        className="hidden"
        type="file"
        accept="application/pdf,.pdf"
        onChange={(e) => { const file = e.target.files?.[0]; if (file && selected) upload(selected, file).catch(() => undefined); e.currentTarget.value = ""; }}
      />
    </div>
  );
}
