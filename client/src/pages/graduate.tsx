import { useGraduateProgram, useLiveGraduateActions } from "@/hooks/use-graduate-program";
import { GraduateActionsProvider } from "@/components/graduate/graduate-actions";
import { GraduateErrorState, GraduatePageView, GraduateSkeleton } from "@/components/graduate/graduate-page-view";

/**
 * Student "My Master's" (S12). Reads GET /api/student/graduate and renders the
 * prop-driven GraduatePageView; edits go through the live actions.
 */
export default function Graduate() {
  const { data, isLoading, isError, refetch } = useGraduateProgram();
  const actions = useLiveGraduateActions();

  if (isLoading) return <GraduateSkeleton />;
  if (isError || !data) return <GraduateErrorState onRetry={() => void refetch()} />;
  return (
    <GraduateActionsProvider value={actions}>
      <GraduatePageView view={data} />
    </GraduateActionsProvider>
  );
}
