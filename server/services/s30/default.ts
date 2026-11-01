/** Production wiring of the S30 services: real Postgres via server/lib/db.ts. */
import { db } from "../../lib/db";
import { computeControlCenter } from "../program-journey/control-center";
import { buildCalendarItems, loadCalendarFacts } from "./calendar";
import type { FleetInput } from "./fleet/engine";
import { loadExceptionStates, mergeExceptions, type TxDb } from "./ops";

export const s30Db = db as unknown as TxDb;

export async function loadExceptions(now: Date) {
  const [cc, states] = await Promise.all([computeControlCenter(s30Db, now), loadExceptionStates(s30Db)]);
  return { cc, view: mergeExceptions(cc, states, now) };
}

export async function loadFleetInput(now: Date): Promise<FleetInput> {
  const day = (offset: number) => new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const [{ cc, view }, facts] = await Promise.all([loadExceptions(now), loadCalendarFacts(s30Db, { studentIds: null })]);
  const calendar = buildCalendarItems(facts, { role: "admin" }, { from: day(-60), to: day(30) }, now, { includeDemo: true });
  const targets = new Map<string, string>();
  for (const p of facts.plans) { const t = p.content?.pacing?.targetCompletionDate; if (t) targets.set(p.studentId, t); }
  return { now, students: cc.students, exceptions: view.exceptions, calendar, targets, truncated: cc.truncated || facts.truncated };
}
