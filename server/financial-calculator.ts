import { supabaseAdmin } from './lib/supabase';

export interface FinancialInputs {
  pace_months: number;
  sessions_actual: number;
  phase1_cost: number;
  exam?: {
    use: boolean;
    exam_code?: string;
    credits?: number;
    exam_cost?: number;
  };
  replaced_provider?: {
    provider: string;
    per_credit_est: number;
  };
  payment_method?: 'card' | 'ach' | 'wire' | 'paypal' | 'crypto';
}

export interface FinancialResult {
  projected_total: number;
  over_15k: boolean;
  overage_reasons: string[];
  upfront_due: number;
  remaining: number;
  monthly_payment: number;
  payment_months: number;
  includes_premium_exam: boolean;
  premium_exam_cost: number;
  duration_multiplier: number;
  payment_method_fees: {
    per_installment: number;
    total: number;
  };
  warnings: string[];
  start_date: string;
  completion_target: string;
  monthly_schedule: Array<{
    month: number;
    payment_amount: number;
    payment_method: string;
    total_paid: number;
    remaining_balance: number;
  }>;
}

/**
 * Calculate financial projections for a degree plan
 * 
 * Logic:
 * 1. Base cost = LUMIERE_FEE + Phase1_cost + (sessions × $1,800)
 * 2. Apply duration multiplier based on pace_months
 * 3. Add premium exam costs if selected
 * 4. Calculate upfront ($7,000) + monthly payments
 * 5. Apply payment method fees
 */
export async function calculateFinancials(inputs: FinancialInputs): Promise<FinancialResult> {
  // Fetch financial rules
  const { data: rules } = await supabaseAdmin
    .from('financial_rules')
    .select('*')
    .single();

  if (!rules) {
    throw new Error('Financial rules not configured');
  }

  // Fetch duration multiplier
  const { data: durationRule } = await supabaseAdmin
    .from('duration_rules')
    .select('*')
    .eq('months', inputs.pace_months)
    .single();

  const cost_multiplier = durationRule?.cost_multiplier || 1.0;

  // Calculate base costs
  const sessions_cost = inputs.sessions_actual * rules.umpi_session_cost;
  let base_total = rules.lumiere_fee + inputs.phase1_cost + sessions_cost;

  // Apply duration multiplier
  base_total = base_total * cost_multiplier;

  // Handle premium exams
  let exam_delta = 0;
  let exam_cost = 0;
  let replaced_provider_cost = 0;

  if (inputs.exam?.use && inputs.exam.exam_code) {
    exam_cost = inputs.exam.exam_cost || 0;
    
    // Calculate replaced provider cost
    if (inputs.replaced_provider && inputs.exam.credits) {
      replaced_provider_cost = inputs.exam.credits * inputs.replaced_provider.per_credit_est;
    }
    
    exam_delta = Math.max(0, exam_cost - replaced_provider_cost);
  }

  // Final projected total
  const projected_total = base_total + exam_delta;

  // Check if over $15K
  const over_15k = projected_total > rules.total_projection;
  const overage_reasons: string[] = [];

  if (inputs.sessions_actual > rules.baseline_sessions) {
    overage_reasons.push('Extra UMPI session(s)');
  }
  if (inputs.exam?.use && exam_delta > 0) {
    overage_reasons.push('Premium language exam');
  }

  // Payment breakdown
  const upfront_due = rules.lumiere_fee;
  const remaining = projected_total - upfront_due;
  const base_monthly_payment = remaining / inputs.pace_months;

  // Apply payment method fees
  const payment_method = inputs.payment_method || 'card';
  let fee_per_installment = 0;
  let monthly_payment = base_monthly_payment;

  if (payment_method === 'card') {
    fee_per_installment = base_monthly_payment * (rules.card_fee_pct / 100);
    monthly_payment = base_monthly_payment + fee_per_installment;
  } else if (payment_method === 'wire') {
    fee_per_installment = rules.wire_fee_flat;
    monthly_payment = base_monthly_payment + fee_per_installment;
  } else if (payment_method === 'ach') {
    fee_per_installment = base_monthly_payment * (rules.ach_fee_pct / 100);
    monthly_payment = base_monthly_payment + fee_per_installment;
  }

  const total_fees = fee_per_installment * inputs.pace_months;

  // Generate warnings
  const warnings: string[] = [];
  if (over_15k) {
    const reasons = overage_reasons.join(' and ');
    warnings.push(
      `Total exceeds the standard $15,000 projection due to ${reasons}.`
    );
  }

  // Calculate dates
  const start_date = new Date();
  const completion_target = new Date(start_date);
  completion_target.setMonth(completion_target.getMonth() + inputs.pace_months);

  // Generate monthly schedule with running totals
  const monthly_schedule = [];
  let total_paid = upfront_due;
  
  for (let i = 1; i <= inputs.pace_months; i++) {
    total_paid += monthly_payment;
    const remaining_balance = projected_total - total_paid;
    
    monthly_schedule.push({
      month: i,
      payment_amount: parseFloat(monthly_payment.toFixed(2)),
      payment_method: payment_method,
      total_paid: parseFloat(total_paid.toFixed(2)),
      remaining_balance: parseFloat(Math.max(0, remaining_balance).toFixed(2))
    });
  }

  return {
    projected_total: parseFloat(projected_total.toFixed(2)),
    over_15k,
    overage_reasons,
    upfront_due: parseFloat(upfront_due.toFixed(2)),
    remaining: parseFloat(remaining.toFixed(2)),
    monthly_payment: parseFloat(monthly_payment.toFixed(2)),
    payment_months: inputs.pace_months,
    includes_premium_exam: !!(inputs.exam?.use),
    premium_exam_cost: inputs.exam?.exam_cost || 0,
    duration_multiplier: cost_multiplier,
    payment_method_fees: {
      per_installment: parseFloat(fee_per_installment.toFixed(2)),
      total: parseFloat(total_fees.toFixed(2))
    },
    warnings,
    start_date: start_date.toISOString().split('T')[0],
    completion_target: completion_target.toISOString().split('T')[0],
    monthly_schedule
  };
}

/**
 * Save financial calculations to database
 * Uses upsert to handle plan regeneration (updates existing record if plan_id already exists)
 */
export async function saveFinancials(planId: string, inputs: FinancialInputs, result: FinancialResult) {
  const { error } = await supabaseAdmin
    .from('plan_financials')
    .upsert({
      plan_id: planId,
      pace_months: inputs.pace_months,
      sessions_actual: inputs.sessions_actual,
      phase1_cost: inputs.phase1_cost,
      exam_selected: inputs.exam?.use || false,
      exam_code: inputs.exam?.exam_code || null,
      exam_credits: inputs.exam?.credits || 0,
      exam_cost: inputs.exam?.exam_cost || 0,
      replaced_provider_cost: inputs.replaced_provider 
        ? (inputs.exam?.credits || 0) * inputs.replaced_provider.per_credit_est 
        : 0,
      projected_total: result.projected_total,
      over_15k: result.over_15k,
      overage_reasons: result.overage_reasons,
      payment_method: inputs.payment_method || 'card',
      monthly_payment: result.monthly_payment,
      upfront_due: result.upfront_due,
      start_date: result.start_date,
      completion_target: result.completion_target,
      monthly_schedule: result.monthly_schedule
    }, {
      onConflict: 'plan_id'
    });

  if (error) {
    console.error('Error saving financials:', error);
    throw error;
  }
}
