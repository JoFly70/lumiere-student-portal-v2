/**
 * Production wiring of the high school service: real Postgres via server/lib/db.ts.
 */
import { db } from "../lib/db";
import { highSchoolRepository, type Tx } from "../repositories/high-school-repo";
import { createHighSchoolService } from "./high-school-service";

export const defaultHighSchoolService = createHighSchoolService({
  repo: highSchoolRepository,
  transaction: (fn) => db.transaction((tx) => fn(tx as unknown as Tx)),
  readTx: db,
  now: () => new Date(),
});
