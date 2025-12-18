/**
 * Flight Deck Page
 * Student progress cockpit with visual gauges, charts, and smart insights
 * Session 1: Core infrastructure + placeholder layout
 */

import { memo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { 
  Gauge, 
  TrendingUp, 
  TrendingDown, 
  Minus,
  AlertCircle, 
  CheckCircle,
  Clock,
  DollarSign,
  BookOpen,
  Target,
  Lightbulb,
  RefreshCw,
  HelpCircle,
} from 'lucide-react';
import type { FlightDeckResult } from '@shared/flight-deck-engine';
import { 
  CreditsDonutChart, 
  PaceGaugeChart, 
  TimelineProjectionChart,
  CostBreakdownChart,
  ChartSkeleton,
} from '@/components/flight-deck-charts';

export default function FlightDeck() {
  const { data, isLoading, error, refetch } = useQuery<FlightDeckResult>({
    queryKey: ['/api/flight-deck'],
    retry: 2, // Retry failed requests twice
    retryDelay: 1000, // Wait 1 second between retries
    staleTime: 5 * 60 * 1000, // 5 minutes - data is fairly static
    gcTime: 10 * 60 * 1000, // 10 minutes - keep in cache longer
    refetchOnWindowFocus: false, // Disable auto-refetch on focus (expensive calculation)
  });

  if (isLoading) {
    return <FlightDeckSkeleton />;
  }

  if (error) {
    const errorMessage = error instanceof Error 
      ? error.message 
      : 'Failed to load Flight Deck data';
    
    return (
      <div className="p-6 space-y-4" data-testid="error-state">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-2">
              <p>{errorMessage}</p>
              <p className="text-sm">
                This could be due to a network issue or server error.
              </p>
            </div>
          </AlertDescription>
        </Alert>
        <Button
          onClick={() => refetch()}
          variant="outline"
          className="w-full md:w-auto"
          data-testid="button-retry"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">
              Flight Deck
            </h1>
            <p className="text-muted-foreground">
              Your complete progress overview at a glance
            </p>
          </div>
          <Badge 
            variant={data.alerts.level === 'green' ? 'default' : 'destructive'}
            data-testid={`badge-alert-${data.alerts.level}`}
          >
            {data.alerts.level === 'green' ? (
              <><CheckCircle className="w-3 h-3 mr-1" /> On Track</>
            ) : (
              <><AlertCircle className="w-3 h-3 mr-1" /> Action Needed</>
            )}
          </Badge>
        </div>

      {/* Summary Bar */}
      <SummaryBar data={data} />

      {/* Main Grid - 12 column responsive layout */}
      <div className="grid grid-cols-12 gap-6">
        {/* Credits Donut - spans 4 cols */}
        <div className="col-span-12 md:col-span-4">
          <Card data-testid="card-credits">
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-1">
                Credits
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Credits calculation information"
                      data-testid="button-tooltip-credits"
                    >
                      <HelpCircle className="w-3 h-3 text-muted-foreground" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80">
                    <p className="text-sm">Calculated from courses in your roadmap. Each enrollment contributes to your credit total.</p>
                  </PopoverContent>
                </Popover>
              </CardTitle>
              <BookOpen className="w-4 h-4" />
            </CardHeader>
            <CardContent>
              <CreditsDonutChart data={data} />
              <p className="text-sm text-muted-foreground text-center mt-2">
                {data.credits.remaining} of {data.credits.total} remaining
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Pace Gauge - spans 4 cols */}
        <div className="col-span-12 md:col-span-4">
          <Card data-testid="card-pace">
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-1">
                Pace
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Pace calculation information"
                      data-testid="button-tooltip-pace"
                    >
                      <HelpCircle className="w-3 h-3 text-muted-foreground" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80">
                    <p className="text-sm">Based on your target study hours per week and estimated hours per credit. Determines your completion timeline.</p>
                  </PopoverContent>
                </Popover>
              </CardTitle>
              <Gauge className="w-4 h-4" />
            </CardHeader>
            <CardContent>
              <PaceGaugeChart data={data} />
              <p className="text-sm text-muted-foreground text-center mt-2">
                Target: {data.pace.targetHours} hrs/week
              </p>
            </CardContent>
          </Card>
        </div>

        {/* ETA - spans 4 cols */}
        <div className="col-span-12 md:col-span-4">
          <Card data-testid="card-time-to-completion">
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-1">
                Time to Completion
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Time to completion calculation information"
                      data-testid="button-tooltip-eta"
                    >
                      <HelpCircle className="w-3 h-3 text-muted-foreground" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80">
                    <p className="text-sm">Calculated from remaining credits divided by your study pace. Based on current progress and target hours per week.</p>
                  </PopoverContent>
                </Popover>
              </CardTitle>
              <Clock className="w-4 h-4" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-time-to-completion-value">
                {data.eta.months} months
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                {data.eta.exceedsOneYear && (
                  <span className="text-destructive">Exceeds 12 months</span>
                )}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Timeline Chart - spans 8 cols */}
        <div className="col-span-12 md:col-span-8">
          <Card data-testid="card-timeline">
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Timeline Projection</CardTitle>
              <Target className="w-4 h-4" />
            </CardHeader>
            <CardContent>
              <TimelineProjectionChart data={data} />
              <p className="text-sm text-muted-foreground text-center mt-2">
                Projected completion in {data.eta.months} months
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Cost Breakdown - spans 4 cols */}
        <div className="col-span-12 md:col-span-4">
          <Card data-testid="card-cost-breakdown">
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-1">
                Cost Breakdown
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Cost calculation information"
                      data-testid="button-tooltip-cost"
                    >
                      <HelpCircle className="w-3 h-3 text-muted-foreground" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80">
                    <p className="text-sm">Calculated from provider pricing rules and UMPI session costs. Tuition based on duration and enrollment pattern.</p>
                  </PopoverContent>
                </Popover>
              </CardTitle>
              <DollarSign className="w-4 h-4" />
            </CardHeader>
            <CardContent>
              <CostBreakdownChart data={data} />
              <div className="mt-2 space-y-1">
                <p className="text-sm text-muted-foreground text-center">
                  Total: ${data.cost.projectedTotal.toLocaleString()}
                </p>
                <Badge 
                  variant={data.cost.state === 'On Track' ? 'default' : 'destructive'}
                  className="mx-auto flex w-fit"
                  data-testid={`badge-cost-state`}
                >
                  {data.cost.state}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Payment Progress - spans 6 cols */}
        <div className="col-span-12 md:col-span-6">
          <PlaceholderCard
            title="Payment Progress"
            icon={<DollarSign className="w-4 h-4" />}
            value={`$${data.payments.paidToDate.toLocaleString()} paid`}
          >
            <p className="text-sm text-muted-foreground">
              ${data.payments.remainingBalance.toLocaleString()} remaining
            </p>
          </PlaceholderCard>
        </div>

        {/* Trend - spans 6 cols */}
        <div className="col-span-12 md:col-span-6">
          <PlaceholderCard
            title="Cost Trend"
            icon={
              data.trend.direction === 'up' ? <TrendingUp className="w-4 h-4" /> :
              data.trend.direction === 'down' ? <TrendingDown className="w-4 h-4" /> :
              <Minus className="w-4 h-4" />
            }
            value={
              data.trend.direction === 'flat' ? 'Stable' :
              `${data.trend.direction === 'up' ? '+' : ''}$${Math.abs(data.trend.deltaTotal).toLocaleString()}`
            }
          >
            <p className="text-sm text-muted-foreground">
              {data.trend.direction === 'flat' ? 'No change from last week' : 
               `${Math.abs(data.trend.percentChange).toFixed(1)}% vs last week`}
            </p>
          </PlaceholderCard>
        </div>
      </div>

      {/* Insights & Alerts Strip */}
      <InsightsStrip data={data} />
    </div>
  );
}

// ============================================================================
// COMPONENTS
// ============================================================================

const SummaryBar = memo(function SummaryBar({ data }: { data: FlightDeckResult }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <Card data-testid="card-summary-credits">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Credits</p>
              <p className="text-2xl font-bold" data-testid="text-credits-total">
                {data.credits.completed + data.credits.inProgress}
              </p>
            </div>
            <BookOpen className="w-8 h-8 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-summary-pace">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Weekly Hours</p>
              <p className="text-2xl font-bold" data-testid="text-pace-hours">
                {data.pace.currentHours}
              </p>
            </div>
            <Gauge className="w-8 h-8 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-summary-eta">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Months to Go</p>
              <p className="text-2xl font-bold" data-testid="text-eta-months">
                {data.eta.months}
              </p>
            </div>
            <Clock className="w-8 h-8 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-summary-cost">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total Cost</p>
              <p className="text-2xl font-bold" data-testid="text-cost-total">
                ${data.cost.projectedTotal.toLocaleString()}
              </p>
            </div>
            <DollarSign className="w-8 h-8 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
});

function InsightsStrip({ data }: { data: FlightDeckResult }) {
  // Helper to map icon hints to lucide icons
  const getIcon = (iconHint?: string) => {
    const iconClass = "w-4 h-4";
    switch (iconHint) {
      case 'alert': return <AlertCircle className={iconClass} />;
      case 'check': return <CheckCircle className={iconClass} />;
      case 'trend-up': return <TrendingUp className={iconClass} />;
      case 'dollar': return <DollarSign className={iconClass} />;
      case 'clock': return <Clock className={iconClass} />;
      case 'lightbulb': return <Lightbulb className={iconClass} />;
      default: return <AlertCircle className={iconClass} />;
    }
  };

  return (
    <div className="space-y-4">
      {/* One-year warning */}
      {data.alerts.oneYearWarning && (
        <Alert variant="destructive" data-testid="alert-one-year-warning">
          <AlertCircle className="h-4 h-4" />
          <AlertDescription>{data.alerts.oneYearWarning}</AlertDescription>
        </Alert>
      )}

      {/* General alerts */}
      {data.alerts.messages.length > 0 && (
        <Alert 
          variant={data.alerts.level === 'green' ? 'default' : 'destructive'}
          data-testid="alert-general"
        >
          {data.alerts.level === 'green' ? (
            <CheckCircle className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          <AlertDescription>
            {data.alerts.messages.join(' | ')}
          </AlertDescription>
        </Alert>
      )}

      {/* Budget Watch */}
      {data.insights.budget.warnings.length > 0 && (
        <Card data-testid="card-budget-watch">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5" />
              Budget Watch
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.insights.budget.warnings.map((warning, idx) => (
              <Alert 
                key={idx} 
                variant="destructive"
                data-testid={`alert-budget-${idx}`}
              >
                {getIcon(warning.icon)}
                <AlertDescription>{warning.message}</AlertDescription>
              </Alert>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Milestones & Celebrations */}
      {data.insights.milestones.celebrations.length > 0 && (
        <Card data-testid="card-milestones">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5" />
              Milestones
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.insights.milestones.celebrations.map((celebration, idx) => (
              <Alert 
                key={idx} 
                variant="default"
                data-testid={`alert-milestone-${idx}`}
              >
                {getIcon(celebration.icon)}
                <AlertDescription>{celebration.message}</AlertDescription>
              </Alert>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Next Best Actions */}
      {(data.insights.recommendations.pace.length > 0 || 
        data.insights.recommendations.credits.length > 0 ||
        data.insights.recommendations.budget.length > 0) && (
        <Card data-testid="card-recommendations">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lightbulb className="w-5 h-5" />
              Next Best Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Pace recommendations */}
            {data.insights.recommendations.pace.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">Pace</h4>
                <div className="space-y-2">
                  {data.insights.recommendations.pace.map((rec, idx) => (
                    <div 
                      key={idx} 
                      className="flex items-start gap-2 text-sm"
                      data-testid={`rec-pace-${idx}`}
                    >
                      {getIcon(rec.icon)}
                      <span>{rec.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Credits recommendations */}
            {data.insights.recommendations.credits.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">Credits</h4>
                <div className="space-y-2">
                  {data.insights.recommendations.credits.map((rec, idx) => (
                    <div 
                      key={idx} 
                      className="flex items-start gap-2 text-sm"
                      data-testid={`rec-credits-${idx}`}
                    >
                      {getIcon(rec.icon)}
                      <span>{rec.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Budget recommendations */}
            {data.insights.recommendations.budget.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">Budget</h4>
                <div className="space-y-2">
                  {data.insights.recommendations.budget.map((rec, idx) => (
                    <div 
                      key={idx} 
                      className="flex items-start gap-2 text-sm"
                      data-testid={`rec-budget-${idx}`}
                    >
                      {getIcon(rec.icon)}
                      <span>{rec.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Smart insights (legacy summary) */}
      <Card data-testid="card-insights">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="w-5 h-5" />
            Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm" data-testid="text-insight-summary">
            {data.insights.summary}
          </p>
          {data.insights.smartTip && (
            <p className="text-sm text-muted-foreground" data-testid="text-insight-tip">
              {data.insights.smartTip}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PlaceholderCard({ 
  title, 
  icon, 
  value, 
  children 
}: { 
  title: string; 
  icon: React.ReactNode; 
  value: string; 
  children?: React.ReactNode;
}) {
  return (
    <Card data-testid={`card-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold" data-testid={`text-${title.toLowerCase().replace(/\s+/g, '-')}-value`}>
          {value}
        </div>
        <div className="mt-2">
          {children}
        </div>
      </CardContent>
    </Card>
  );
}

function FlightDeckSkeleton() {
  return (
    <div className="p-6 space-y-6">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-6 w-24" />
      </div>
      
      {/* Summary bar skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      
      {/* Charts skeleton - match actual layout */}
      <div className="grid grid-cols-12 gap-6">
        {/* Credits donut skeleton */}
        <div className="col-span-12 md:col-span-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-4" />
            </CardHeader>
            <CardContent>
              <ChartSkeleton />
            </CardContent>
          </Card>
        </div>
        
        {/* Pace gauge skeleton */}
        <div className="col-span-12 md:col-span-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-4" />
            </CardHeader>
            <CardContent>
              <ChartSkeleton />
            </CardContent>
          </Card>
        </div>
        
        {/* ETA skeleton */}
        <div className="col-span-12 md:col-span-4">
          <Skeleton className="h-80" />
        </div>
        
        {/* Timeline skeleton */}
        <div className="col-span-12 md:col-span-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-4" />
            </CardHeader>
            <CardContent>
              <ChartSkeleton />
            </CardContent>
          </Card>
        </div>
        
        {/* Cost breakdown skeleton */}
        <div className="col-span-12 md:col-span-4">
          <Skeleton className="h-80" />
        </div>
        
        {/* Additional cards skeleton */}
        {[...Array(2)].map((_, i) => (
          <div key={i} className="col-span-12 md:col-span-6">
            <Skeleton className="h-48" />
          </div>
        ))}
      </div>
    </div>
  );
}
