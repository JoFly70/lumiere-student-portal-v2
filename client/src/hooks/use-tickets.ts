import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, ApiError } from '@/lib/api';

import type {
  SupportAttachment,
  SupportComment,
  SupportPerson,
  SupportStatsResponse,
  SupportStatusEvent,
  SupportTicketDetail,
  SupportTicketSummary,
  TicketCategory,
  TicketPriority,
  TicketStatus,
  SupportTopic,
} from '@shared/support-contract';
import { attachmentTypeAllowed, SUPPORT_ATTACHMENT_MAX_BYTES } from '@shared/support-contract';

/**
 * Ticket as returned by the API. Summaries (list) omit the thread; the detail
 * endpoint adds comments, attachments, history and permissions. Staff-only
 * fields are optional because student responses omit them.
 */
export type Ticket = Omit<SupportTicketSummary, 'reporter_email' | 'resolved_at' | 'resolution_notes'> & {
  reporter_email?: string;
  resolved_at?: string | null;
  resolved_by?: string | null;
  resolution_notes?: string | null;
  ticket_comments?: TicketComment[];
  ticket_attachments?: TicketAttachment[];
  ticket_status_history?: StatusHistory[];
  permissions?: SupportTicketDetail['permissions'];
};

export type TicketComment = SupportComment;
export type TicketAttachment = SupportAttachment;
export type StatusHistory = SupportStatusEvent;
export type { SupportTicketDetail, SupportTicketSummary, SupportStatsResponse, SupportPerson };

export interface CreateTicketInput {
  subject: string;
  description: string;
  /** Preferred: student-facing topic. */
  topic?: SupportTopic;
  /** Legacy clients. */
  category?: TicketCategory;
  priority?: TicketPriority;
  context?: { roadmapItemKey: string };
  /** Stable per form submission; reused on retry so a retry never duplicates the request. */
  idempotencyKey?: string;
}

/** A new random idempotency key (matches SUPPORT_IDEMPOTENCY_KEY_PATTERN). */
export function newIdempotencyKey(): string {
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

/**
 * Truthful wording for a failed create: only claim "not sent" when the server
 * said so. A network failure or an unconfirmed rollback may have saved it.
 */
export function describeCreateFailure(error: unknown): { message: string; mayHaveSaved: boolean } {
  if (error instanceof ApiError) {
    const details = error.details as { mayHaveSaved?: boolean } | undefined;
    if (error.code === 'SUPPORT_CREATE_INCOMPLETE' && details?.mayHaveSaved) return { message: error.message, mayHaveSaved: true };
    return { message: error.message, mayHaveSaved: false };
  }
  return { message: 'We could not confirm that your request was received.', mayHaveSaved: true };
}

export interface UpdateTicketInput {
  subject?: string;
  description?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  assignedTo?: string | null;
  resolutionNotes?: string;
}

export interface CreateCommentInput {
  content: string;
  isInternal?: boolean;
  nextStatus?: TicketStatus;
}

export interface TicketsResponse {
  tickets: Ticket[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
}

export interface TicketFilters {
  studentId?: string | null;
  status?: string;
  category?: string;
  priority?: string;
  search?: string;
  view?: 'active' | 'resolved';
  awaiting?: 'staff' | 'student';
  assignedTo?: string;
  overdue?: boolean;
  limit?: number;
}

export function ticketQueryParams(filters?: TicketFilters): URLSearchParams {
  const queryParams = new URLSearchParams();
  if (filters?.studentId) queryParams.set('studentId', filters.studentId);
  if (filters?.status) queryParams.set('status', filters.status);
  if (filters?.category) queryParams.set('category', filters.category);
  if (filters?.priority) queryParams.set('priority', filters.priority);
  if (filters?.search) queryParams.set('search', filters.search);
  if (filters?.view) queryParams.set('view', filters.view);
  if (filters?.awaiting) queryParams.set('awaiting', filters.awaiting);
  if (filters?.assignedTo) queryParams.set('assignedTo', filters.assignedTo);
  if (filters?.overdue) queryParams.set('overdue', 'true');
  if (filters?.limit) queryParams.set('limit', String(filters.limit));
  return queryParams;
}

export function useTickets(filters?: TicketFilters, options?: { enabled?: boolean }) {
  const queryParams = ticketQueryParams(filters);

  return useQuery<TicketsResponse>({
    queryKey: ['tickets', filters],
    queryFn: async () => {
      const url = `/api/tickets${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
      return apiRequest(url);
    },
    // A caller that scopes by student but has no resolved student id yet must
    // not fall through to the unscoped ticket list.
    enabled: !(filters && 'studentId' in filters && !filters.studentId) && options?.enabled !== false,
  });
}

export function useTicketStats(enabled: boolean) {
  return useQuery<SupportStatsResponse>({
    queryKey: ['ticket-stats'],
    queryFn: async () => apiRequest('/api/tickets/stats/summary'),
    enabled,
  });
}

export function useSupportStaffDirectory(enabled: boolean) {
  return useQuery<{ staff: SupportPerson[] }>({
    queryKey: ['ticket-staff-directory'],
    queryFn: async () => apiRequest('/api/tickets/staff-directory'),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export interface SupportContextOption {
  key: string;
  title: string;
  code: string | null;
  kind: string;
  phaseTitle: string | null;
}

export interface SupportContextOptionsResponse {
  available: boolean;
  planVersion: number | null;
  items: SupportContextOption[];
}

export function useSupportContextOptions(enabled: boolean) {
  return useQuery<SupportContextOptionsResponse>({
    queryKey: ['ticket-context-options'],
    queryFn: async () => apiRequest('/api/tickets/context-options'),
    enabled,
    staleTime: 60_000,
  });
}

export function useTicket(ticketId: string | null) {
  return useQuery<{ ticket: Ticket }>({
    queryKey: ['ticket', ticketId],
    queryFn: async () => apiRequest(`/api/tickets/${ticketId}`),
    enabled: !!ticketId,
  });
}

export function useCreateTicket() {
  const queryClient = useQueryClient();

  return useMutation<{ ticket: Ticket }, Error, CreateTicketInput>({
    mutationFn: async (data) => {
      return apiRequest('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
  });
}

export function useUpdateTicket(ticketId: string) {
  const queryClient = useQueryClient();

  return useMutation<{ ticket: Ticket }, Error, UpdateTicketInput>({
    mutationFn: async (data) => {
      return apiRequest(`/api/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
    },
  });
}

export function useCreateComment(ticketId: string) {
  const queryClient = useQueryClient();

  return useMutation<{ comment: TicketComment; ticket?: Ticket }, Error, CreateCommentInput>({
    mutationFn: async (data) => {
      return apiRequest(`/api/tickets/${ticketId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
  });
}

export interface GenerateAttachmentUploadInput {
  file_name: string;
  file_size: number;
  file_type: string;
}

export interface GenerateAttachmentUploadResponse {
  uploadUrl: string;
  token?: string;
  storagePath: string;
}

export interface CreateAttachmentInput {
  file_name: string;
  file_size: number;
  file_type: string;
  storage_path: string;
  comment_id?: string | null;
}

export function useGenerateAttachmentUpload(ticketId: string | null) {
  return useMutation<GenerateAttachmentUploadResponse, Error, GenerateAttachmentUploadInput>({
    mutationFn: async (data) => {
      return apiRequest(`/api/tickets/${ticketId}/attachments/upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },
  });
}

export function useCreateAttachment(ticketId: string | null) {
  const queryClient = useQueryClient();

  return useMutation<TicketAttachment | { attachment: TicketAttachment }, Error, CreateAttachmentInput>({
    mutationFn: async (data) => {
      return apiRequest(`/api/tickets/${ticketId}/attachments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
  });
}

export interface AttachmentDownload {
  downloadUrl: string;
  fileName: string;
}

/** Signed, short-lived URL for one attachment. Caller opens it. */
export function useAttachmentDownload(ticketId: string | null) {
  return useMutation<AttachmentDownload, Error, string>({
    mutationFn: async (attachmentId) => {
      const res = await apiRequest<Partial<AttachmentDownload> & { url?: string; signedUrl?: string; file_name?: string }>(
        `/api/tickets/${ticketId}/attachments/${attachmentId}/download-url`,
      );
      const downloadUrl = res.downloadUrl ?? res.url ?? res.signedUrl;
      if (!downloadUrl) throw new Error('The download link is not available right now. Please try again.');
      return { downloadUrl, fileName: res.fileName ?? res.file_name ?? 'attachment' };
    },
  });
}

/** Client-side check shared by UI and hook. Returns a plain-language error or null. */
export function validateAttachmentFile(file: { name: string; size: number; type: string }): string | null {
  if (file.size <= 0) return 'That file is empty.';
  if (file.size > SUPPORT_ATTACHMENT_MAX_BYTES) return 'Files can be up to 10 MB. Please choose a smaller file.';
  if (!attachmentTypeAllowed(file.name, file.type)) {
    return 'This file type is not supported. Please use PDF, PNG, JPG, WebP, TXT, DOC or DOCX.';
  }
  return null;
}

/**
 * upload-url -> PUT to the signed uploadUrl -> record. Every step failure is an
 * Error; success is only reported once the record call succeeded.
 */
export function useUploadTicketAttachment(ticketId: string | null) {
  const queryClient = useQueryClient();

  return useMutation<TicketAttachment, Error, { file: File; commentId?: string } | File>({
    mutationFn: async (input) => {
      const file = input instanceof File ? input : input.file;
      const commentId = input instanceof File ? undefined : input.commentId;
      if (!ticketId) throw new Error('Open a request before attaching a file.');
      const invalid = validateAttachmentFile(file);
      if (invalid) throw new Error(invalid);

      const meta = { file_name: file.name, file_size: file.size, file_type: file.type };
      const target = await apiRequest<GenerateAttachmentUploadResponse>(
        `/api/tickets/${ticketId}/attachments/upload-url`,
        { method: 'POST', body: JSON.stringify(meta) },
      );
      if (!target?.uploadUrl || !target?.storagePath) throw new Error('Could not prepare the upload. Please try again.');

      let put: Response;
      try {
        put = await fetch(target.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        });
      } catch {
        throw new Error('The file could not be uploaded. Check your connection and try again.');
      }
      if (!put.ok) throw new Error('The file could not be uploaded. Please try again.');

      const recorded = await apiRequest<TicketAttachment | { attachment: TicketAttachment }>(
        `/api/tickets/${ticketId}/attachments`,
        {
          method: 'POST',
          body: JSON.stringify({ ...meta, storage_path: target.storagePath, comment_id: commentId ?? null }),
        },
      );
      return 'attachment' in (recorded as object) ? (recorded as { attachment: TicketAttachment }).attachment : (recorded as TicketAttachment);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
  });
}
