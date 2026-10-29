/** Production wiring of the program journey service: real Postgres via server/lib/db.ts. */
import { db } from "../../lib/db";
import { computeControlCenter } from "./control-center";
import { createProgramJourneyService, type SqlExecutor } from "./service";

const executor = db as unknown as SqlExecutor & { transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> };

export const defaultProgramJourneyService = createProgramJourneyService({ db: executor, now: () => new Date() });
export const defaultControlCenter = () => computeControlCenter(executor, new Date());
