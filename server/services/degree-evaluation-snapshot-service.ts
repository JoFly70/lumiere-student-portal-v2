/**
 * Phase 4C service boundary.  Every read and the pure assembler execute
 * inside one caller-supplied transaction.  No repository call is allowed to
 * silently fall back to the process-global database once a transaction is
 * injected.
 */

import { sql } from "drizzle-orm";
import { db } from "../lib/db";
import {
  degreeEvaluationSnapshotRepository,
  type DegreeEvaluationSnapshotRepository,
  type DegreeEvaluationSnapshotTx,
} from "../repositories/degree-evaluation-snapshot-repo";
import {
  assembleDegreeEvaluationSnapshot,
  type DegreeEvaluationSnapshotContext,
  type DegreeEvaluationSnapshotOutput,
} from "@shared/degree-evaluation-snapshot";

export interface DegreeEvaluationSnapshotServiceOptions {
  readonly repository?: DegreeEvaluationSnapshotRepository;
  readonly transaction?: <T>(
    config: {
      readonly isolationLevel: "repeatable read";
      readonly accessMode: "read only";
    },
    callback: (tx: DegreeEvaluationSnapshotTx) => Promise<T>,
  ) => Promise<T>;
}

export interface DegreeEvaluationSnapshotReadRequest {
  readonly context: DegreeEvaluationSnapshotContext;
  readonly repository?: DegreeEvaluationSnapshotRepository;
  readonly transaction?: DegreeEvaluationSnapshotServiceOptions["transaction"];
}

function transactionTimestamp(value: unknown): string {
  const candidate = value && typeof value === "object"
    ? (value as Record<string, unknown>).asOf
      ?? (value as Record<string, unknown>).transaction_timestamp
      ?? (value as Record<string, unknown>).transactionTimestamp
    : value;
  if (candidate instanceof Date) return candidate.toISOString();
  if (typeof candidate === "string") {
    const parsed = new Date(candidate);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return "";
}

async function readInsideTransaction(
  context: DegreeEvaluationSnapshotContext,
  tx: DegreeEvaluationSnapshotTx,
  repository: DegreeEvaluationSnapshotRepository,
): Promise<DegreeEvaluationSnapshotOutput> {
  const timestampResult = await tx.execute(
    sql`SELECT transaction_timestamp() AS "asOf"`,
  );
  const rows = (timestampResult as { rows?: readonly unknown[] }).rows;
  const timestampRow = rows?.[0]
    ?? (Array.isArray(timestampResult) ? timestampResult[0] : timestampResult);
  const asOf = transactionTimestamp(timestampRow);
  const facts = await repository.readFacts(context, tx);
  return assembleDegreeEvaluationSnapshot({ context, asOf, facts });
}

export async function readDegreeEvaluationSnapshotInTransaction(
  context: DegreeEvaluationSnapshotContext,
  tx: DegreeEvaluationSnapshotTx,
  repository: DegreeEvaluationSnapshotRepository = degreeEvaluationSnapshotRepository,
): Promise<DegreeEvaluationSnapshotOutput> {
  return readInsideTransaction(context, tx, repository);
}

export async function readDegreeEvaluationSnapshot(
  request: DegreeEvaluationSnapshotContext | DegreeEvaluationSnapshotReadRequest,
  options: DegreeEvaluationSnapshotServiceOptions = {},
): Promise<DegreeEvaluationSnapshotOutput> {
  const context = "context" in request ? request.context : request;
  const requestOptions = "context" in request
    ? {
      ...options,
      transaction: request.transaction ?? options.transaction,
      repository: request.repository ?? options.repository,
    }
    : options;
  const repository = requestOptions.repository ?? degreeEvaluationSnapshotRepository;
  const transactionConfig = {
    isolationLevel: "repeatable read" as const,
    accessMode: "read only" as const,
  };
  if (requestOptions.transaction !== undefined) {
    return requestOptions.transaction(transactionConfig, (transaction) => (
      readDegreeEvaluationSnapshotInTransaction(context, transaction, repository)
    ));
  }

  return db.transaction(async (transaction) => {
    // PostgreSQL applies these settings to this transaction only.  Keeping
    // this explicit also makes the production runner repeatable and
    // read-only, without changing schema or session defaults.
    await transaction.execute(
      sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`,
    );
    return readDegreeEvaluationSnapshotInTransaction(
      context,
      transaction,
      repository,
    );
  }, transactionConfig);
}

export const getDegreeEvaluationSnapshot = readDegreeEvaluationSnapshot;
export const readDegreeEvaluationSnapshotService = readDegreeEvaluationSnapshot;