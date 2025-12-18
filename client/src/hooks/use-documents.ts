import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
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

export interface GenerateUploadUrlResponse {
  uploadUrl: string;
  storagePath: string;
  publicUrl: string;
}

export interface CreateDocumentInput {
  doc_type: string;
  file_name: string;
  storage_path: string;
  url: string;
  issuer?: string | null;
  doc_date?: string | null;
  score?: string | null;
  country?: string | null;
  notes?: string | null;
  visibility: 'student_staff' | 'staff_only' | 'public';
  required_for_enrollment?: boolean;
  status: 'pending' | 'verified' | 'rejected' | 'resubmit_requested';
  soft_deleted?: boolean;
  admin_notes?: string | null;
  ocr_text?: string | null;
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
        const response = await fetch('/api/students/me');
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
