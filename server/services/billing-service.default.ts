/**
 * Production wiring of the billing service: real Postgres via server/lib/db.ts.
 */
import { db } from "../lib/db";
import { billingRepository, type Tx } from "../repositories/billing-repo";
import { createBillingService } from "./billing-service";

export const defaultBillingService = createBillingService<Tx>({
  repo: billingRepository,
  transaction: (fn) => db.transaction((tx) => fn(tx as unknown as Tx)),
  readTx: db,
  now: () => new Date(),
});
