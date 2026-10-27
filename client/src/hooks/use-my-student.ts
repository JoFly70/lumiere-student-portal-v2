import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth, useAuthToken } from "@/lib/auth";
import { PROFILE_QUERY_KEY } from "@/hooks/use-student-profile";

export interface MyStudent {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  photo_url?: string | null;
}

async function fetchMyStudent(accessToken: string | null): Promise<MyStudent | null> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const response = await fetch("/api/students/me", { credentials: "include", headers });
    if (!response.ok) return null;
    return (await response.json()) as MyStudent;
  } catch {
    return null;
  }
}

/**
 * The signed-in student's record, under the SAME react-query key the sidebar uses (["/api/students/me", userId]).
 * The photo in the header, the sidebar and the profile page therefore always come from one cache entry.
 */
export function useMyStudent(enabled = true) {
  const { user } = useAuth();
  const token = useAuthToken();
  return useQuery({
    queryKey: ["/api/students/me", user?.id],
    queryFn: () => fetchMyStudent(token),
    retry: false,
    enabled,
  });
}

/** After any photo change: refresh every view that shows it (header, sidebar, profile). */
export function usePhotoChanged() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["/api/students/me"] });
    void qc.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
  };
}
