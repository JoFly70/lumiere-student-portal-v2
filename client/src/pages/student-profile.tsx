import { useStudentProfile, useLiveProfileActions } from "@/hooks/use-student-profile";
import { ProfileActionsProvider } from "@/components/profile/profile-actions";
import { ProfileErrorState, ProfileNotReady, ProfilePageView, ProfileSkeleton } from "@/components/profile/profile-page-view";

/**
 * Student profile (S09). Reads GET /api/students/me/profile and renders the
 * prop-driven ProfilePageView; all edits go through the live actions, which
 * refetch the profile afterwards.
 */
export default function StudentProfile() {
  const { data: profile, isLoading, isError, refetch } = useStudentProfile();
  const actions = useLiveProfileActions(profile?.identity.studentId);

  if (isLoading) return <ProfileSkeleton />;
  if (isError) return <ProfileErrorState onRetry={() => void refetch()} />;
  if (!profile) return <ProfileNotReady />;
  return (
    <ProfileActionsProvider value={actions}>
      <ProfilePageView profile={profile} />
    </ProfileActionsProvider>
  );
}
