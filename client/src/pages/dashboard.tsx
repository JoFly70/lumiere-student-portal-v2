import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, Sparkles, Clock, DollarSign, GraduationCap, Building2, BookOpen } from "lucide-react";

// API Response Types
interface SystemStatus {
  schema_ready: boolean;
  reason: string;
}

interface UserProfile {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
  plan: any;
  progress: any;
}

interface DegreeTemplate {
  id: string;
  university: string;
  degree_name: string;
  total_credits: number;
  min_upper_credits: number;
  residency_credits: number;
  capstone_code: string | null;
}

interface PlanStep {
  step_index: number;
  item_type: string;
  ref_code: string;
  title: string;
  credits: number;
  est_cost: string;
  est_weeks: number;
}

interface FinancialData {
  projected_total: number;
  upfront_due: number;
  monthly_payment: number;
  payment_months: number;
  monthly_schedule: Array<{
    month: number;
    payment_amount: number;
    payment_method: string;
    total_paid: number;
    remaining_balance: number;
  }>;
  includes_premium_exam: boolean;
  premium_exam_cost: number;
  duration_multiplier: number;
  completion_target: string;
}

interface GeneratePlanResponse {
  plan_id: string;
  summary: {
    totalCredits: number;
    totalCost: number;
    estMonths: number;
    upperLevelCredits: number;
    residencyCredits: number;
    remainingCredits: number;
  };
  steps: PlanStep[];
  financials?: FinancialData;
}

interface PlanData {
  plan: {
    id: string;
    total_remaining_credits: number;
    est_cost: string;
    est_months: number;
  };
  template: DegreeTemplate | null;
  steps: PlanStep[];
}

// Setup Required Component
function SetupRequired({ reason }: { reason?: string }) {
  return (
    <div className="max-w-2xl mx-auto mt-12">
      <Alert data-testid="alert-setup-required">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Database Setup Required</AlertTitle>
        <AlertDescription className="mt-2">
          <p className="mb-2">{reason || "The simplified schema hasn't been initialized yet."}</p>
          <p className="text-sm text-muted-foreground">
            Please run the SQL initialization script in Supabase SQL Editor:
          </p>
          <code className="block mt-2 p-2 bg-muted rounded text-xs">
            migrations/003_simplified_schema.sql
          </code>
        </AlertDescription>
      </Alert>
    </div>
  );
}

// Empty State Component
function EmptyState() {
  return (
    <Card data-testid="card-empty-state" className="max-w-2xl mx-auto mt-8">
      <CardHeader className="text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <GraduationCap className="h-6 w-6 text-primary" />
        </div>
        <CardTitle>Ready to Build Your Degree Plan?</CardTitle>
        <CardDescription>
          Click "Generate Your Plan" above to create a personalized roadmap to your degree
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

// Summary Cards Component
function SummaryCards({ plan, steps }: { plan: PlanData['plan']; steps: PlanStep[] }) {
  // Calculate metrics from plan and steps
  const totalCredits = steps.reduce((sum, step) => sum + step.credits, 0);
  const totalCost = parseFloat(plan.est_cost || '0');
  const ulCredits = steps.filter(s => s.item_type === 'university_session').reduce((sum, s) => sum + s.credits, 0);
  const residencyCredits = ulCredits; // For now, assume university_session = residency
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
      <Card data-testid="card-summary-total-credits">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Credits</CardTitle>
          <BookOpen className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{totalCredits}</div>
          <p className="text-xs text-muted-foreground">
            {plan.total_remaining_credits} remaining
          </p>
        </CardContent>
      </Card>

      <Card data-testid="card-summary-cost">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Est. Cost</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">${totalCost.toFixed(0)}</div>
          <p className="text-xs text-muted-foreground">Total investment</p>
        </CardContent>
      </Card>

      <Card data-testid="card-summary-months">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Est. Time</CardTitle>
          <Clock className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{plan.est_months}mo</div>
          <p className="text-xs text-muted-foreground">At current pace</p>
        </CardContent>
      </Card>

      <Card data-testid="card-summary-ul">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Upper-Level</CardTitle>
          <GraduationCap className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{ulCredits}</div>
          <p className="text-xs text-muted-foreground">UL credits (need 30)</p>
        </CardContent>
      </Card>

      <Card data-testid="card-summary-residency">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Residency</CardTitle>
          <Building2 className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{residencyCredits}</div>
          <p className="text-xs text-muted-foreground">University credits (need 30)</p>
        </CardContent>
      </Card>
    </div>
  );
}

// Financial Breakdown Component
function FinancialBreakdown({ financials }: { financials: FinancialData }) {
  return (
    <div className="space-y-4 mb-8">
      <h2 className="text-2xl font-semibold">Financial Overview</h2>
      
      {/* Cost Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card data-testid="card-financial-total">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Projected Total</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${financials.projected_total.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">
              Complete program cost
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-financial-upfront">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Upfront Payment</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${financials.upfront_due.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">
              Due at enrollment
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-financial-monthly">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Monthly Payment</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${financials.monthly_payment.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">
              {financials.payment_months} monthly payments
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Timeline & Schedule */}
      <Card data-testid="card-payment-schedule">
        <CardHeader>
          <CardTitle>Payment Schedule</CardTitle>
          <CardDescription>
            Target completion: {new Date(financials.completion_target).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            {financials.includes_premium_exam && (
              <Badge className="ml-2" variant="secondary">
                Includes Premium Exam (${financials.premium_exam_cost})
              </Badge>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b">
                  <th className="text-left py-2 px-2">Month</th>
                  <th className="text-right py-2 px-2">Payment</th>
                  <th className="text-right py-2 px-2">Total Paid</th>
                  <th className="text-right py-2 px-2">Remaining</th>
                </tr>
              </thead>
              <tbody>
                {financials.monthly_schedule.map((item, index) => (
                  <tr key={index} className="border-b last:border-0">
                    <td className="py-2 px-2">Month {item.month}</td>
                    <td className="text-right py-2 px-2">${item.payment_amount.toFixed(2)}</td>
                    <td className="text-right py-2 px-2 text-muted-foreground">${item.total_paid.toFixed(2)}</td>
                    <td className="text-right py-2 px-2 text-muted-foreground">${item.remaining_balance.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Steps List Component
function StepsList({ steps }: { steps: any[] }) {
  return (
    <Card data-testid="card-steps-list">
      <CardHeader>
        <CardTitle>Your Roadmap ({steps.length} courses)</CardTitle>
        <CardDescription>Complete these courses in order to earn your degree</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {steps.map((step, index) => (
            <Card 
              key={step.step_index} 
              data-testid={`card-step-${index}`}
              className="hover-elevate"
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-muted-foreground">
                        Step {step.step_index}
                      </span>
                      <Badge 
                        variant={step.item_type === 'university_session' ? 'default' : 'secondary'}
                        data-testid={`badge-provider-${index}`}
                      >
                        {step.item_type === 'university_session' ? 'University' : 'Online'}
                      </Badge>
                    </div>
                    <h4 className="font-medium mb-1">{step.title}</h4>
                    <p className="text-sm text-muted-foreground">{step.ref_code}</p>
                  </div>
                  <div className="text-right space-y-1">
                    <div className="text-sm">
                      <span className="font-medium">{step.credits}</span> credits
                    </div>
                    <div className="text-sm text-muted-foreground">
                      ${parseFloat(step.est_cost || '0').toFixed(0)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      ~{step.est_weeks || 0} weeks
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// Main Dashboard Component
export default function Dashboard() {
  const { toast } = useToast();
  const [paceHours, setPaceHours] = useState("12");
  const [paceMonths, setPaceMonths] = useState("12");
  const [planId, setPlanId] = useState<string | null>(() => {
    // Initialize from sessionStorage
    return sessionStorage.getItem('roadmap_plan_id');
  });
  const [financials, setFinancials] = useState<FinancialData | null>(() => {
    // Initialize from sessionStorage
    const stored = sessionStorage.getItem('roadmap_financials');
    return stored ? JSON.parse(stored) : null;
  });

  // Persist planId and financials to sessionStorage
  useEffect(() => {
    if (planId) {
      sessionStorage.setItem('roadmap_plan_id', planId);
    }
  }, [planId]);

  useEffect(() => {
    if (financials) {
      sessionStorage.setItem('roadmap_financials', JSON.stringify(financials));
    }
  }, [financials]);

  // System check query
  const { data: systemStatus, isLoading: isCheckingSystem } = useQuery<SystemStatus>({
    queryKey: ['/api/system/check'],
  });

  // Get current user
  const { data: userData } = useQuery<UserProfile>({
    queryKey: ['/api/me'],
    enabled: systemStatus?.schema_ready === true,
  });

  // Fetch default template (first one)
  const { data: templates } = useQuery<DegreeTemplate[]>({
    queryKey: ['/api/degree-templates'],
    enabled: systemStatus?.schema_ready === true,
  });

  // Generate plan mutation
  const generatePlan = useMutation<GeneratePlanResponse, Error, { user_id: string; template_id: string; pace_hours_per_week: number; pace_months: number }>({
    mutationFn: async (data) => {
      const res = await apiRequest('POST', '/api/generate-plan', data);
      return await res.json() as GeneratePlanResponse;
    },
    onSuccess: (result) => {
      setPlanId(result.plan_id);
      if (result.financials) {
        setFinancials(result.financials);
      }
      queryClient.invalidateQueries({ queryKey: ['/api/plans', result.plan_id] });
      toast({
        title: "Plan Generated!",
        description: `Your roadmap has been created with ${result.steps?.length || 0} courses.`,
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Generation Failed",
        description: error.message || "Failed to generate plan. Please try again.",
      });
    },
  });

  // Fetch plan query (only if planId exists)
  const { data: planData, isLoading: isLoadingPlan } = useQuery<PlanData>({
    queryKey: ['/api/plans', planId],
    enabled: !!planId,
  });

  // Handle generate click
  const handleGenerate = () => {
    if (!userData?.user?.id) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "User ID not found. Please refresh the page.",
      });
      return;
    }

    const templateId = templates?.[0]?.id;
    if (!templateId) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "No degree template found. Please run the SQL initialization.",
      });
      return;
    }

    generatePlan.mutate({
      user_id: userData.user.id,
      template_id: templateId,
      pace_hours_per_week: parseInt(paceHours),
      pace_months: parseInt(paceMonths),
    });
  };

  // Loading state
  if (isCheckingSystem) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full max-w-md" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  // Schema not ready
  if (!systemStatus?.schema_ready) {
    return <SetupRequired reason={systemStatus?.reason} />;
  }

  const hasPlan = !!planData;

  return (
    <div className="space-y-6">
      {/* Header with Generate Button */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Your Degree Roadmap</h1>
          <p className="text-muted-foreground mt-1">
            Deterministic plan generation - no AI needed
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select 
            value={paceHours} 
            onValueChange={setPaceHours}
            data-testid="select-pace-hours"
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Study pace" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="8">8 hrs/week (Slow)</SelectItem>
              <SelectItem value="12">12 hrs/week (Moderate)</SelectItem>
              <SelectItem value="16">16 hrs/week (Fast)</SelectItem>
              <SelectItem value="20">20 hrs/week (Very Fast)</SelectItem>
            </SelectContent>
          </Select>
          <Select 
            value={paceMonths} 
            onValueChange={setPaceMonths}
            data-testid="select-pace-months"
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Target duration" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="6">6 months (Sprint)</SelectItem>
              <SelectItem value="9">9 months (Fast)</SelectItem>
              <SelectItem value="12">12 months (Standard)</SelectItem>
              <SelectItem value="15">15 months (Relaxed)</SelectItem>
              <SelectItem value="18">18 months (Extended)</SelectItem>
            </SelectContent>
          </Select>
          <Button
            onClick={handleGenerate}
            disabled={generatePlan.isPending}
            data-testid="button-generate-plan"
            size="default"
          >
            {generatePlan.isPending ? (
              <>
                <span className="animate-spin mr-2">⏳</span>
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                {hasPlan ? 'Regenerate Plan' : 'Generate Your Plan'}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Loading skeleton */}
      {isLoadingPlan && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {/* Summary Cards */}
      {planData && !isLoadingPlan && (
        <SummaryCards plan={planData.plan} steps={planData.steps} />
      )}

      {/* Financial Breakdown */}
      {planData && !isLoadingPlan && financials && (
        <FinancialBreakdown financials={financials} />
      )}

      {/* Steps List */}
      {planData && !isLoadingPlan && planData.steps && planData.steps.length > 0 && (
        <StepsList steps={planData.steps} />
      )}

      {/* Empty State */}
      {!hasPlan && !generatePlan.isPending && !isLoadingPlan && (
        <EmptyState />
      )}
    </div>
  );
}
