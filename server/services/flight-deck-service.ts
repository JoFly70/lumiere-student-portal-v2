/**
 * Flight Deck Service
 * Orchestrates data gathering for Flight Deck dashboard
 * Integrates with real metrics, enrollments, and financial tracking
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { calculateFinancials, type FinancialInputs } from '../financial-calculator';
import {
  calculateFlightDeck,
  type FlightDeckInput,
  type FlightDeckResult,
} from '@shared/flight-deck-engine';
import { db } from '../lib/db';
import { enrollments, metrics, plans, users, pricingRules, providers, type Enrollment, type PricingRule, type Provider } from '@shared/schema';
import { eq, and, inArray, isNull } from 'drizzle-orm';

const isDemoMode = process.env.ALLOW_DEMO_MODE === 'true';

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validates and sanitizes numeric values to prevent edge cases
 */
function validateNumber(value: number, min: number = 0, max: number = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || isNaN(value) || !isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

/**
 * Validates and sanitizes credits data
 */
function validateCredits(credits: { completed: number; inProgress: number }) {
  return {
    completed: validateNumber(credits.completed, 0, 120),
    inProgress: validateNumber(credits.inProgress, 0, 120),
  };
}

/**
 * Validates and sanitizes pace data
 */
function validatePace(pace: { weeklyHours: number; hoursPerCredit: number }) {
  return {
    weeklyHours: validateNumber(pace.weeklyHours, 0, 168), // Max 168 hours/week
    hoursPerCredit: validateNumber(pace.hoursPerCredit, 1, 100), // Reasonable range
  };
}

/**
 * Get Flight Deck data for a student
 * 
 * Data Flow:
 * 1. Fetch student profile (name, avatar, target hours)
 * 2. Fetch progress data (completed/in-progress credits)
 * 3. Calculate pace from study tracking
 * 4. Call financial-calculator for cost projections
 * 5. Synthesize breakdown from financial rules
 * 6. Normalize into FlightDeckInput
 * 7. Call calculateFlightDeck engine
 */
export async function getFlightDeckData(userId: string): Promise<FlightDeckResult> {
  try {
    logger.info('Fetching Flight Deck data', { userId });

    // Step 1: Get student profile
    const student = await getStudentProfile(userId);

    // Step 2: Get progress data (real enrollments in production)
    const rawProgress = await getProgressData(userId);

    // Step 3: Get pace data (real metrics or defaults)
    const rawPace = await getPaceData(userId);

    // Validate and sanitize data to prevent edge cases
    const progress = validateCredits({
      completed: rawProgress.completed,
      inProgress: rawProgress.inProgress,
    });
    const pace = validatePace(rawPace);

    // Step 4: Get financial projections
    const financials = await getFinancialProjections(userId, {
      ...rawProgress,
      completed: progress.completed,
      inProgress: progress.inProgress,
    });

    // Step 5: Get plan hints (UL credits, baseline sessions)
    const planHints = await getPlanHints(userId, {
      ...rawProgress,
      completed: progress.completed,
      inProgress: progress.inProgress,
    });

    // Step 6: Get prior snapshots for trend
    const priorSnapshots = await getPriorSnapshots(userId);

    // Step 7: Normalize into FlightDeckInput
    const input: FlightDeckInput = {
      studentProfile: {
        name: student.name,
        avatar_url: student.avatar_url || null,
        targetHours: validateNumber(student.targetHours, 0, 168),
        model: 'UMPI',
      },
      progress: {
        completedCredits: progress.completed,
        inProgressCredits: progress.inProgress,
        uniqueCodes: rawProgress.codes.slice(0, 20), // Limit to prevent overflow
      },
      pace: {
        weeklyHoursAvg: pace.weeklyHours,
        hoursPerCredit: pace.hoursPerCredit,
      },
      financials: {
        projected_total: financials.projected_total,
        upfront_due: financials.upfront_due,
        monthly_payment: financials.monthly_payment,
        payment_months: financials.payment_months,
        over_15k: financials.over_15k,
        overage_reasons: financials.overage_reasons,
        breakdown: financials.breakdown,
        paymentLedger: financials.ledger,
      },
      planHints: {
        remainingULCredits: planHints.remainingUL,
        baselineUmpiSessions: planHints.baselineSessions,
      },
      priorSnapshots: {
        lastWeekProjectedTotal: priorSnapshots?.lastWeekTotal || null,
      },
    };

    // Step 8: Calculate Flight Deck metrics
    const result = calculateFlightDeck(input);

    logger.info('Flight Deck data calculated successfully', { userId });
    return result;

  } catch (error) {
    logger.error('Error getting Flight Deck data', { userId, error });
    throw error;
  }
}

// ============================================================================
// DATA GATHERING HELPERS
// ============================================================================

interface StudentProfile {
  id: string;
  name: string;
  avatar_url: string | null;
  targetHours: number;
}

async function getStudentProfile(userId: string): Promise<StudentProfile> {
  // Query local database for student profile
  const studentData = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (studentData.length === 0) {
    throw new Error(`User not found: ${userId}`);
  }

  return {
    id: studentData[0].id,
    name: studentData[0].name,
    avatar_url: null, // TODO: Add avatar support
    targetHours: 12, // TODO: Add to users table
  };
}

interface ProgressData {
  completed: number;
  inProgress: number;
  codes: string[];
}

async function getProgressData(userId: string): Promise<ProgressData> {
  try {
    // Fetch enrollments from database
    const completedEnrollments = await db
      .select()
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, userId),
          eq(enrollments.status, 'completed')
        )
      );

    const inProgressEnrollments = await db
      .select()
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, userId),
          eq(enrollments.status, 'in_progress')
        )
      );

    // Calculate total credits
    const completedCredits = completedEnrollments.reduce((sum: number, e: Enrollment) => sum + e.credits, 0);
    const inProgressCredits = inProgressEnrollments.reduce((sum: number, e: Enrollment) => sum + e.credits, 0);

    // Collect unique course codes
    const codes = [
      ...completedEnrollments.map((e: Enrollment) => e.title),
      ...inProgressEnrollments.map((e: Enrollment) => e.title),
    ].slice(0, 10); // Limit to 10 for display

    return {
      completed: completedCredits,
      inProgress: inProgressCredits,
      codes,
    };
  } catch (error) {
    logger.error('Error fetching progress data, using defaults', { userId, error });
    // Fallback to zeros if no data
    return {
      completed: 0,
      inProgress: 0,
      codes: [],
    };
  }
}

interface PaceData {
  weeklyHours: number;
  hoursPerCredit: number;
}

/**
 * Calculate weighted average of weekly study hours from recent metrics
 * Recent weeks are weighted more heavily (linear decay)
 */
async function getPaceData(userId: string): Promise<PaceData> {
  try {
    const { getRecentWeeklyMetrics } = await import('./weekly-metrics-service.js');
    
    // Fetch last 6 weeks of metrics
    const recentMetrics = await getRecentWeeklyMetrics(userId, 6);
    
    if (recentMetrics.length === 0) {
      // No logged hours, use default
      logger.info('No weekly metrics found, using default pace', { userId });
      return {
        weeklyHours: 10, // Default 10 hours/week
        hoursPerCredit: 15, // Standard industry estimate
      };
    }

    // Calculate weighted average (recent weeks count more)
    // Week 1 (most recent) = weight 6, Week 2 = weight 5, ..., Week 6 = weight 1
    let totalWeightedHours = 0;
    let totalWeight = 0;
    
    recentMetrics.forEach((metric, index) => {
      const weight = recentMetrics.length - index; // Linear decay
      totalWeightedHours += metric.hoursStudied * weight;
      totalWeight += weight;
    });

    const weeklyHours = totalWeight > 0 ? totalWeightedHours / totalWeight : 10;

    // Try to calculate hours per credit from completed courses
    const completedEnrollments = await db
      .select()
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, userId),
          eq(enrollments.status, 'completed')
        )
      );

    let hoursPerCredit = 15; // Default industry estimate

    if (completedEnrollments.length >= 3 && weeklyHours > 0) {
      // If we have enough completed courses and logged hours, derive estimate
      const totalCompletedCredits = completedEnrollments.reduce((sum, e) => sum + e.credits, 0);
      const totalLoggedHours = recentMetrics.reduce((sum, m) => sum + m.hoursStudied, 0);
      
      if (totalCompletedCredits > 0 && totalLoggedHours > 0) {
        const derivedHoursPerCredit = totalLoggedHours / totalCompletedCredits;
        // Only use derived value if it's reasonable (5-40 hours per credit)
        if (derivedHoursPerCredit >= 5 && derivedHoursPerCredit <= 40) {
          hoursPerCredit = derivedHoursPerCredit;
        }
      }
    }

    logger.info('Pace data calculated from metrics', { 
      userId, 
      weeklyHours: Math.round(weeklyHours * 10) / 10,
      hoursPerCredit: Math.round(hoursPerCredit * 10) / 10,
      metricsCount: recentMetrics.length 
    });

    return {
      weeklyHours: Math.max(1, Math.min(168, weeklyHours)), // Clamp to 1-168
      hoursPerCredit: Math.max(5, Math.min(40, hoursPerCredit)), // Clamp to 5-40
    };
  } catch (error) {
    logger.error('Error fetching pace data, using defaults', { userId, error });
    return {
      weeklyHours: 10,
      hoursPerCredit: 15,
    };
  }
}

interface FinancialProjections {
  projected_total: number;
  upfront_due: number;
  monthly_payment: number;
  payment_months: number;
  over_15k: boolean;
  overage_reasons: string[];
  breakdown: {
    lumiere_fee: number;
    provider_cost: number;
    umpi_cost: number;
    sessions_count: number;
    umpi_session_cost: number;
  };
  ledger: Array<{ date: string; amount: number }>;
}

/**
 * Calculate financial projections using pricing_rules table
 * Maps enrollments to pricing by provider and estimates total cost
 */
async function getFinancialProjections(
  userId: string,
  progress: ProgressData
): Promise<FinancialProjections> {
  try {
    // Step 1: Get all active pricing rules (endsOn IS NULL)
    const allPricingRules = await db
      .select()
      .from(pricingRules)
      .where(isNull(pricingRules.endsOn)); // Active rules only

    if (allPricingRules.length === 0) {
      logger.warn('No pricing rules found, using defaults', { userId });
      return getDefaultFinancials(progress);
    }

    // Step 2: Get user's enrollments with provider info
    const userEnrollments = await db
      .select({
        enrollment: enrollments,
        provider: providers,
      })
      .from(enrollments)
      .leftJoin(providers, eq(enrollments.providerId, providers.id))
      .where(eq(enrollments.userId, userId));

    // Step 3: Build provider key to pricing name mapping
    // This allows flexible matching between providers.key and pricing_rules.provider
    const providerKeyToName: Record<string, string> = {};
    allPricingRules.forEach(rule => {
      // Match provider names to common provider keys
      const lowerProvider = rule.provider.toLowerCase().replace(/[.\s]/g, '-');
      providerKeyToName[lowerProvider] = rule.provider;
    });

    // Count enrollments by pricing provider name
    const providerEnrollments: Record<string, typeof userEnrollments> = {};
    
    userEnrollments.forEach((item) => {
      if (item.provider?.key) {
        // Map provider.key to pricing_rules.provider name
        const providerName = providerKeyToName[item.provider.key] || item.provider.name;
        
        if (!providerEnrollments[providerName]) {
          providerEnrollments[providerName] = [];
        }
        providerEnrollments[providerName].push(item);
      }
    });

    // Calculate costs by provider and model
    let providerCost = 0;
    const providerBreakdown: Record<string, number> = {};

    Object.entries(providerEnrollments).forEach(([providerName, items]) => {
      const count = items.length;
      const totalCredits = items.reduce((sum, item) => sum + (item.enrollment.credits || 0), 0);
      
      // Find pricing rule for this provider
      const rule = allPricingRules.find(r => r.provider === providerName);
      
      if (!rule) {
        logger.warn('No pricing rule found for provider', { providerName, count });
        return;
      }

      let cost = 0;

      // Calculate based on pricing model
      switch (rule.model) {
        case 'subscription': {
          if (rule.monthlyPrice && rule.coursesPerMonth) {
            // Estimate months needed based on courses per month
            const monthsNeeded = Math.ceil(count / rule.coursesPerMonth);
            cost = (rule.monthlyPrice / 100) * monthsNeeded;
          }
          break;
        }
        
        case 'per_session': {
          // Per-session pricing (e.g., UMPI $1400/session)
          if (rule.perSessionPrice) {
            const creditsPerSession = 30; // Typical full-time load
            const sessionsNeeded = Math.max(1, Math.ceil(totalCredits / creditsPerSession));
            cost = (rule.perSessionPrice / 100) * sessionsNeeded;
          }
          break;
        }
        
        case 'per_course': {
          // Per-course pricing (e.g., Straighterline $59/course)
          // Typically includes a subscription base fee
          if (rule.perSessionPrice) {
            // perSessionPrice field used for per-course cost
            cost = (rule.perSessionPrice / 100) * count;
          }
          // Add monthly base fee if applicable
          if (rule.monthlyPrice) {
            const monthsNeeded = rule.coursesPerMonth ? Math.ceil(count / rule.coursesPerMonth) : 1;
            cost += (rule.monthlyPrice / 100) * monthsNeeded;
          }
          break;
        }
        
        case 'per_credit': {
          // Per-credit pricing (charged per credit hour)
          const perCreditRate = rule.perCreditPrice || rule.perSessionPrice; // Fallback to perSessionPrice for backward compat
          if (perCreditRate) {
            cost = (perCreditRate / 100) * totalCredits;
          }
          // Add base subscription fee if applicable
          if (rule.monthlyPrice) {
            const monthsNeeded = rule.coursesPerMonth ? Math.ceil(count / rule.coursesPerMonth) : 1;
            cost += (rule.monthlyPrice / 100) * monthsNeeded;
          }
          break;
        }
        
        case 'hybrid': {
          // Hybrid model - combination of subscription + per-course/per-credit + fee
          let totalCost = 0;
          
          // Monthly subscription component
          if (rule.monthlyPrice && rule.coursesPerMonth) {
            const monthsNeeded = Math.ceil(count / rule.coursesPerMonth);
            totalCost += (rule.monthlyPrice / 100) * monthsNeeded;
          }
          
          // Per-credit component (highest priority)
          if (rule.perCreditPrice && totalCredits > 0) {
            totalCost += (rule.perCreditPrice / 100) * totalCredits;
          }
          // Per-course component (if no per-credit pricing)
          else if (rule.perSessionPrice && count > 0) {
            totalCost += (rule.perSessionPrice / 100) * count;
          }
          
          // One-time fee component
          if (rule.fee) {
            totalCost += rule.fee / 100;
          }
          
          cost = totalCost;
          break;
        }
        
        default: {
          logger.warn('Unknown pricing model', { 
            providerName, 
            model: rule.model,
            ruleId: rule.id 
          });
          break;
        }
      }

      if (cost > 0) {
        providerCost += cost;
        providerBreakdown[providerName] = Math.round(cost);
        logger.info('Provider cost calculated', { 
          providerName, 
          model: rule.model,
          count, 
          totalCredits,
          cost: Math.round(cost) 
        });
      }
    });

    // Validation: Warn if enrollments exist but no provider costs calculated
    if (userEnrollments.length > 0 && providerCost === 0) {
      logger.warn('Provider cost is zero despite enrollments existing', {
        userId,
        enrollmentCount: userEnrollments.length,
        providerNames: Object.keys(providerEnrollments),
        availableRules: allPricingRules.map(r => ({ provider: r.provider, model: r.model }))
      });
    }

    // Step 4: Calculate UMPI session costs
    const remainingCredits = Math.max(0, 120 - progress.completed - progress.inProgress);
    const creditsPerSession = 30; // Typical full-time load
    const estimatedSessions = Math.max(1, Math.ceil(remainingCredits / creditsPerSession));

    const umpiRule = allPricingRules.find(r => r.provider === 'UMPI' && r.school === 'UMPI');
    const umpiSessionCost = umpiRule?.perSessionPrice ? umpiRule.perSessionPrice / 100 : 1400;
    const umpiTotalCost = estimatedSessions * umpiSessionCost;

    // Step 5: Add Lumiere fee (if exists)
    const lumiereRule = allPricingRules.find(r => r.provider === 'Lumiere');
    const lumiereFee = lumiereRule?.fee ? lumiereRule.fee / 100 : 7000;

    // Step 6: Calculate totals
    const projectedTotal = Math.round(lumiereFee + providerCost + umpiTotalCost);
    const upfrontDue = lumiereFee;
    const remainingAfterUpfront = projectedTotal - upfrontDue;
    
    // Estimate payment months based on pace
    const estimatedMonths = Math.max(1, Math.ceil(remainingCredits / 8)); // ~8 credits/month
    const monthlyPayment = remainingAfterUpfront > 0 ? Math.round(remainingAfterUpfront / estimatedMonths) : 0;

    const breakdown = {
      lumiere_fee: lumiereFee,
      provider_cost: Math.round(providerCost),
      umpi_cost: Math.round(umpiTotalCost),
      sessions_count: estimatedSessions,
      umpi_session_cost: Math.round(umpiSessionCost),
    };

    // Generate simple payment ledger
    const ledger: Array<{ date: string; amount: number }> = [];
    const startDate = new Date();
    
    // Upfront payment
    ledger.push({
      date: startDate.toISOString().split('T')[0],
      amount: upfrontDue,
    });

    // Monthly payments
    for (let i = 1; i <= estimatedMonths && monthlyPayment > 0; i++) {
      const paymentDate = new Date(startDate);
      paymentDate.setMonth(startDate.getMonth() + i);
      ledger.push({
        date: paymentDate.toISOString().split('T')[0],
        amount: monthlyPayment,
      });
    }

    const result = {
      projected_total: projectedTotal,
      upfront_due: upfrontDue,
      monthly_payment: monthlyPayment,
      payment_months: estimatedMonths,
      over_15k: projectedTotal > 15000,
      overage_reasons: projectedTotal > 15000 ? ['Extended program duration'] : [],
      breakdown,
      ledger,
    };

    logger.info('Financial projections calculated from pricing_rules', { 
      userId,
      projectedTotal,
      estimatedSessions,
      providerCount: Object.keys(providerEnrollments).length,
      providerCost: Math.round(providerCost),
      providerBreakdown
    });

    return result;
  } catch (error) {
    logger.error('Error calculating financial projections', { userId, error });
    return getDefaultFinancials(progress);
  }
}

/**
 * Fallback financial projections when pricing rules unavailable
 */
function getDefaultFinancials(progress: ProgressData): FinancialProjections {
  const remainingCredits = Math.max(0, 120 - progress.completed - progress.inProgress);
  const estimatedMonths = Math.max(1, Math.ceil(remainingCredits / 8));

  return {
    projected_total: 13000,
    upfront_due: 7000,
    monthly_payment: Math.round((13000 - 7000) / estimatedMonths),
    payment_months: estimatedMonths,
    over_15k: false,
    overage_reasons: [],
    breakdown: {
      lumiere_fee: 7000,
      provider_cost: 2400,
      umpi_cost: 3600,
      sessions_count: 2,
      umpi_session_cost: 1800,
    },
    ledger: [],
  };
}

interface PlanHints {
  remainingUL: number;
  baselineSessions: number;
}

async function getPlanHints(userId: string, progress: ProgressData): Promise<PlanHints> {
  let baselineSessions = 2;
  let remainingUL = 10; // Default

  if (isDemoMode) {
    // Demo mode: Use mock data
    return {
      remainingUL: 10,
      baselineSessions: 2,
    };
  }

  try {
    // Fetch financial rules for baseline sessions
    const { data: rules } = await supabaseAdmin
      .from('financial_rules')
      .select('baseline_sessions')
      .single();
    
    baselineSessions = rules?.baseline_sessions || 2;

    // Fetch metrics to calculate remaining UL credits
    const userMetrics = await db
      .select()
      .from(metrics)
      .where(eq(metrics.userId, userId))
      .limit(1);

    if (userMetrics && userMetrics.length > 0) {
      const currentUL = userMetrics[0].creditsUl || 0;
      const requiredUL = 24; // UMPI requirement: minimum 24 UL credits
      remainingUL = Math.max(0, requiredUL - currentUL);
    }
  } catch (error) {
    logger.error('Error fetching plan hints, using defaults', { userId, error });
  }

  return {
    remainingUL,
    baselineSessions,
  };
}

interface PriorSnapshots {
  lastWeekTotal: number | null;
}

async function getPriorSnapshots(userId: string): Promise<PriorSnapshots> {
  // TODO: Future - fetch from flight_deck_snapshots table when implemented
  return {
    lastWeekTotal: null,
  };
}
