/**
 * Flight Deck Charts
 * Visual components for student progress dashboard
 * Session 2: Credits Donut, Pace Gauge, Timeline Projection
 */

import { memo } from 'react';
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer,
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import type { FlightDeckResult } from '@shared/flight-deck-engine';

// ============================================================================
// THEME & COLORS
// ============================================================================

const chartTheme = {
  credits: {
    completed: 'hsl(var(--primary))',
    inProgress: 'hsl(var(--chart-2))',
    remaining: 'hsl(var(--muted))',
  },
  pace: {
    slow: 'hsl(var(--destructive))',
    onTrack: 'hsl(var(--chart-3))',
    excellent: 'hsl(var(--primary))',
  },
  timeline: {
    area: 'hsl(var(--primary))',
    areaOpacity: 0.3,
    line: 'hsl(var(--primary))',
  },
  costs: {
    lumiereFee: 'hsl(var(--primary))',
    providerCost: 'hsl(var(--chart-2))',
    umpiCost: 'hsl(var(--chart-3))',
  },
};

// ============================================================================
// DATA HELPERS
// ============================================================================

interface CreditSegment {
  name: string;
  value: number;
  color: string;
}

function prepareCreditsData(credits: FlightDeckResult['credits']): CreditSegment[] {
  return [
    { name: 'Completed', value: credits.completed, color: chartTheme.credits.completed },
    { name: 'In Progress', value: credits.inProgress, color: chartTheme.credits.inProgress },
    { name: 'Remaining', value: credits.remaining, color: chartTheme.credits.remaining },
  ];
}

interface PaceGaugeData {
  name: string;
  value: number;
  fill: string;
}

function preparePaceData(pace: FlightDeckResult['pace']): PaceGaugeData[] {
  const percent = pace.percentOfTarget;
  
  // Determine color zone: <70% = slow, 70-100% = on track, >100% = excellent
  let fill = chartTheme.pace.onTrack;
  if (percent < 70) {
    fill = chartTheme.pace.slow;
  } else if (percent > 100) {
    fill = chartTheme.pace.excellent;
  }
  
  return [
    { 
      name: 'Pace', 
      value: Math.min(percent, 150), // Cap display at 150%
      fill,
    },
  ];
}

interface CostSegment {
  name: string;
  value: number;
  color: string;
}

function prepareCostData(cost: FlightDeckResult['cost']): CostSegment[] {
  return [
    { 
      name: 'Lumiere Fee', 
      value: cost.breakdown.lumiere, 
      color: chartTheme.costs.lumiereFee,
    },
    { 
      name: 'Provider Costs', 
      value: cost.breakdown.provider, 
      color: chartTheme.costs.providerCost,
    },
    { 
      name: 'UMPI Tuition', 
      value: cost.breakdown.umpi, 
      color: chartTheme.costs.umpiCost,
    },
  ].filter(segment => segment.value > 0); // Only show non-zero segments
}

interface TimelineDataPoint {
  month: string;
  credits: number;
  cumulative: number;
}

function prepareTimelineData(
  credits: FlightDeckResult['credits'],
  eta: FlightDeckResult['eta']
): TimelineDataPoint[] {
  const { completed, inProgress, remaining } = credits;
  const { months } = eta;
  
  const currentTotal = completed + inProgress;
  const creditsPerMonth = remaining > 0 && months > 0 ? remaining / months : 0;
  
  const data: TimelineDataPoint[] = [];
  
  // Add current month (month 0)
  data.push({
    month: 'Now',
    credits: 0,
    cumulative: currentTotal,
  });
  
  // Determine how many months to display (cap at 12 for chart readability)
  const displayMonths = Math.min(months, 12);
  const targetTotal = currentTotal + remaining;
  
  // Project future months using precise floats
  for (let i = 1; i <= displayMonths; i++) {
    const cumulativeTotal = currentTotal + (creditsPerMonth * i);
    const monthCredits = creditsPerMonth;
    
    // Only force exact target if we're showing the actual final month
    // If ETA > 12 months, we show first 12 months with natural progression
    const isActualFinalMonth = (i === months && months <= 12);
    
    data.push({
      month: `M${i}`,
      credits: Math.round(monthCredits),
      cumulative: isActualFinalMonth 
        ? targetTotal  // Exact target for actual completion month
        : Math.round(cumulativeTotal * 10) / 10, // Precise float for intermediate months
    });
  }
  
  return data;
}

// ============================================================================
// CHART COMPONENTS (Memoized for performance)
// ============================================================================

export const CreditsDonutChart = memo(function CreditsDonutChart({ data }: { data: FlightDeckResult }) {
  const chartData = prepareCreditsData(data.credits);
  
  return (
    <div className="h-64 w-full" data-testid="chart-credits-donut">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={80}
            paddingAngle={2}
            dataKey="value"
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip 
            contentStyle={{ 
              backgroundColor: 'hsl(var(--popover))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '6px',
            }}
            labelStyle={{ color: 'hsl(var(--popover-foreground))' }}
          />
          <Legend 
            verticalAlign="bottom"
            height={36}
            formatter={(value) => (
              <span style={{ color: 'hsl(var(--foreground))' }}>{value}</span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
});

export const PaceGaugeChart = memo(function PaceGaugeChart({ data }: { data: FlightDeckResult }) {
  const chartData = preparePaceData(data.pace);
  const percent = Math.min(data.pace.percentOfTarget, 150);
  
  return (
    <div className="h-64 w-full" data-testid="chart-pace-gauge">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          cx="50%"
          cy="50%"
          innerRadius="70%"
          outerRadius="100%"
          barSize={20}
          data={chartData}
          startAngle={180}
          endAngle={0}
        >
          <PolarAngleAxis
            type="number"
            domain={[0, 150]}
            angleAxisId={0}
            tick={false}
          />
          <RadialBar
            background
            dataKey="value"
            cornerRadius={10}
            fill={chartData[0].fill}
          />
          <text
            x="50%"
            y="45%"
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-foreground text-3xl font-bold"
          >
            {Math.round(data.pace.percentOfTarget)}%
          </text>
          <text
            x="50%"
            y="60%"
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-muted-foreground text-sm"
          >
            {data.pace.currentHours} / {data.pace.targetHours} hrs/week
          </text>
        </RadialBarChart>
      </ResponsiveContainer>
    </div>
  );
});

export const TimelineProjectionChart = memo(function TimelineProjectionChart({ data }: { data: FlightDeckResult }) {
  const chartData = prepareTimelineData(data.credits, data.eta);
  
  return (
    <div className="h-64 w-full" data-testid="chart-timeline-projection">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id="colorCumulative" x1="0" y1="0" x2="0" y2="1">
              <stop 
                offset="5%" 
                stopColor={chartTheme.timeline.area} 
                stopOpacity={chartTheme.timeline.areaOpacity} 
              />
              <stop 
                offset="95%" 
                stopColor={chartTheme.timeline.area} 
                stopOpacity={0} 
              />
            </linearGradient>
          </defs>
          <CartesianGrid 
            strokeDasharray="3 3" 
            stroke="hsl(var(--border))" 
            opacity={0.3}
          />
          <XAxis 
            dataKey="month" 
            stroke="hsl(var(--muted-foreground))"
            tick={{ fill: 'hsl(var(--muted-foreground))' }}
          />
          <YAxis 
            stroke="hsl(var(--muted-foreground))"
            tick={{ fill: 'hsl(var(--muted-foreground))' }}
            domain={[0, 120]}
          />
          <Tooltip 
            contentStyle={{ 
              backgroundColor: 'hsl(var(--popover))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '6px',
            }}
            labelStyle={{ color: 'hsl(var(--popover-foreground))' }}
            itemStyle={{ color: 'hsl(var(--popover-foreground))' }}
          />
          <Area
            type="monotone"
            dataKey="cumulative"
            stroke={chartTheme.timeline.line}
            strokeWidth={2}
            fill="url(#colorCumulative)"
            name="Total Credits"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
});

export const CostBreakdownChart = memo(function CostBreakdownChart({ data }: { data: FlightDeckResult }) {
  const chartData = prepareCostData(data.cost);
  
  // Format currency for tooltip
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };
  
  // Create screen-reader summary (always defined for accessibility)
  const srSummary = chartData.length > 0
    ? `Cost breakdown: ${chartData.map(item => `${item.name} ${formatCurrency(item.value)}`).join(', ')}`
    : 'No cost data available yet';
  
  // Handle zero-data case with proper accessibility
  if (chartData.length === 0) {
    return (
      <div 
        className="h-64 w-full flex items-center justify-center" 
        data-testid="chart-cost-breakdown"
        role="img"
        aria-label={srSummary}
      >
        <span className="sr-only">{srSummary}</span>
        <p className="text-muted-foreground text-sm" aria-hidden="true">No cost data available</p>
      </div>
    );
  }
  
  return (
    <div className="h-64 w-full" data-testid="chart-cost-breakdown" role="img" aria-label={srSummary}>
      {/* Screen reader only summary */}
      <span className="sr-only">{srSummary}</span>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={80}
            paddingAngle={2}
            dataKey="value"
            label={(entry) => formatCurrency(entry.value)}
            labelLine={false}
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip 
            contentStyle={{ 
              backgroundColor: 'hsl(var(--popover))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '6px',
            }}
            labelStyle={{ color: 'hsl(var(--popover-foreground))' }}
            formatter={(value: number) => formatCurrency(value)}
          />
          <Legend 
            verticalAlign="bottom"
            height={36}
            formatter={(value) => (
              <span style={{ color: 'hsl(var(--foreground))' }}>{value}</span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
});

// ============================================================================
// LOADING SKELETONS
// ============================================================================

export function ChartSkeleton() {
  return (
    <div className="h-64 w-full space-y-3" data-testid="chart-skeleton">
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-8 w-3/4 mx-auto" />
    </div>
  );
}
