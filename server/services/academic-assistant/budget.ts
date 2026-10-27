/**
 * Persistent monthly spend accounting (micro-USD). Reserve-then-settle so concurrent
 * requests cannot overshoot the cap. Any storage error must make the caller fail closed.
 */
import { sql } from 'drizzle-orm';

export interface BudgetStore {
  /** Atomically add `reserveMicro` if month total + reserve <= capMicro. */
  reserve(month: string, reserveMicro: number, capMicro: number): Promise<boolean>;
  /** Replace the reservation with the actual cost (>= 0 delta applied). */
  settle(month: string, reservedMicro: number, actualMicro: number): Promise<void>;
  /** True if at least `minNeedMicro` still fits (read-only; used for status). */
  hasHeadroom(month: string, capMicro: number, minNeedMicro: number): Promise<boolean>;
}

export function currentMonth(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

export const usdToMicro = (usd: number) => Math.ceil(usd * 1_000_000);

export class PgBudgetStore implements BudgetStore {
  private async database() {
    const { db } = await import('../../lib/db');
    return db;
  }

  async reserve(month: string, reserveMicro: number, capMicro: number): Promise<boolean> {
    if (reserveMicro > capMicro) return false;
    const db = await this.database();
    const rows: any = await db.execute(sql`
      INSERT INTO assistant_usage_monthly (month, cost_micro_usd, requests, updated_at)
      VALUES (${month}, ${reserveMicro}, 1, now())
      ON CONFLICT (month) DO UPDATE
        SET cost_micro_usd = assistant_usage_monthly.cost_micro_usd + ${reserveMicro},
            requests = assistant_usage_monthly.requests + 1,
            updated_at = now()
        WHERE assistant_usage_monthly.cost_micro_usd + ${reserveMicro} <= ${capMicro}
      RETURNING month`);
    const list = Array.isArray(rows) ? rows : rows?.rows ?? [];
    return list.length > 0;
  }

  async settle(month: string, reservedMicro: number, actualMicro: number): Promise<void> {
    const db = await this.database();
    const delta = actualMicro - reservedMicro;
    await db.execute(sql`
      UPDATE assistant_usage_monthly
         SET cost_micro_usd = GREATEST(0, cost_micro_usd + ${delta}), updated_at = now()
       WHERE month = ${month}`);
  }

  async hasHeadroom(month: string, capMicro: number, minNeedMicro: number): Promise<boolean> {
    const db = await this.database();
    const rows: any = await db.execute(
      sql`SELECT cost_micro_usd FROM assistant_usage_monthly WHERE month = ${month}`,
    );
    const list = Array.isArray(rows) ? rows : rows?.rows ?? [];
    const used = list.length ? Number(list[0].cost_micro_usd) : 0;
    if (!Number.isFinite(used)) throw new Error('budget_unreadable');
    return used + minNeedMicro <= capMicro;
  }
}

/** Non-persistent store for tests only. */
export class MemoryBudgetStore implements BudgetStore {
  totals = new Map<string, number>();
  failing = false;
  private check() { if (this.failing) throw new Error('budget_store_down'); }
  async reserve(month: string, r: number, cap: number) {
    this.check();
    const used = this.totals.get(month) ?? 0;
    if (r > cap || used + r > cap) return false;
    this.totals.set(month, used + r);
    return true;
  }
  async settle(month: string, reserved: number, actual: number) {
    this.check();
    this.totals.set(month, Math.max(0, (this.totals.get(month) ?? 0) + actual - reserved));
  }
  async hasHeadroom(month: string, cap: number, need: number) {
    this.check();
    return (this.totals.get(month) ?? 0) + need <= cap;
  }
}
