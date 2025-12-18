import { supabaseAdmin } from './lib/supabase';

interface DegreeTemplate {
  id: string;
  university: string;
  degree_name: string;
  total_credits: number;
  min_upper_credits: number;
  residency_credits: number;
  capstone_code: string | null;
}

interface DegreeRequirement {
  id: string;
  template_id: string;
  area_code: string;
  area_name: string;
  required_credits: number;
  must_take_course_codes: string[];
  notes: string;
}

interface RequirementMapping {
  id: string;
  requirement_id: string;
  course_code_pattern: string | null;
  title_keywords: string[];
  fulfills_credits: number;
  level: 'lower' | 'upper' | null;
  provider_filter: string[];
  notes: string;
}

interface ProviderCourse {
  id: string;
  provider: string;
  course_code: string;
  title: string;
  credits: number;
  level: 'lower' | 'upper' | null;
  est_hours: number;
  url: string | null;
  price_est: string;
  area_tags: string[];
}

interface RoadmapStep {
  step_index: number;
  item_type: 'provider_course' | 'university_session';
  ref_code: string;
  title: string;
  credits: number;
  est_cost: number;
  est_weeks: number;
}

interface AreaGap {
  areaCode: string;
  areaName: string;
  remaining: number;
}

export async function generateRoadmap(
  userId: string,
  templateId: string,
  paceHoursPerWeek: number = 12,
  paceMonths: number = 12
): Promise<{ planId: string; summary: any; steps: RoadmapStep[]; financials?: any }> {
  
  // 1. Load framework
  const { data: template } = await supabaseAdmin
    .from('degree_templates')
    .select('*')
    .eq('id', templateId)
    .single();

  if (!template) throw new Error('Degree template not found');

  const { data: requirements } = await supabaseAdmin
    .from('degree_requirements')
    .select('*')
    .eq('template_id', templateId);

  const { data: mappings } = await supabaseAdmin
    .from('requirement_mappings')
    .select('*');

  const { data: catalog } = await supabaseAdmin
    .from('provider_catalog')
    .select('*');

  if (!requirements || !mappings || !catalog) {
    throw new Error('Failed to load degree framework');
  }

  // 2. Compute gaps (no prior courses for MVP)
  const gaps: AreaGap[] = requirements.map(req => ({
    areaCode: req.area_code,
    areaName: req.area_name,
    remaining: req.required_credits,
  }));

  // 3. Fill gaps with provider catalog
  const selectedCourses: Array<{ course: ProviderCourse; areaCode: string }> = [];
  let totalUpperCredits = 0;
  let totalResidencyCredits = 0;

  // Priority order: specific areas > ELECTIVES
  const priorityOrder = [
    'GEN-ENG', 'GEN-MATH', 'GEN-SCI', 'GEN-SOC', 'GEN-HUM', 'GEN-COM',
    'GEN-OPEN', 'MAJOR-CORE', 'MAJOR-CAP', 'ELECTIVES'
  ];

  for (const areaCode of priorityOrder) {
    const gap = gaps.find(g => g.areaCode === areaCode);
    if (!gap || gap.remaining <= 0) continue;

    // Find mappings for this area
    const areaRequirement = requirements.find(r => r.area_code === areaCode);
    if (!areaRequirement) continue;

    const areaMappings = mappings.filter(m => m.requirement_id === areaRequirement.id);

    // Find matching courses
    const matchingCourses = catalog.filter(course => {
      // Check area tags
      const hasAreaTag = course.area_tags.some((tag: string) => 
        areaCode.includes(tag) || tag === areaCode
      );
      
      // Check provider filter
      const passesProviderFilter = areaMappings.every(mapping => {
        if (!mapping.provider_filter || mapping.provider_filter.length === 0) return true;
        return mapping.provider_filter.includes(course.provider);
      });

      // Check course code pattern
      const matchesPattern = areaMappings.some(mapping => {
        if (!mapping.course_code_pattern) return hasAreaTag;
        const regex = new RegExp(mapping.course_code_pattern, 'i');
        return regex.test(course.course_code);
      });

      // Check title keywords
      const matchesKeywords = areaMappings.some(mapping => {
        if (!mapping.title_keywords || mapping.title_keywords.length === 0) return hasAreaTag;
        return mapping.title_keywords.some((keyword: string) =>
          course.title.toLowerCase().includes(keyword.toLowerCase())
        );
      });

      return (hasAreaTag || matchesPattern || matchesKeywords) && passesProviderFilter;
    });

    // Sort by est_hours (prefer faster), then by price_est (prefer cheaper)
    matchingCourses.sort((a, b) => {
      if (a.est_hours !== b.est_hours) return a.est_hours - b.est_hours;
      return parseFloat(a.price_est) - parseFloat(b.price_est);
    });

    // Add courses until gap is filled
    let creditsToFill = gap.remaining;
    for (const course of matchingCourses) {
      if (creditsToFill <= 0) break;

      selectedCourses.push({ course, areaCode });
      creditsToFill -= course.credits;
      gap.remaining -= course.credits;

      // Track upper-level and residency credits
      if (course.level === 'upper') totalUpperCredits += course.credits;
      if (course.provider === 'University') totalResidencyCredits += course.credits;

      if (creditsToFill <= 0) break;
    }
  }

  // 4. Policy enforcement: ensure UL ≥ 30 and Residency ≥ 30
  
  // First, count UL and Residency credits already in plan
  totalUpperCredits = 0;
  totalResidencyCredits = 0;
  for (const item of selectedCourses) {
    if (item.course.level === 'upper') totalUpperCredits += item.course.credits;
    if (item.course.provider === 'University') totalResidencyCredits += item.course.credits;
  }

  // Ensure capstone is included (required for MAJOR-CAP)
  const capstoneInPlan = selectedCourses.some(item => item.course.course_code === template.capstone_code);
  if (template.capstone_code && !capstoneInPlan) {
    const capstone = catalog.find(c => c.course_code === template.capstone_code);
    if (capstone) {
      selectedCourses.push({ course: capstone, areaCode: 'MAJOR-CAP' });
      if (capstone.level === 'upper') totalUpperCredits += capstone.credits;
      if (capstone.provider === 'University') totalResidencyCredits += capstone.credits;
    }
  }

  // Add/replace courses to meet UL and Residency policies through rebalancing
  // Strategy: Replace low-priority (ELECTIVES) lower-level provider courses with University UL courses
  // while maintaining exactly 120 total credits
  let ulShortfall = template.min_upper_credits - totalUpperCredits;
  let residencyShortfall = template.residency_credits - totalResidencyCredits;
  
  while (ulShortfall > 0 || residencyShortfall > 0) {
    // Calculate current total
    const currentTotal = selectedCourses.reduce((sum, item) => sum + item.course.credits, 0);
    
    // Find available University UL courses not already in plan
    const availableULCourses = catalog.filter(c => 
      c.provider === 'University' && 
      c.level === 'upper' &&
      !selectedCourses.some(item => item.course.id === c.id)
    );

    if (availableULCourses.length === 0) {
      throw new Error(`Insufficient University UL courses to satisfy policies (UL shortfall: ${ulShortfall}, Residency shortfall: ${residencyShortfall})`);
    }

    // Pick cheapest University UL course
    availableULCourses.sort((a, b) => parseFloat(a.price_est) - parseFloat(b.price_est));
    const ulCourse = availableULCourses[0];

    // Find ELECTIVES that are lower-level provider courses to replace
    const replaceableCourses = selectedCourses
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => 
        item.areaCode === 'ELECTIVES' && 
        item.course.level !== 'upper' && 
        item.course.provider !== 'University'
      );

    if (replaceableCourses.length > 0) {
      // Calculate how many credits we need to remove to make room for this UL course
      const creditsToFree = Math.max(0, (currentTotal + ulCourse.credits) - template.total_credits);
      
      // Remove enough electives to make room
      let creditsFreed = 0;
      const indicesToRemove: number[] = [];
      
      for (const { item, index } of replaceableCourses) {
        if (creditsFreed >= creditsToFree) break;
        indicesToRemove.push(index);
        creditsFreed += item.course.credits;
      }
      
      // CRITICAL: Verify we freed enough credits before adding the UL course
      if (creditsFreed < creditsToFree) {
        throw new Error(`Cannot free enough credits for UL course: need ${creditsToFree}, freed ${creditsFreed} (UL: ${ulShortfall}, Residency: ${residencyShortfall})`);
      }
      
      // Remove courses (from highest index first to avoid index shifting)
      for (const index of indicesToRemove.sort((a, b) => b - a)) {
        selectedCourses.splice(index, 1);
      }
      
      // Add the University UL course (only after verified we freed enough space)
      selectedCourses.push({ course: ulCourse, areaCode: 'ELECTIVES' });
      totalUpperCredits += ulCourse.credits;
      totalResidencyCredits += ulCourse.credits;
    } else {
      // No replaceable electives - try to add if under limit
      if (currentTotal + ulCourse.credits <= template.total_credits) {
        selectedCourses.push({ course: ulCourse, areaCode: 'ELECTIVES' });
        totalUpperCredits += ulCourse.credits;
        totalResidencyCredits += ulCourse.credits;
      } else {
        throw new Error(`Cannot satisfy UL/Residency policies: no ELECTIVES to replace and no room to add (UL: ${ulShortfall}, Residency: ${residencyShortfall})`);
      }
    }
    
    ulShortfall = template.min_upper_credits - totalUpperCredits;
    residencyShortfall = template.residency_credits - totalResidencyCredits;
  }
  
  // Assert policies are met
  if (totalUpperCredits < template.min_upper_credits) {
    throw new Error(`Failed to meet UL minimum: ${totalUpperCredits} < ${template.min_upper_credits}`);
  }
  if (totalResidencyCredits < template.residency_credits) {
    throw new Error(`Failed to meet residency minimum: ${totalResidencyCredits} < ${template.residency_credits}`);
  }

  // 5. Final backfill: if total < 120, add cheap provider courses to reach at least 120
  let totalCredits = selectedCourses.reduce((sum, item) => sum + item.course.credits, 0);
  
  if (totalCredits < template.total_credits) {
    // Find cheap provider courses not already in plan
    const availableProviderCourses = catalog.filter(c =>
      c.provider !== 'University' &&
      !selectedCourses.some(item => item.course.id === c.id)
    );
    
    // Sort by price (cheapest first)
    availableProviderCourses.sort((a, b) => parseFloat(a.price_est) - parseFloat(b.price_est));
    
    // Add courses until we reach AT LEAST 120 (can go a bit over, max 124)
    for (const course of availableProviderCourses) {
      // Stop if we've already reached minimum and adding would exceed 124
      if (totalCredits >= template.total_credits && totalCredits + course.credits > 124) {
        break;
      }
      
      // Add course if we're under 120, or if it won't push us too far over
      if (totalCredits < template.total_credits || totalCredits + course.credits <= 124) {
        selectedCourses.push({ course, areaCode: 'ELECTIVES' });
        totalCredits += course.credits;
      }
      
      // Stop once we've reached at least 120 and can't add more without exceeding 124
      if (totalCredits >= template.total_credits) {
        break;
      }
    }
  }
  
  // Final assertion: MUST be at least 120 (can be up to 124)
  if (totalCredits < template.total_credits) {
    throw new Error(`Plan has only ${totalCredits} credits, must be at least ${template.total_credits}`);
  }
  if (totalCredits > 124) {
    throw new Error(`Plan has ${totalCredits} credits, must not exceed 124 credits`);
  }
  
  // Log if over 120
  if (totalCredits > template.total_credits) {
    console.log(`Plan has ${totalCredits} credits (minimum: ${template.total_credits}) - acceptable overage`);
  }

  // Calculate summary metrics
  const totalCost = selectedCourses.reduce((sum, item) => sum + parseFloat(item.course.price_est), 0);
  const totalHours = selectedCourses.reduce((sum, item) => sum + item.course.est_hours, 0);
  const estMonths = Math.ceil(totalHours / (paceHoursPerWeek * 4));

  // Create or update roadmap plan
  const { data: existingPlan } = await supabaseAdmin
    .from('roadmap_plans')
    .select('*')
    .eq('user_id', userId)
    .eq('template_id', templateId)
    .single();

  let planId: string;

  if (existingPlan) {
    // Update existing plan
    const { data: updatedPlan } = await supabaseAdmin
      .from('roadmap_plans')
      .update({
        total_remaining_credits: Math.max(0, template.total_credits - totalCredits),
        est_cost: totalCost.toFixed(2),
        est_months: estMonths,
        version: existingPlan.version + 1,
      })
      .eq('id', existingPlan.id)
      .select()
      .single();

    planId = existingPlan.id;

    // Delete old steps
    await supabaseAdmin
      .from('roadmap_steps')
      .delete()
      .eq('plan_id', planId);
  } else {
    // Create new plan
    const { data: newPlan } = await supabaseAdmin
      .from('roadmap_plans')
      .insert({
        user_id: userId,
        template_id: templateId,
        status: 'draft',
        total_remaining_credits: Math.max(0, template.total_credits - totalCredits),
        est_cost: totalCost.toFixed(2),
        est_months: estMonths,
        version: 1,
      })
      .select()
      .single();

    planId = newPlan!.id;
  }

  // Insert roadmap steps
  const steps: RoadmapStep[] = selectedCourses.map((item, index) => ({
    step_index: index + 1,
    item_type: item.course.provider === 'University' ? 'university_session' : 'provider_course',
    ref_code: item.course.course_code,
    title: item.course.title,
    credits: item.course.credits,
    est_cost: parseFloat(item.course.price_est),
    est_weeks: Math.ceil(item.course.est_hours / paceHoursPerWeek),
  }));

  if (steps.length > 0) {
    await supabaseAdmin
      .from('roadmap_steps')
      .insert(
        steps.map(step => ({
          plan_id: planId,
          step_index: step.step_index,
          item_type: step.item_type,
          ref_code: step.ref_code,
          title: step.title,
          credits: step.credits,
          est_cost: step.est_cost.toFixed(2),
          est_weeks: step.est_weeks,
        }))
      );
  }

  const summary = {
    totalCredits,
    totalCost,
    estMonths,
    upperLevelCredits: totalUpperCredits,
    residencyCredits: totalResidencyCredits,
    remainingCredits: Math.max(0, template.total_credits - totalCredits),
  };

  // Calculate financials
  let financials = null;
  try {
    const { calculateFinancials, saveFinancials } = await import('./financial-calculator');
    
    // Count University sessions (each University course beyond capstone = 1 session)
    const universityCourses = selectedCourses.filter(item => item.course.provider === 'University');
    const sessions_actual = Math.max(2, Math.ceil(universityCourses.length / 5)); // ~5 courses per session
    
    // Calculate Phase 1 cost (provider courses only)
    const phase1_cost = selectedCourses
      .filter(item => item.course.provider !== 'University')
      .reduce((sum, item) => sum + parseFloat(item.course.price_est), 0);
    
    const financialInputs = {
      pace_months: paceMonths,
      sessions_actual,
      phase1_cost,
      payment_method: 'card' as const
    };
    
    financials = await calculateFinancials(financialInputs);
    await saveFinancials(planId, financialInputs, financials);
    
    console.log('Financial calculations completed:', {
      projected_total: financials.projected_total,
      monthly_payment: financials.monthly_payment
    });
  } catch (error) {
    console.error('Error calculating financials:', error);
    // Continue without financials if calculation fails
  }

  return { planId, summary, steps, financials };
}
