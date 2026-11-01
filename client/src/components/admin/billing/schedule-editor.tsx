/**
 * Installment schedule helpers (S19): an even split that keeps the sum exact, and month arithmetic for due dates.
 * The editing UI is the Student File's EditPlanDialog (translated); the former standalone ScheduleDialog and
 * InstallmentEditDialog were never rendered and were removed in S32-B. Integer cents only.
 */

export interface DraftInstallment { dueDate: string; amount: string; label: string }

/** Splits `totalCents` into `count` parts; the remainder cents go to the LAST installment so the sum is exact. */
export function splitEvenly(totalCents: number, count: number): number[] {
  if (!Number.isInteger(count) || count < 1) return [];
  const base = Math.floor(totalCents / count);
  const parts = Array<number>(count).fill(base);
  parts[count - 1]! += totalCents - base * count;
  return parts;
}

export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}
