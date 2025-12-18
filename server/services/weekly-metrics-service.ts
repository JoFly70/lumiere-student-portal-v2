import { db } from "../lib/db";
import { weeklyMetrics, type InsertWeeklyMetric, type WeeklyMetric } from "@shared/schema";
import { eq, and, desc, gte, lte } from "drizzle-orm";
import { logger } from "../lib/logger";

/**
 * Get week start date (Monday) from any date
 */
export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday
  const monday = new Date(d.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/**
 * Format date as YYYY-MM-DD for SQL
 */
export function formatDateForSQL(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Get or create weekly metrics record for user and week
 */
export async function upsertWeeklyMetrics(
  userId: string,
  weekOf: Date,
  hoursStudied: number,
  notes?: string
): Promise<WeeklyMetric> {
  const weekStart = getWeekStart(weekOf);
  const weekOfStr = formatDateForSQL(weekStart);

  logger.info("Upserting weekly metrics", {
    userId,
    weekOf: weekOfStr,
    hoursStudied,
    hasNotes: !!notes
  });

  // Try to find existing record
  const existing = await db
    .select()
    .from(weeklyMetrics)
    .where(
      and(
        eq(weeklyMetrics.userId, userId),
        eq(weeklyMetrics.weekOf, weekOfStr)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    // Update existing record
    const [updated] = await db
      .update(weeklyMetrics)
      .set({
        hoursStudied,
        notes,
        updatedAt: new Date()
      })
      .where(eq(weeklyMetrics.id, existing[0].id))
      .returning();

    logger.info("Updated weekly metrics", {
      id: updated.id,
      userId,
      weekOf: weekOfStr
    });

    return updated;
  } else {
    // Create new record
    const [created] = await db
      .insert(weeklyMetrics)
      .values({
        userId,
        weekOf: weekOfStr,
        hoursStudied,
        notes
      })
      .returning();

    logger.info("Created weekly metrics", {
      id: created.id,
      userId,
      weekOf: weekOfStr
    });

    return created;
  }
}

/**
 * Get weekly metrics for a specific user and week
 */
export async function getWeeklyMetrics(
  userId: string,
  weekOf: Date
): Promise<WeeklyMetric | null> {
  const weekStart = getWeekStart(weekOf);
  const weekOfStr = formatDateForSQL(weekStart);

  const [record] = await db
    .select()
    .from(weeklyMetrics)
    .where(
      and(
        eq(weeklyMetrics.userId, userId),
        eq(weeklyMetrics.weekOf, weekOfStr)
      )
    )
    .limit(1);

  return record || null;
}

/**
 * Get all weekly metrics for a user within a date range
 */
export async function getWeeklyMetricsRange(
  userId: string,
  startDate: Date,
  endDate: Date
): Promise<WeeklyMetric[]> {
  const startStr = formatDateForSQL(getWeekStart(startDate));
  const endStr = formatDateForSQL(getWeekStart(endDate));

  return await db
    .select()
    .from(weeklyMetrics)
    .where(
      and(
        eq(weeklyMetrics.userId, userId),
        gte(weeklyMetrics.weekOf, startStr),
        lte(weeklyMetrics.weekOf, endStr)
      )
    )
    .orderBy(desc(weeklyMetrics.weekOf));
}

/**
 * Get recent weekly metrics for a user (last N weeks)
 */
export async function getRecentWeeklyMetrics(
  userId: string,
  weeksBack: number = 12
): Promise<WeeklyMetric[]> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (weeksBack * 7));

  return await getWeeklyMetricsRange(userId, startDate, endDate);
}

/**
 * Delete weekly metrics record
 */
export async function deleteWeeklyMetrics(id: string): Promise<void> {
  await db
    .delete(weeklyMetrics)
    .where(eq(weeklyMetrics.id, id));

  logger.info("Deleted weekly metrics", { id });
}
