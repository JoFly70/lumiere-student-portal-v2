import { totalmem } from "node:os";
import { getHeapStatistics } from "node:v8";

// Leave 10% headroom against real limits, not V8's currently allocated heap.
export const MEMORY_PRESSURE_THRESHOLD = 0.9;

export interface MemoryPressureSnapshot {
  heapUsed: number;
  rss: number;
  heapLimit: number;
  systemCapacity: number;
  constrainedCapacity?: number;
}

function positive(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function utilization(used: number, limit: number | null): number | null {
  return limit !== null && Number.isFinite(used) && used >= 0 ? used / limit : null;
}

/** Pure calculation, using bytes throughout; unavailable measurements fail closed. */
export function evaluateMemoryPressure(snapshot: MemoryPressureSnapshot) {
  const capacities = [snapshot.systemCapacity, snapshot.constrainedCapacity].filter(positive);
  const rssCapacityBytes = capacities.length ? Math.min(...capacities) : null;
  const heapLimitBytes = positive(snapshot.heapLimit) ? snapshot.heapLimit : null;
  const heapUsedRatio = utilization(snapshot.heapUsed, heapLimitBytes);
  const rssRatio = utilization(snapshot.rss, rssCapacityBytes);
  const reasons: string[] = [];

  if (heapUsedRatio === null) reasons.push("heap_measurement_unavailable");
  else if (heapUsedRatio >= MEMORY_PRESSURE_THRESHOLD) reasons.push("heap_limit_pressure");
  if (rssRatio === null) reasons.push("rss_measurement_unavailable");
  else if (rssRatio >= MEMORY_PRESSURE_THRESHOLD) reasons.push("rss_capacity_pressure");

  return {
    status: reasons.length ? "warning" as const : "ok" as const,
    reasons,
    heapUsedRatio,
    rssRatio,
    heapLimitBytes,
    rssCapacityBytes,
    capacitySource: rssCapacityBytes === null ? "unavailable"
      : rssCapacityBytes === snapshot.constrainedCapacity ? "process_constraint" : "system",
    threshold: MEMORY_PRESSURE_THRESHOLD,
  };
}

export function getMemoryPressure(usage: Pick<NodeJS.MemoryUsage, "heapUsed" | "rss"> = process.memoryUsage()) {
  return evaluateMemoryPressure({
    heapUsed: usage.heapUsed,
    rss: usage.rss,
    heapLimit: getHeapStatistics().heap_size_limit,
    systemCapacity: totalmem(),
    // Node 20/libuv detects OS/container constraints; 0 means none is known.
    constrainedCapacity: typeof process.constrainedMemory === "function" ? process.constrainedMemory() : undefined,
  });
}
