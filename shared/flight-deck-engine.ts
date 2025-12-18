/**
 * Flight Deck Calculation Engine
 * Single source of truth for all Flight Deck metrics
 * Implements deterministic math per spec v1.0
 */

import { z } from 'zod';

// ============================================================================
// CONSTANTS
// ============================================================================

export const TARGET_CREDITS = 120;
export const DEFAULT_TARGET_HOURS_PER_WEEK = 12;
export const DEFAULT_HOURS_PER_CREDIT = 15;
export const WEEKS_PER_MONTH = 4.3;
export const ONE_YEAR_MONTHS = 12;

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export const flightDeckInputSchema = z.object({
  // Student Profile
  studentProfile: z.object({
    name: z.string(),
    avatar_url: z.string().nullable().optional(),
    targetHours: z.number().default(DEFAULT_TARGET_HOURS_PER_WEEK),
    model: z.enum(['UMPI', 'Other']).default('UMPI'),
  }),

  // Progress Data
  progress: z.object({
    completedCredits: z.number().int().min(0),
    inProgressCredits: z.number().int().min(0),
    uniqueCodes: z.array(z.string()).optional(),
  }),

  // Pace Data
  pace: z.object({
    weeklyHoursAvg: z.number().min(0),
    hoursPerCredit: z.number().default(DEFAULT_HOURS_PER_CREDIT),
  }),

  // Financial Data (from existing financial-calculator.ts)
  financials: z.object({
    projected_total: z.number(),
    upfront_due: z.number(),
    monthly_payment: z.number(),
    payment_months: z.number(),
    over_15k: z.boolean(),
    overage_reasons: z.array(z.string()),
    // Breakdown will be synthesized by FlightDeckService from financial rules
    breakdown: z.object({
      lumiere_fee: z.number(),
      provider_cost: z.number(),
      umpi_cost: z.number(),
      sessions_count: z.number(),
      umpi_session_cost: z.number(), // Unit cost per session (from financial_rules)
    }),
    paymentLedger: z.array(z.object({
      date: z.string(),
      amount: z.number(),
    })).default([]),
  }),

  // Plan Hints
  planHints: z.object({
    remainingULCredits: z.number().int().min(0),
    baselineUmpiSessions: z.number().int().default(2),
  }),

  // Prior Snapshots for trend comparison
  priorSnapshots: z.object({
    lastWeekProjectedTotal: z.number().nullable().optional(),
  }).optional(),
});

export type FlightDeckInput = z.infer<typeof flightDeckInputSchema>;

// ============================================================================
// OUTPUT TYPES
// ============================================================================

export type AlertLevel = 'red' | 'yellow' | 'green';
export type CostState = 'On Track' | 'Caution' | 'Over Budget';

export interface CreditsResult {
  completed: number;
  inProgress: number;
  remaining: number;
  total: number;
  isOverTarget: boolean;
  overageAmount: number;
}

export interface PaceResult {
  currentHours: number;
  targetHours: number;
  state: AlertLevel;
  percentOfTarget: number;
}

export interface ETAResult {
  months: number;
  exceedsOneYear: boolean;
  effectiveMonthlyThroughput: number;
}

export interface CostResult {
  lumiereFee: number;
  providerCost: number;
  umpiCost: number;
  projectedUmpiSessions: number;
  projectedTotal: number;
  state: CostState;
  breakdown: {
    lumiere: number;
    provider: number;
    umpi: number;
  };
}

export interface TrendResult {
  deltaTotal: number;
  direction: 'up' | 'flat' | 'down';
  percentChange: number;
}

export interface PaymentResult {
  paidToDate: number;
  remainingBalance: number;
  ledger: Array<{ date: string; amount: number }>;
}

export interface AlertResult {
  level: AlertLevel;
  messages: string[];
  oneYearWarning: string | null;
}

export type InsightSeverity = 'info' | 'warning' | 'success';
export type InsightPriority = 1 | 2 | 3; // 1=High, 2=Medium, 3=Low

export interface InsightItem {
  message: string;
  severity: InsightSeverity;
  priority: InsightPriority;
  icon?: 'alert' | 'check' | 'trend-up' | 'dollar' | 'clock' | 'lightbulb';
}

export interface FlightDeckResult {
  credits: CreditsResult;
  pace: PaceResult;
  eta: ETAResult;
  cost: CostResult;
  trend: TrendResult;
  payments: PaymentResult;
  alerts: AlertResult;
  insights: {
    summary: string;
    smartTip: string | null;
    budget: {
      warnings: InsightItem[];
    };
    milestones: {
      celebrations: InsightItem[];
    };
    recommendations: {
      pace: InsightItem[];
      credits: InsightItem[];
      budget: InsightItem[];
    };
  };
}

// ============================================================================
// CALCULATION FUNCTIONS
// ============================================================================

/**
 * Calculate credit metrics
 */
export function calculateCredits(progress: FlightDeckInput['progress']): CreditsResult {
  const { completedCredits, inProgressCredits } = progress;
  
  const total = completedCredits + inProgressCredits;
  const remaining = Math.max(0, TARGET_CREDITS - total);
  const isOverTarget = total > TARGET_CREDITS;
  const overageAmount = isOverTarget ? total - TARGET_CREDITS : 0;

  return {
    completed: completedCredits,
    inProgress: inProgressCredits,
    remaining,
    total: TARGET_CREDITS,
    isOverTarget,
    overageAmount,
  };
}

/**
 * Calculate pace state
 */
export function calculatePace(
  pace: FlightDeckInput['pace'],
  targetHours: number
): PaceResult {
  const { weeklyHoursAvg } = pace;
  const percentOfTarget = targetHours > 0 ? (weeklyHoursAvg / targetHours) * 100 : 0;

  let state: AlertLevel;
  if (weeklyHoursAvg >= targetHours) {
    state = 'green';
  } else if (weeklyHoursAvg >= targetHours * 0.8) {
    state = 'yellow';
  } else {
    state = 'red';
  }

  return {
    currentHours: weeklyHoursAvg,
    targetHours,
    state,
    percentOfTarget,
  };
}

/**
 * Calculate ETA (months to completion)
 * Deterministic formula per spec
 */
export function calculateETA(
  remainingCredits: number,
  pace: FlightDeckInput['pace']
): ETAResult {
  const { weeklyHoursAvg, hoursPerCredit } = pace;

  if (remainingCredits === 0) {
    return {
      months: 0,
      exceedsOneYear: false,
      effectiveMonthlyThroughput: 0,
    };
  }

  if (weeklyHoursAvg === 0) {
    return {
      months: 999, // Effectively infinite
      exceedsOneYear: true,
      effectiveMonthlyThroughput: 0,
    };
  }

  // Credits per week = weeklyHours / hoursPerCredit
  const creditsPerWeek = weeklyHoursAvg / hoursPerCredit;
  
  // Credits per month = creditsPerWeek * WEEKS_PER_MONTH
  const effectiveMonthlyThroughput = creditsPerWeek * WEEKS_PER_MONTH;

  // Months needed = remainingCredits / effectiveMonthlyThroughput
  const monthsRaw = remainingCredits / effectiveMonthlyThroughput;
  const months = Math.ceil(monthsRaw);

  return {
    months,
    exceedsOneYear: months > ONE_YEAR_MONTHS,
    effectiveMonthlyThroughput,
  };
}

/**
 * Calculate cost presentation state
 * Uses outputs from existing financial-calculator.ts
 * Only adds presentation logic, no cost recalculation
 */
export function calculateCost(
  financials: FlightDeckInput['financials'],
  planHints: FlightDeckInput['planHints']
): CostResult {
  const { projected_total, upfront_due, breakdown, over_15k } = financials;
  const { baselineUmpiSessions } = planHints;

  // Determine cost state based on baseline comparison
  let state: CostState;
  
  if (over_15k) {
    state = 'Over Budget';
  } else if (breakdown.sessions_count > baselineUmpiSessions) {
    state = 'Caution';
  } else {
    state = 'On Track';
  }

  return {
    lumiereFee: breakdown.lumiere_fee,
    providerCost: breakdown.provider_cost,
    umpiCost: breakdown.umpi_cost,
    projectedUmpiSessions: breakdown.sessions_count,
    projectedTotal: projected_total,
    state,
    breakdown: {
      lumiere: breakdown.lumiere_fee,
      provider: breakdown.provider_cost,
      umpi: breakdown.umpi_cost,
    },
  };
}

/**
 * Calculate trend vs prior snapshot
 */
export function calculateTrend(
  currentTotal: number,
  priorTotal: number | null | undefined
): TrendResult {
  if (priorTotal == null) {
    return {
      deltaTotal: 0,
      direction: 'flat',
      percentChange: 0,
    };
  }

  const deltaTotal = currentTotal - priorTotal;
  const percentChange = priorTotal > 0 ? (deltaTotal / priorTotal) * 100 : 0;

  let direction: 'up' | 'flat' | 'down';
  if (Math.abs(deltaTotal) < 1) {
    direction = 'flat';
  } else if (deltaTotal > 0) {
    direction = 'up';
  } else {
    direction = 'down';
  }

  return {
    deltaTotal,
    direction,
    percentChange,
  };
}

/**
 * Calculate payment summary
 */
export function calculatePayments(
  financials: FlightDeckInput['financials'],
  projectedTotal: number
): PaymentResult {
  const { paymentLedger } = financials;

  const paidToDate = paymentLedger.reduce((sum, payment) => sum + payment.amount, 0);
  const remainingBalance = Math.max(0, projectedTotal - paidToDate);

  return {
    paidToDate,
    remainingBalance,
    ledger: paymentLedger,
  };
}

/**
 * Calculate alerts
 */
export function calculateAlerts(
  pace: PaceResult,
  eta: ETAResult,
  cost: CostResult,
  umpiSessionCost: number // Pass from financial rules to avoid division by zero
): AlertResult {
  const messages: string[] = [];
  let level: AlertLevel = 'green';
  let oneYearWarning: string | null = null;

  // Check one-year rule
  if (eta.exceedsOneYear) {
    level = 'red';
    messages.push(`Timeline exceeds 12 months (${eta.months} months)`);
    oneYearWarning = `Exceeds 12 months - additional UMPI session (~$${Math.round(umpiSessionCost)}) likely.`;
  }

  // Check pace
  if (pace.state === 'red') {
    if (level !== 'red') level = 'red';
    messages.push('Study pace significantly below target');
  } else if (pace.state === 'yellow') {
    if (level === 'green') level = 'yellow';
    messages.push('Study pace slightly below target');
  }

  // Check cost
  if (cost.state === 'Over Budget') {
    if (level !== 'red') level = 'red';
    messages.push('Projected cost over budget');
  } else if (cost.state === 'Caution') {
    if (level === 'green') level = 'yellow';
    messages.push('Projected cost trending higher');
  }

  if (messages.length === 0) {
    messages.push('On track for timely completion');
  }

  return {
    level,
    messages,
    oneYearWarning,
  };
}

/**
 * Generate budget warnings based on cost state and trends
 */
function generateBudgetWarnings(
  cost: CostResult,
  trend: TrendResult,
  umpiSessionCost: number
): InsightItem[] {
  const warnings: InsightItem[] = [];

  // Over budget warning (High priority)
  if (cost.state === 'Over Budget') {
    const overage = cost.projectedTotal - 15000;
    warnings.push({
      message: `Budget exceeded by $${overage.toLocaleString()}. Consider accelerating pace to reduce UMPI sessions.`,
      severity: 'warning',
      priority: 1,
      icon: 'dollar',
    });
  }

  // Approaching budget limit (Medium priority)
  if (cost.projectedTotal > 14000 && cost.projectedTotal <= 15000) {
    const remaining = 15000 - cost.projectedTotal;
    warnings.push({
      message: `Within $${remaining.toLocaleString()} of budget limit. Monitor closely.`,
      severity: 'warning',
      priority: 2,
      icon: 'alert',
    });
  }

  // Trending up warning (Medium priority)
  if (trend.direction === 'up' && trend.percentChange > 5) {
    warnings.push({
      message: `Costs increased ${trend.percentChange.toFixed(1)}% from last week. Review pace and session planning.`,
      severity: 'warning',
      priority: 2,
      icon: 'trend-up',
    });
  }

  // Additional session warning (High priority)
  if (cost.projectedUmpiSessions > 2) {
    const extraSessions = cost.projectedUmpiSessions - 2;
    warnings.push({
      message: `Projected ${extraSessions} extra UMPI session${extraSessions > 1 ? 's' : ''} (~$${Math.round(extraSessions * umpiSessionCost)}). Increase pace to avoid.`,
      severity: 'warning',
      priority: 1,
      icon: 'clock',
    });
  }

  // Sort by priority and limit to top 3
  return warnings.sort((a, b) => a.priority - b.priority).slice(0, 3);
}

/**
 * Generate milestone celebrations based on progress
 */
function generateMilestoneCelebrations(
  credits: CreditsResult,
  pace: PaceResult,
  cost: CostResult,
  eta: ETAResult
): InsightItem[] {
  const celebrations: InsightItem[] = [];
  const progressPercent = ((credits.completed + credits.inProgress) / credits.total) * 100;

  // Progress milestones (High priority)
  if (progressPercent >= 90) {
    celebrations.push({
      message: `90% complete! You're in the home stretch with just ${credits.remaining} credits to go!`,
      severity: 'success',
      priority: 1,
      icon: 'check',
    });
  } else if (progressPercent >= 75) {
    celebrations.push({
      message: `75% complete! Three-quarters of the way to your degree!`,
      severity: 'success',
      priority: 1,
      icon: 'check',
    });
  } else if (progressPercent >= 50) {
    celebrations.push({
      message: `Halfway there! ${credits.completed + credits.inProgress} credits down, ${credits.remaining} to go!`,
      severity: 'success',
      priority: 1,
      icon: 'check',
    });
  } else if (progressPercent >= 25) {
    celebrations.push({
      message: `25% complete! Great start on your degree journey!`,
      severity: 'success',
      priority: 2,
      icon: 'check',
    });
  }

  // On-track pace (Medium priority)
  if (pace.percentOfTarget >= 100) {
    celebrations.push({
      message: `Excellent pace! You're studying ${pace.currentHours} hrs/week (${Math.round(pace.percentOfTarget)}% of target).`,
      severity: 'success',
      priority: 2,
      icon: 'check',
    });
  }

  // Under budget (Medium priority)
  if (cost.projectedTotal < 13000) {
    celebrations.push({
      message: `Under budget! Projected total of $${cost.projectedTotal.toLocaleString()} is excellent.`,
      severity: 'success',
      priority: 2,
      icon: 'dollar',
    });
  }

  // Fast completion (Medium priority)
  if (eta.months < 8 && !eta.exceedsOneYear) {
    celebrations.push({
      message: `Fast track! On pace to finish in just ${eta.months} months.`,
      severity: 'success',
      priority: 2,
      icon: 'clock',
    });
  }

  // Sort by priority and limit to top 3
  return celebrations.sort((a, b) => a.priority - b.priority).slice(0, 3);
}

/**
 * Generate actionable recommendations
 */
function generateRecommendations(
  credits: CreditsResult,
  pace: PaceResult,
  eta: ETAResult,
  cost: CostResult,
  umpiSessionCost: number
): FlightDeckResult['insights']['recommendations'] {
  const paceRecs: InsightItem[] = [];
  const creditsRecs: InsightItem[] = [];
  const budgetRecs: InsightItem[] = [];

  // Pace recommendations
  if (eta.exceedsOneYear && pace.currentHours < pace.targetHours) {
    const hoursNeeded = Math.ceil(pace.targetHours - pace.currentHours);
    paceRecs.push({
      message: `Add ${hoursNeeded} hrs/week to finish within 12 months and avoid extra session (~$${Math.round(umpiSessionCost)}).`,
      severity: 'warning',
      priority: 1,
      icon: 'clock',
    });
  } else if (pace.state === 'yellow') {
    const hoursNeeded = Math.ceil(pace.targetHours - pace.currentHours);
    paceRecs.push({
      message: `Increase study time by ${hoursNeeded} hrs/week to meet your target pace.`,
      severity: 'info',
      priority: 2,
      icon: 'clock',
    });
  } else if (pace.state === 'green') {
    paceRecs.push({
      message: `Maintain your current ${pace.currentHours} hrs/week pace to stay on track.`,
      severity: 'success',
      priority: 3,
      icon: 'check',
    });
  }

  // Credits recommendations
  if (credits.remaining > 0) {
    const monthsRemaining = eta.months;
    const creditsPerMonth = credits.remaining / monthsRemaining;
    creditsRecs.push({
      message: `Complete ~${Math.ceil(creditsPerMonth)} credits per month to finish in ${monthsRemaining} months.`,
      severity: 'info',
      priority: 1,
      icon: 'lightbulb',
    });
  }

  if (credits.inProgress > 0) {
    creditsRecs.push({
      message: `Focus on completing your ${credits.inProgress} in-progress courses first.`,
      severity: 'info',
      priority: 1,
      icon: 'lightbulb',
    });
  }

  // Budget recommendations
  if (cost.state === 'Over Budget') {
    const potentialSavings = Math.round(umpiSessionCost);
    budgetRecs.push({
      message: `Finishing one month faster could save ~$${potentialSavings}. Consider increasing study hours.`,
      severity: 'info',
      priority: 1,
      icon: 'dollar',
    });
  }

  if (cost.projectedUmpiSessions > 2) {
    budgetRecs.push({
      message: `Projected ${cost.projectedUmpiSessions} UMPI sessions. Aim for 2 sessions to optimize costs.`,
      severity: 'info',
      priority: 1,
      icon: 'dollar',
    });
  }

  // Sort each category by priority and limit to top 2
  return {
    pace: paceRecs.sort((a, b) => a.priority - b.priority).slice(0, 2),
    credits: creditsRecs.sort((a, b) => a.priority - b.priority).slice(0, 2),
    budget: budgetRecs.sort((a, b) => a.priority - b.priority).slice(0, 2),
  };
}

/**
 * Generate comprehensive insights with categorized recommendations
 */
export function generateInsights(
  credits: CreditsResult,
  eta: ETAResult,
  cost: CostResult,
  pace: PaceResult,
  trend: TrendResult,
  umpiSessionCost: number
): FlightDeckResult['insights'] {
  const summary = `At this pace, you'll finish in ${eta.months} months and pay $${cost.projectedTotal.toLocaleString()}.`;

  let smartTip: string | null = null;

  if (eta.exceedsOneYear && pace.currentHours < pace.targetHours) {
    const hoursNeeded = Math.ceil(pace.targetHours - pace.currentHours);
    smartTip = `Add ${hoursNeeded} hrs/week to avoid one extra UMPI session (~$${Math.round(umpiSessionCost)}).`;
  } else if (pace.state === 'yellow') {
    const hoursNeeded = Math.ceil(pace.targetHours - pace.currentHours);
    smartTip = `Increase pace by ${hoursNeeded} hrs/week to stay on track.`;
  }

  return {
    summary,
    smartTip,
    budget: {
      warnings: generateBudgetWarnings(cost, trend, umpiSessionCost),
    },
    milestones: {
      celebrations: generateMilestoneCelebrations(credits, pace, cost, eta),
    },
    recommendations: generateRecommendations(credits, pace, eta, cost, umpiSessionCost),
  };
}

// ============================================================================
// MAIN CALCULATION ENGINE
// ============================================================================

/**
 * Main calculation engine - single entry point
 * All Flight Deck metrics flow through here
 */
export function calculateFlightDeck(input: FlightDeckInput): FlightDeckResult {
  // Validate input
  const validated = flightDeckInputSchema.parse(input);

  // 1. Calculate credits
  const credits = calculateCredits(validated.progress);

  // 2. Calculate pace
  const pace = calculatePace(validated.pace, validated.studentProfile.targetHours);

  // 3. Calculate ETA
  const eta = calculateETA(credits.remaining, validated.pace);

  // 4. Calculate cost presentation (using financial-calculator outputs)
  const cost = calculateCost(validated.financials, validated.planHints);

  // 5. Calculate trend
  const trend = calculateTrend(
    cost.projectedTotal,
    validated.priorSnapshots?.lastWeekProjectedTotal
  );

  // 6. Calculate payments
  const payments = calculatePayments(validated.financials, cost.projectedTotal);

  // 7. Calculate alerts (pass umpi_session_cost to avoid division by zero)
  const umpiSessionCost = validated.financials.breakdown.umpi_session_cost;
  const alerts = calculateAlerts(pace, eta, cost, umpiSessionCost);

  // 8. Generate insights with rich categorized recommendations
  const insights = generateInsights(credits, eta, cost, pace, trend, umpiSessionCost);

  return {
    credits,
    pace,
    eta,
    cost,
    trend,
    payments,
    alerts,
    insights,
  };
}
