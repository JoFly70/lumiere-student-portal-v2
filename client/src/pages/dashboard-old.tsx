import { GraduationCap, BookOpen, TrendingUp, Award } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { ProgressCard } from "@/components/progress-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";

type UserProfile = {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
  plan: {
    id: string;
    program_id: string;
    catalog_year: number;
  } | null;
  progress: {
    phase1Completed: number;
    phase1Total: number;
    phase2Completed: number;
    phase2Total: number;
    totalCredits: number;
    currentPhase: number;
  };
};

export default function Dashboard() {
  const { data: profile, isLoading, isError, error } = useQuery<UserProfile>({
    queryKey: ['/api/me'],
    retry: false,
  });

  // Handle 401 errors by clearing tokens and redirecting
  useEffect(() => {
    if (isError && error) {
      const errorMessage = error.message || '';
      // Detect 401 unauthorized errors (from status code in error message)
      if (errorMessage.includes('401') || errorMessage.toLowerCase().includes('unauthorized') || errorMessage.toLowerCase().includes('not authenticated')) {
        sessionStorage.removeItem('sb_access_token');
        sessionStorage.removeItem('sb_refresh_token');
        window.location.href = '/';
      }
    }
  }, [isError, error]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="text-lg text-muted-foreground">Loading your progress...</div>
        </div>
      </div>
    );
  }

  if (isError || !profile) {
    const errorMessage = error?.message || '';
    
    // Network or unknown errors - show retry option
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="text-lg font-semibold text-destructive">Failed to load profile</div>
          <p className="text-sm text-muted-foreground mt-2">
            {errorMessage || 'Network error. Please check your connection and try again.'}
          </p>
          <div className="flex gap-3 mt-4 justify-center">
            <button 
              onClick={() => window.location.reload()} 
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
            >
              Retry
            </button>
            <button 
              onClick={() => window.location.href = '/'} 
              className="px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/90"
            >
              Return to Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { progress } = profile;
  const phase1Remaining = progress.phase1Total - progress.phase1Completed;
  const currentPhase = progress.currentPhase === 1 ? "Phase 1" : "Phase 2";
  const currentPhaseLabel = progress.currentPhase === 1 ? "Transfer Credits" : "UMPI Residency";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="text-page-title">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Track your degree progress and manage your academic journey</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <ProgressCard
          title="Phase 1: Transfer Credits"
          icon={BookOpen}
          value={progress.phase1Completed}
          total={progress.phase1Total}
          label="ACE, Sophia, Study.com"
          variant="primary"
        />
        <ProgressCard
          title="Phase 2: UMPI Credits"
          icon={GraduationCap}
          value={progress.phase2Completed}
          total={progress.phase2Total}
          label="Residency Requirement"
        />
        <ProgressCard
          title="Total Credits"
          icon={TrendingUp}
          value={progress.totalCredits}
          total={120}
          label="Bachelor's Degree"
        />
        <Card data-testid="card-current-phase">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Current Phase</CardTitle>
            <Award className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{currentPhase}</div>
            <p className="text-xs text-muted-foreground mt-1">{currentPhaseLabel}</p>
            <StatusBadge status={progress.phase1Completed > 0 ? "in-progress" : "pending"} className="mt-3" />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Phase 1: Transfer Credits</CardTitle>
            <CardDescription>Complete 90 credits through ACE, Sophia, and Study.com</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="font-medium">Total Progress</span>
                <span className="text-muted-foreground font-mono">{progress.phase1Completed}/{progress.phase1Total}</span>
              </div>
              <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full bg-chart-1 rounded-full transition-all"
                  style={{ width: `${(progress.phase1Completed / progress.phase1Total) * 100}%` }}
                />
              </div>
            </div>
            <div className="pt-2 border-t space-y-2">
              <p className="text-sm text-muted-foreground">Requirements</p>
              <ul className="space-y-1 text-sm">
                <li className="flex items-start gap-2">
                  <span className={progress.phase1Completed > 0 ? "text-green-600 dark:text-green-400 mt-0.5" : "text-gray-400 mt-0.5"}>
                    {progress.phase1Completed > 0 ? "✓" : "○"}
                  </span>
                  <span>Map courses to UMPI distribution requirements</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 dark:text-blue-400 mt-0.5">→</span>
                  <span>Complete remaining {phase1Remaining} credits</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-gray-400 mt-0.5">○</span>
                  <span>Submit official transcripts</span>
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Phase 2: UMPI Residency</CardTitle>
            <CardDescription>Complete 30 credits at UMPI to earn your degree</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="font-medium">UMPI Courses</span>
                <span className="text-muted-foreground font-mono">{progress.phase2Completed}/{progress.phase2Total}</span>
              </div>
              <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${progress.phase2Total > 0 ? (progress.phase2Completed / progress.phase2Total) * 100 : 0}%` }}
                />
              </div>
            </div>
            <div className="pt-2 border-t space-y-2">
              <p className="text-sm text-muted-foreground">Requirements</p>
              <ul className="space-y-1 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-gray-400 mt-0.5">○</span>
                  <span>Complete Phase 1 transfer credits</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-gray-400 mt-0.5">○</span>
                  <span>Enroll in UMPI competency-based program</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-gray-400 mt-0.5">○</span>
                  <span>Complete 10 courses (3 credits each)</span>
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
