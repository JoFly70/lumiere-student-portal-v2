import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, getAuthToken } from '@/lib/api';
import type { StudentDocument } from '@shared/schema';

export interface DocumentFilters {
  docType?: string;
  status?: string;
  requirementOnly?: boolean;
}

export interface GenerateUploadUrlInput {
  doc_type: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  student_code: string;
}

// Mirrors the server's presigned upload response (snake_case).
export interface GenerateUploadUrlResponse {
  upload_url: string;
  upload_token: string;
  storage_path: string;
  expires_in: number;
}

// Metadata only. storage_path must be the value returned by the upload-url
// endpoint; status/verification/url are server-controlled.
export interface CreateDocumentInput {
  doc_type: string;
  file_name: string;
  storage_path: string;
  issuer?: string | null;
  doc_date?: string | null;
  score?: string | null;
  country?: string | null;
  notes?: string | null;
}

export type DocumentWithDownloadUrl = StudentDocument & {
  download_url: string;
  download_expires_in?: number;
};

// GET /api/documents/:id returns the record plus a short-lived signed download URL.
export function fetchDocumentWithDownloadUrl(documentId: string): Promise<DocumentWithDownloadUrl> {
  return apiRequest<DocumentWithDownloadUrl>(`/api/documents/${encodeURIComponent(documentId)}`);
}

export function useDocuments(studentId: string | null, filters?: DocumentFilters) {
  const queryParams = new URLSearchParams();
  if (filters?.docType) queryParams.set('docType', filters.docType);
  if (filters?.status) queryParams.set('status', filters.status);
  if (filters?.requirementOnly) queryParams.set('requirementOnly', 'true');

  return useQuery<StudentDocument[]>({
    queryKey: ['documents', studentId, filters],
    queryFn: async () => {
      const url = `/api/documents/student/${studentId}${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
      return apiRequest(url);
    },
    enabled: !!studentId,
  });
}

export function useGenerateUploadUrl(studentId: string | null) {
  return useMutation<GenerateUploadUrlResponse, Error, GenerateUploadUrlInput>({
    mutationFn: async (data) => {
      return apiRequest(`/api/documents/student/${studentId}/upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },
  });
}

export function useCreateDocument(studentId: string | null) {
  const queryClient = useQueryClient();

  return useMutation<StudentDocument, Error, CreateDocumentInput>({
    mutationFn: async (data) => {
      return apiRequest(`/api/documents/student/${studentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', studentId] });
    },
  });
}

export function useDeleteDocument(studentId: string | null) {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (documentId) => {
      return apiRequest(`/api/documents/${documentId}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', studentId] });
    },
  });
}

export function useMyProfile() {
  return useQuery<{ id: string; student_code: string } | null>({
    queryKey: ['student', 'me'],
    queryFn: async () => {
      try {
        const headers: Record<string, string> = {};
        const token = getAuthToken();
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }
        const response = await fetch('/api/students/me', { headers, credentials: 'include' });
        if (!response.ok) {
          if (response.status === 404) {
            return null;
          }
          throw new Error(`Failed to fetch profile: ${response.status}`);
        }
        return response.json();
      } catch (error) {
        console.error('Error fetching profile:', error);
        return null;
      }
    },
  });
}
