/**
 * S30 Academic Data Import Center data access (admin + staff). Written against shared/s30-contract.ts.
 * Upload is multipart; it reuses the Authorization + CSRF pattern of the other multipart uploads.
 * 503 S30_UNAVAILABLE becomes the calm "not switched on yet" state through `isImportUnavailable`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiRequest, ApiError, freshCsrfToken, getAuthToken } from "@/lib/api";
import {
  S30_API,
  type ImportBatchDetail, type ImportBatchView, type ImportColumnMapping, type ImportMappingView, type ImportSourceKind, type ReportedRecordView,
} from "@shared/s30-contract";

export function isImportUnavailable(error: unknown): boolean {
  return error instanceof ApiError && ([501, 502, 503].includes(error.status) || error.code === "S30_UNAVAILABLE");
}
const noRetryOnClientError = (count: number, error: unknown) => !(error instanceof ApiError && error.status < 500) && count < 1;

export const importKeys = {
  all: ["s30-imports"] as const,
  list: ["s30-imports", "list"] as const,
  mappings: ["s30-imports", "mappings"] as const,
  batch: (id: string) => ["s30-imports", "batch", id] as const,
  reported: (studentId: string) => ["s30-reported-records", studentId] as const,
};

export function useImportBatches() {
  return useQuery<ImportBatchView[]>({
    queryKey: [...importKeys.list],
    queryFn: async () => (await api.get<{ batches: ImportBatchView[] }>(S30_API.imports))?.batches ?? [],
    retry: noRetryOnClientError,
  });
}
export function useImportMappings() {
  return useQuery<ImportMappingView[]>({
    queryKey: [...importKeys.mappings],
    queryFn: async () => (await api.get<{ mappings: ImportMappingView[] }>(S30_API.importMappings))?.mappings ?? [],
    retry: noRetryOnClientError,
  });
}
export function useImportBatch(id: string | null) {
  return useQuery<ImportBatchDetail>({
    queryKey: [...importKeys.batch(id ?? "")],
    enabled: !!id,
    queryFn: () => api.get<ImportBatchDetail>(S30_API.importBatch(id!)),
    retry: noRetryOnClientError,
  });
}

function useAfterWrite() {
  const qc = useQueryClient();
  return (detail?: ImportBatchDetail | null) => {
    if (detail?.id) qc.setQueryData(importKeys.batch(detail.id), detail);
    void qc.invalidateQueries({ queryKey: [...importKeys.list] });
    void qc.invalidateQueries({ queryKey: [...importKeys.mappings] });
    void qc.invalidateQueries({ queryKey: ["s30-reported-records"] });
  };
}

export interface UploadInput { readonly file: File; readonly sourceKind: ImportSourceKind; readonly providerLabel?: string; readonly mappingId?: string }

/** Multipart upload. Errors keep `code` and (for S30_FILE_REJECTED) `details.reason`. */
export async function uploadImport(input: UploadInput): Promise<ImportBatchDetail> {
  const form = new FormData();
  form.append("sourceKind", input.sourceKind);
  if (input.providerLabel?.trim()) form.append("providerLabel", input.providerLabel.trim());
  if (input.mappingId) form.append("mappingId", input.mappingId);
  form.append("file", input.file, input.file.name);
  const headers = new Headers();
  const token = getAuthToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const csrf = await freshCsrfToken();
  if (csrf) headers.set("X-CSRF-Token", csrf); // no Content-Type: the browser adds the multipart boundary
  const res = await fetch(S30_API.imports, { method: "POST", headers, body: form, credentials: "include" });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const e = body?.error && typeof body.error === "object" ? body.error : null;
    throw new ApiError(typeof e?.message === "string" ? e.message : `HTTP ${res.status}`, res.status, typeof e?.code === "string" ? e.code : undefined, e?.reason ? { reason: e.reason } : e?.details);
  }
  return body as ImportBatchDetail;
}
export function useUploadImport() {
  const after = useAfterWrite();
  return useMutation<ImportBatchDetail, Error, UploadInput>({ mutationFn: uploadImport, onSuccess: after });
}
export function useMapImport(id: string) {
  const after = useAfterWrite();
  return useMutation<ImportBatchDetail, Error, { columns: ImportColumnMapping; saveAs?: string }>({
    mutationFn: (body) => api.post<ImportBatchDetail>(S30_API.importMap(id), body),
    onSuccess: after,
  });
}
export function useDiscardImport(id: string) {
  const after = useAfterWrite();
  return useMutation<ImportBatchDetail, Error, void>({ mutationFn: () => apiRequest<ImportBatchDetail>(S30_API.importDiscard(id), { method: "POST" }), onSuccess: after });
}
export function useApproveImport(id: string) {
  const after = useAfterWrite();
  return useMutation<ImportBatchDetail, Error, void>({ mutationFn: () => apiRequest<ImportBatchDetail>(S30_API.importApprove(id), { method: "POST" }), onSuccess: after });
}
export interface CommitResult { inserted: number; superseded: number; needsReview: number; students: number }
export function useCommitImport(id: string) {
  const after = useAfterWrite();
  return useMutation<{ result: CommitResult; batch: ImportBatchDetail }, Error, void>({
    mutationFn: () => apiRequest(S30_API.importCommit(id), { method: "POST" }),
    onSuccess: (r) => after(r.batch),
  });
}
export function useRollbackImport(id: string) {
  const after = useAfterWrite();
  return useMutation<{ result: unknown; batch: ImportBatchDetail }, Error, { reason: string }>({
    mutationFn: (body) => api.post(S30_API.importRollback(id), body),
    onSuccess: (r) => after(r.batch),
  });
}

export function useReportedRecords(studentId: string) {
  return useQuery<ReportedRecordView[]>({
    queryKey: [...importKeys.reported(studentId)],
    queryFn: async () => (await api.get<{ records: ReportedRecordView[] }>(S30_API.reportedRecords(studentId)))?.records ?? [],
    retry: noRetryOnClientError,
  });
}
export function useReviewReportedRecord(studentId: string) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { id: string; reviewState: "reviewed" | "needs_review" }>({
    mutationFn: ({ id, reviewState }) => apiRequest(S30_API.reportedRecord(studentId, id), { method: "PATCH", body: JSON.stringify({ reviewState }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...importKeys.reported(studentId)] }),
  });
}
