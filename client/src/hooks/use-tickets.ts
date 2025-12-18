import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';

export interface Ticket {
  id: string;
  ticket_number: string;
  subject: string;
  description: string;
  category: 'academic' | 'technical' | 'billing' | 'document' | 'enrollment' | 'general';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'waiting_on_student' | 'resolved' | 'closed';
  created_at: string;
  updated_at: string;
  reporter_id: string;
  reporter_name: string;
  reporter_email: string;
  assigned_to?: string | null;
  resolved_at?: string | null;
  resolved_by?: string | null;
  resolution_notes?: string | null;
  ticket_comments?: TicketComment[];
  ticket_attachments?: TicketAttachment[];
  ticket_status_history?: StatusHistory[];
}

export interface TicketComment {
  id: string;
  ticket_id: string;
  author_id: string;
  author_name: string;
  author_role: string;
  content: string;
  is_internal: boolean;
  created_at: string;
}

export interface TicketAttachment {
  id: string;
  ticket_id: string;
  filename: string;
  file_size: number;
  file_type: string;
  storage_path: string;
  uploaded_by: string;
  created_at: string;
}

export interface StatusHistory {
  id: string;
  ticket_id: string;
  from_status: string;
  to_status: string;
  changed_by: string;
  changed_at: string;
}

export interface CreateTicketInput {
  subject: string;
  description: string;
  category: 'academic' | 'technical' | 'billing' | 'document' | 'enrollment' | 'general';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
}

export interface UpdateTicketInput {
  subject?: string;
  description?: string;
  status?: 'open' | 'in_progress' | 'waiting_on_student' | 'resolved' | 'closed';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  assignedTo?: string | null;
  resolutionNotes?: string;
}

export interface CreateCommentInput {
  content: string;
  isInternal?: boolean;
}

export interface TicketsResponse {
  tickets: Ticket[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
}

export function useTickets(filters?: {
  status?: string;
  category?: string;
  priority?: string;
  search?: string;
}) {
  const queryParams = new URLSearchParams();
  if (filters?.status) queryParams.set('status', filters.status);
  if (filters?.category) queryParams.set('category', filters.category);
  if (filters?.priority) queryParams.set('priority', filters.priority);
  if (filters?.search) queryParams.set('search', filters.search);

  return useQuery<TicketsResponse>({
    queryKey: ['tickets', filters],
    queryFn: async () => {
      const url = `/api/tickets${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
      return apiRequest(url);
    },
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

  return useMutation<{ comment: TicketComment }, Error, CreateCommentInput>({
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
  storagePath: string;
  publicUrl: string;
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

  return useMutation<TicketAttachment, Error, CreateAttachmentInput>({
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
