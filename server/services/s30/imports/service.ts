/**
 * S30 — Academic Data Import Center workflow:
 *   Upload -> Detect -> Map -> Preview -> Validate -> Review differences -> Approve -> Commit -> Audit
 *
 *   uploaded   file read (format detected by content), headers + raw rows stored, mapping suggested
 *   validated  mapping applied: rows normalised, students/courses matched, duplicates and conflicts classified
 *              (new / changed / unchanged / duplicate_in_file); re-mapping re-validates and clears any approval
 *   approved   an administrator approved the reviewed differences
 *   committed  rows written as provider-/institution-REPORTED records (never official results or credit); rows are
 *              re-validated inside the commit transaction, so the commit applies exactly the current differences
 *   rolled_back  this batch's active records are withdrawn and the records they replaced are restored
 *   discarded  a draft (not committed) batch abandoned
 *
 * Idempotency: one active record per (student, tier, course, task); an identical row (same fingerprint) is
 * "unchanged" and skipped, so re-importing the same file commits nothing new.
 *
 * Operational integration: events and owner notifications go to the S29 layer through imports-port.ts AFTER the
 * database transaction commits; S29's exception queue reads importReviewSummary().
 */
import { sql } from "drizzle-orm";
import { isDemoPreferredName } from "@shared/synthetic-accounts";
import {
  IMPORT_TIER_BY_SOURCE,
  S30_ERROR_CODES as E,
  type ImportBatchDetail,
  type ImportBatchView,
  type ImportColumnMapping,
  type ImportCounts,
  type ImportIssue,
  type ImportMappingView,
  type ImportNormalizedRow,
  type ImportRowView,
  type ImportSourceKind,
  type ImportStatus,
  type ReportedRecordView,
} from "@shared/s30-contract";
import { S30Error, isMissingTable, iso, rows, str, type SqlExecutor, type TxDb } from "../db-util";
import { importOperationsPort, type ImportOpsEvent } from "../imports-port";
import { fingerprint, identityKey, normalizeRow, readTable, suggestMapping, validateMapping, type PlanCourseRef } from "./parse";

type Row = Record<string, unknown>;
const tierOf = (k: ImportSourceKind) => IMPORT_TIER_BY_SOURCE[k];

function toBatchView(r: Row, duplicateOf: string | null = null): ImportBatchView {
  const headers = (r.headers as string[]) ?? [];
  return {
    id: String(r.id), status: r.status as ImportStatus, sourceKind: r.source_kind as ImportSourceKind, tier: tierOf(r.source_kind as ImportSourceKind),
    providerLabel: str(r.provider_label), fileName: str(r.file_name), fileFormat: r.file_format as "csv" | "xlsx", fileSha256: String(r.file_sha256), fileBytes: Number(r.file_bytes),
    sheetName: str(r.sheet_name), headers, mapping: (r.mapping as ImportColumnMapping | null) ?? null, suggestedMapping: suggestMapping(headers), mappingId: str(r.mapping_id),
    counts: (r.counts as Partial<ImportCounts>) ?? {}, uploadedBy: str(r.uploaded_by), uploadedAt: iso(r.uploaded_at), validatedAt: r.validated_at ? iso(r.validated_at) : null,
    approvedBy: str(r.approved_by), approvedAt: r.approved_at ? iso(r.approved_at) : null, committedBy: str(r.committed_by), committedAt: r.committed_at ? iso(r.committed_at) : null,
    rolledBackBy: str(r.rolled_back_by), rolledBackAt: r.rolled_back_at ? iso(r.rolled_back_at) : null, rollbackReason: str(r.rollback_reason), duplicateOfBatchId: duplicateOf,
  };
}

async function loadBatch(db: SqlExecutor, id: string, lock = false): Promise<Row> {
  const [r] = rows(await db.execute(lock ? sql`SELECT * FROM academic_import_batches WHERE id = ${id}::uuid FOR UPDATE` : sql`SELECT * FROM academic_import_batches WHERE id = ${id}::uuid`));
  if (!r) throw new S30Error(E.NOT_FOUND, 404, "Import not found");
  return r;
}
async function duplicateOf(db: SqlExecutor, r: Row): Promise<string | null> {
  const [d] = rows(await db.execute(sql`SELECT id FROM academic_import_batches WHERE file_sha256 = ${String(r.file_sha256)} AND status = 'committed' AND id <> ${String(r.id)}::uuid ORDER BY committed_at DESC LIMIT 1`));
  return d ? String(d.id) : null;
}
/** Serialises commits and rollbacks (one at a time across all instances) so supersede chains stay consistent. */
const lockImports = (tx: SqlExecutor) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('s30.academic_imports'))`);
/** Raw cells are only needed until the import is finished (preview, re-validation); afterwards they are cleared. */
const clearRaw = (tx: SqlExecutor, batchId: string) => tx.execute(sql`UPDATE academic_import_rows SET raw = '{}'::jsonb WHERE batch_id = ${batchId}::uuid AND raw <> '{}'::jsonb`);

function requireStatus(r: Row, allowed: readonly ImportStatus[], action: string) {
  if (!allowed.includes(r.status as ImportStatus)) throw new S30Error(E.INVALID_TRANSITION, 409, `Cannot ${action} an import that is ${String(r.status)}`);
}

// ── upload ───────────────────────────────────────────────────────────────────

export async function uploadBatch(db: TxDb, input: { buffer: Buffer; fileName: string | null; sourceKind: ImportSourceKind; providerLabel: string | null; mappingId: string | null }, actorId: string, now: Date): Promise<ImportBatchDetail> {
  const table = await readTable(input.buffer);
  let mapping: ImportColumnMapping | null = null;
  if (input.mappingId) {
    const [m] = rows(await db.execute(sql`SELECT columns FROM academic_import_mappings WHERE id = ${input.mappingId}::uuid`));
    if (!m) throw new S30Error(E.NOT_FOUND, 404, "Saved mapping not found");
    const cols = m.columns as ImportColumnMapping;
    if (validateMapping(cols, table.headers).length === 0) mapping = cols;
  }
  const fileName = input.fileName ? input.fileName.replace(/[^\p{L}\p{N} ._()-]/gu, "_").slice(0, 200) : null;
  const id = await db.transaction(async (tx) => {
    const [b] = rows(await tx.execute(sql`INSERT INTO academic_import_batches (source_kind, provider_label, file_name, file_format, file_sha256, file_bytes, sheet_name, headers, mapping, mapping_id, counts, uploaded_by)
      VALUES (${input.sourceKind}, ${input.providerLabel}, ${fileName}, ${table.format}, ${table.sha256}, ${table.bytes}, ${table.sheetName}, ${JSON.stringify(table.headers)}::jsonb,
              ${mapping ? JSON.stringify(mapping) : null}::jsonb, ${mapping ? input.mappingId : null}::uuid, ${JSON.stringify({ total: table.rows.length })}::jsonb, ${actorId}) RETURNING id`));
    const batchId = String(b!.id);
    for (let i = 0; i < table.rows.length; i += 200) {
      const chunk = table.rows.slice(i, i + 200);
      await tx.execute(sql`INSERT INTO academic_import_rows (batch_id, row_number, raw) VALUES ${sql.join(chunk.map((r) => sql`(${batchId}::uuid, ${r.rowNumber}, ${JSON.stringify(r.cells)}::jsonb)`), sql`, `)}`);
    }
    return batchId;
  });
  if (mapping) await validateBatch(db, id, mapping, null, actorId, now);
  return getBatch(db, id);
}

// ── map + validate ───────────────────────────────────────────────────────────

interface ValidationOutcome { counts: ImportCounts; perRow: Map<number, { normalized: ImportNormalizedRow | null; studentId: string | null; studentName: string | null; issues: ImportIssue[]; outcome: string; diff: string | null; fingerprint: string | null; identity: string | null; needsReview: boolean; previous: Partial<ImportNormalizedRow> | null; previousId: string | null }> }

async function computeValidation(tx: SqlExecutor, batch: Row, mapping: ImportColumnMapping, now: Date): Promise<ValidationOutcome> {
  const tier = tierOf(batch.source_kind as ImportSourceKind);
  const providerLabel = str(batch.provider_label);
  const raw = rows(await tx.execute(sql`SELECT row_number, raw FROM academic_import_rows WHERE batch_id = ${String(batch.id)}::uuid ORDER BY row_number`));
  const codeHeader = mapping.student_code!;
  const codes = [...new Set(raw.map((r) => String((r.raw as Record<string, string>)[codeHeader] ?? "").trim().toUpperCase()).filter((c) => c && c.length <= 64))];
  const students = new Map<string, { id: string; name: string; isDemo: boolean }>();
  if (codes.length) {
    for (const s of rows(await tx.execute(sql`SELECT id, student_code, first_name, last_name, preferred_name FROM students WHERE upper(student_code) IN (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})`))) {
      students.set(String(s.student_code).toUpperCase(), { id: String(s.id), name: `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim(), isDemo: isDemoPreferredName(str(s.preferred_name)) });
    }
  }
  const ids = [...new Set([...students.values()].map((s) => s.id))];
  const plans = new Map<string, PlanCourseRef[]>();
  const active = new Map<string, Row>();
  if (ids.length) {
    const IN = sql`(${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`;
    for (const p of rows(await tx.execute(sql`SELECT e.student_id, v.content FROM hs_enrollments e JOIN hs_roadmap_versions v ON v.enrollment_id = e.id AND v.status = 'published'
        WHERE e.status IN ('planned','active','on_hold') AND e.student_id IN ${IN} ORDER BY e.created_at DESC`))) {
      const k = String(p.student_id);
      if (plans.has(k)) continue;
      const courses = ((p.content as { courses?: { key: string; title?: string }[] } | null)?.courses ?? []).map((c) => ({ key: c.key, title: c.title ?? c.key }));
      plans.set(k, courses);
    }
    for (const a of rows(await tx.execute(sql`SELECT id, student_id, identity_key, fingerprint, progress_status, percent_complete, score_percent, credits_reported, reported_on::text AS reported_on
        FROM academic_reported_records WHERE status = 'active' AND student_id IN ${IN}`))) active.set(`${a.student_id}\u0000${a.identity_key}`, a);
  }
  const ctx = { today: now.toISOString().slice(0, 10), students, plans };
  const seen = new Set<string>();
  const counts: { -readonly [K in keyof ImportCounts]: ImportCounts[K] } = { total: raw.length, valid: 0, warning: 0, invalid: 0, new: 0, changed: 0, unchanged: 0, duplicateInFile: 0, students: 0, needsReview: 0 };
  const perRow: ValidationOutcome["perRow"] = new Map();
  const touched = new Set<string>();
  for (const r of raw) {
    const n = normalizeRow(r.raw as Record<string, string>, mapping, ctx, tier);
    let diff: string | null = null;
    let fp: string | null = null;
    let identity: string | null = null;
    let previous: Partial<ImportNormalizedRow> | null = null;
    let previousId: string | null = null;
    let outcome: string = n.outcome;
    const issues = [...n.issues];
    if (n.outcome !== "invalid" && n.normalized && n.studentId) {
      identity = identityKey(tier, n.normalized);
      fp = fingerprint(tier, providerLabel, n.normalized);
      const k = `${n.studentId}\u0000${identity}`;
      if (seen.has(k)) {
        diff = "duplicate_in_file";
        issues.push({ code: "duplicate_in_file", field: null, severity: "warning" });
        outcome = "warning";
        counts.duplicateInFile += 1;
      } else {
        seen.add(k);
        const cur = active.get(k);
        if (!cur) { diff = "new"; counts.new += 1; }
        else if (String(cur.fingerprint) === fp) { diff = "unchanged"; counts.unchanged += 1; }
        else {
          diff = "changed"; counts.changed += 1; previousId = String(cur.id);
          previous = { progressStatus: (cur.progress_status as ImportNormalizedRow["progressStatus"]) ?? null, percentComplete: cur.percent_complete === null ? null : Number(cur.percent_complete),
            scorePercent: cur.score_percent === null ? null : Number(cur.score_percent), creditsReported: cur.credits_reported === null ? null : Number(cur.credits_reported), reportedOn: str(cur.reported_on) };
          issues.push({ code: "conflicting_value", field: null, severity: "info" });
        }
        if ((diff === "new" || diff === "changed") && n.needsReview) counts.needsReview += 1;
        if (diff === "new" || diff === "changed") touched.add(n.studentId);
      }
    }
    if (outcome === "valid") counts.valid += 1; else if (outcome === "warning") counts.warning += 1; else counts.invalid += 1;
    perRow.set(Number(r.row_number), { normalized: n.normalized, studentId: n.studentId, studentName: n.studentName, issues, outcome, diff, fingerprint: fp, identity, needsReview: n.needsReview, previous, previousId });
  }
  counts.students = touched.size;
  return { counts, perRow };
}

async function persistValidation(tx: SqlExecutor, batchId: string, v: ValidationOutcome): Promise<void> {
  const list = [...v.perRow.entries()];
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200);
    await tx.execute(sql`UPDATE academic_import_rows AS r SET normalized = v.normalized, student_id = v.student_id, fingerprint = v.fingerprint, outcome = v.outcome, diff = v.diff, issues = v.issues
      FROM (VALUES ${sql.join(chunk.map(([n, x]) => sql`(${n}::int, ${x.normalized ? JSON.stringify({ ...x.normalized, previous: x.previous }) : null}::jsonb, ${x.studentId}::text, ${x.fingerprint}::text, ${x.outcome}::text, ${x.diff}::text, ${JSON.stringify(x.issues)}::jsonb)`), sql`, `)})
        AS v(row_number, normalized, student_id, fingerprint, outcome, diff, issues)
      WHERE r.batch_id = ${batchId}::uuid AND r.row_number = v.row_number`);
  }
}

export async function validateBatch(db: TxDb, id: string, columns: ImportColumnMapping, saveAs: string | null, actorId: string, now: Date): Promise<{ mappingSaved: boolean }> {
  return db.transaction(async (tx) => {
    const batch = await loadBatch(tx, id, true);
    requireStatus(batch, ["uploaded", "validated", "approved"], "map");
    const errors = validateMapping(columns, (batch.headers as string[]) ?? []);
    if (errors.length) throw new S30Error(E.VALIDATION, 400, `Mapping is not usable: ${errors.join("; ")}`);
    // After a validation only the mapped columns are kept, so a different column can only be mapped from a new upload.
    const previous = batch.mapping ? new Set(Object.values(batch.mapping as ImportColumnMapping).filter(Boolean) as string[]) : null;
    const wanted = Object.values(columns).filter(Boolean) as string[];
    if (previous && batch.status !== "uploaded" && wanted.some((h) => !previous.has(h))) {
      throw new S30Error(E.INVALID_TRANSITION, 409, "Only the columns mapped at validation were kept; upload the file again to map a different column");
    }
    let mappingId: string | null = str(batch.mapping_id);
    if (saveAs) {
      const [m] = rows(await tx.execute(sql`INSERT INTO academic_import_mappings (name, source_kind, columns, created_by) VALUES (${saveAs}, ${String(batch.source_kind)}, ${JSON.stringify(columns)}::jsonb, ${actorId})
        ON CONFLICT (name) DO UPDATE SET columns = EXCLUDED.columns, source_kind = EXCLUDED.source_kind, updated_at = now() RETURNING id`));
      mappingId = String(m!.id);
    }
    const v = await computeValidation(tx, batch, columns, now);
    await persistValidation(tx, id, v);
    // Data minimisation: keep only the mapped columns of each row (unmapped cells are never needed again).
    await tx.execute(sql`UPDATE academic_import_rows SET raw = COALESCE((SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(raw) AS e(key, value) WHERE e.key = ANY(ARRAY[${sql.join(wanted.map((h) => sql`${h}`), sql`, `)}]::text[])), '{}'::jsonb)
      WHERE batch_id = ${id}::uuid`);
    await tx.execute(sql`UPDATE academic_import_batches SET status = 'validated', mapping = ${JSON.stringify(columns)}::jsonb, mapping_id = ${mappingId}::uuid, counts = ${JSON.stringify(v.counts)}::jsonb,
      validated_at = now(), approved_by = NULL, approved_at = NULL, updated_at = now() WHERE id = ${id}::uuid`);
    return { mappingSaved: !!saveAs };
  });
}

// ── approve / commit / rollback / discard ───────────────────────────────────

export async function approveBatch(db: TxDb, id: string, actorId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const b = await loadBatch(tx, id, true);
    requireStatus(b, ["validated"], "approve");
    const c = (b.counts as Partial<ImportCounts>) ?? {};
    if ((c.new ?? 0) + (c.changed ?? 0) === 0) throw new S30Error(E.INVALID_TRANSITION, 409, "Nothing to import: every row is invalid, unchanged or a duplicate");
    await tx.execute(sql`UPDATE academic_import_batches SET status = 'approved', approved_by = ${actorId}, approved_at = now(), updated_at = now() WHERE id = ${id}::uuid`);
  });
}

export interface CommitResult { readonly inserted: number; readonly superseded: number; readonly needsReview: number; readonly students: readonly string[] }

export async function commitBatch(db: TxDb, id: string, actorId: string, now: Date): Promise<CommitResult> {
  const result = await db.transaction(async (tx) => {
    await lockImports(tx);
    const b = await loadBatch(tx, id, true);
    requireStatus(b, ["approved"], "commit");
    const mapping = b.mapping as ImportColumnMapping;
    const tier = tierOf(b.source_kind as ImportSourceKind);
    // Re-validate inside the transaction: the commit applies the differences as they are NOW.
    const v = await computeValidation(tx, b, mapping, now);
    await persistValidation(tx, id, v);
    const rowIds = new Map(rows(await tx.execute(sql`SELECT id, row_number FROM academic_import_rows WHERE batch_id = ${id}::uuid`)).map((r) => [Number(r.row_number), String(r.id)] as const));
    let inserted = 0, superseded = 0, needsReview = 0;
    const perStudent = new Map<string, { reported: number; review: number }>();
    for (const [rowNumber, x] of v.perRow) {
      if (x.outcome === "invalid" || !x.normalized || !x.studentId || !x.identity || !x.fingerprint) continue;
      if (x.diff !== "new" && x.diff !== "changed") continue;
      if (x.diff === "changed" && x.previousId) {
        superseded += rows(await tx.execute(sql`UPDATE academic_reported_records SET status = 'superseded', updated_at = now() WHERE id = ${x.previousId}::uuid AND status = 'active' RETURNING id`)).length;
      }
      const n = x.normalized;
      const out = rows(await tx.execute(sql`INSERT INTO academic_reported_records (student_id, batch_id, row_id, tier, provider_label, course_key, course_label, task_label, progress_status,
          percent_complete, score_percent, credits_reported, reported_on, identity_key, fingerprint, review_state, supersedes_id)
        VALUES (${x.studentId}, ${id}::uuid, ${rowIds.get(rowNumber) ?? null}::uuid, ${tier}, ${str(b.provider_label)}, ${n.courseKey}, ${n.course!}, ${n.task}, ${n.progressStatus},
          ${n.percentComplete}, ${n.scorePercent}, ${n.creditsReported}, ${n.reportedOn}::date, ${x.identity}, ${x.fingerprint}, ${x.needsReview ? "needs_review" : "none"}, ${x.previousId}::uuid)
        ON CONFLICT (student_id, identity_key) WHERE status = 'active' DO NOTHING RETURNING id`));
      if (!out.length) continue;
      inserted += 1;
      if (x.needsReview) needsReview += 1;
      const s = perStudent.get(x.studentId) ?? { reported: 0, review: 0 };
      s.reported += 1;
      if (x.needsReview) s.review += 1;
      perStudent.set(x.studentId, s);
    }
    const counts = { ...v.counts, committed: inserted, needsReview };
    await clearRaw(tx, id);
    await tx.execute(sql`UPDATE academic_import_batches SET status = 'committed', counts = ${JSON.stringify(counts)}::jsonb, committed_by = ${actorId}, committed_at = now(), updated_at = now() WHERE id = ${id}::uuid`);
    const events: ImportOpsEvent[] = [];
    for (const [studentId, s] of perStudent) {
      events.push({ kind: "academic.progress_reported", studentId, batchId: id, data: { records: s.reported, tier }, actorId, dedupeKey: `import:${id}:progress:${studentId}` });
      if (s.review) events.push({ kind: "academic.review_required", studentId, batchId: id, data: { records: s.review, tier }, actorId, dedupeKey: `import:${id}:review:${studentId}` });
    }
    events.push({ kind: "academic.import_committed", studentId: null, batchId: id, data: { inserted, superseded, needsReview, students: perStudent.size, tier }, actorId, dedupeKey: `import:${id}:committed` });
    return { inserted, superseded, needsReview, students: [...perStudent.keys()], events };
  });
  // Operational layer (S29) after the transaction committed: events, then in-app owner notifications.
  await publish(db, result.events, [
    { kind: "import.committed", records: result.inserted, students: result.students.length, key: `import:${id}:committed` },
    ...(result.needsReview ? [{ kind: "import.review_required" as const, records: result.needsReview, students: result.students.length, key: `import:${id}:review` }] : []),
  ], id, now);
  return { inserted: result.inserted, superseded: result.superseded, needsReview: result.needsReview, students: result.students };
}


export async function rollbackBatch(db: TxDb, id: string, reason: string, actorId: string, now: Date = new Date()): Promise<{ withdrawn: number; restored: number }> {
  const out = await db.transaction(async (tx) => {
    await lockImports(tx);
    const b = await loadBatch(tx, id, true);
    requireStatus(b, ["committed"], "roll back");
    // Rollbacks must go newest-first: if a later import replaced some of this import's records, rolling this one
    // back now would leave the later import's restore pointing at withdrawn data (and could resurrect it later).
    const newer = rows(await tx.execute(sql`SELECT DISTINCT n.batch_id FROM academic_reported_records r JOIN academic_reported_records n ON n.supersedes_id = r.id
      WHERE r.batch_id = ${id}::uuid AND r.status = 'superseded' AND n.status IN ('active', 'superseded') ORDER BY n.batch_id LIMIT 5`)).map((r) => String(r.batch_id));
    if (newer.length) throw new S30Error(E.INVALID_TRANSITION, 409, `A newer import replaced some of these records; roll back the newer import first (${newer.join(", ")})`);
    const mine = rows(await tx.execute(sql`UPDATE academic_reported_records SET status = 'rolled_back', updated_at = now() WHERE batch_id = ${id}::uuid AND status = 'active' RETURNING id, supersedes_id`));
    let restored = 0;
    for (const r of mine) {
      if (!r.supersedes_id) continue;
      const out = rows(await tx.execute(sql`UPDATE academic_reported_records p SET status = 'active', updated_at = now()
        WHERE p.id = ${String(r.supersedes_id)}::uuid AND p.status = 'superseded'
          AND NOT EXISTS (SELECT 1 FROM academic_reported_records q WHERE q.student_id = p.student_id AND q.identity_key = p.identity_key AND q.status = 'active') RETURNING p.id`));
      restored += out.length;
    }
    await clearRaw(tx, id);
    const counts = { ...((b.counts as object) ?? {}), rolledBack: mine.length };
    await tx.execute(sql`UPDATE academic_import_batches SET status = 'rolled_back', counts = ${JSON.stringify(counts)}::jsonb, rolled_back_by = ${actorId}, rolled_back_at = now(), rollback_reason = ${reason}, updated_at = now() WHERE id = ${id}::uuid`);
    const [st] = rows(await tx.execute(sql`SELECT count(DISTINCT student_id)::int AS n FROM academic_reported_records WHERE batch_id = ${id}::uuid`));
    return { withdrawn: mine.length, restored, students: Number(st?.n ?? 0) };
  });
  await publish(db, [{ kind: "academic.import_rolled_back", studentId: null, batchId: id, data: { withdrawn: out.withdrawn, restored: out.restored }, actorId, dedupeKey: `import:${id}:rolled_back` }],
    [{ kind: "import.rolled_back", records: out.withdrawn, students: out.students, key: `import:${id}:rolled_back` }], id, now);
  return { withdrawn: out.withdrawn, restored: out.restored };
}

/** Hands events and owner notifications to the S29 layer. A port failure never undoes the committed import. */
async function publish(db: SqlExecutor, events: readonly ImportOpsEvent[], notes: ReadonlyArray<{ kind: "import.committed" | "import.review_required" | "import.rolled_back"; records: number; students: number; key: string }>, batchId: string, now: Date): Promise<void> {
  const port = importOperationsPort();
  for (const e of events) await port.recordEvent(e).catch(() => "failed");
  if (!notes.length) return;
  const admins = rows(await db.execute(sql`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 20`)).map((r) => String(r.id));
  for (const n of notes) for (const a of admins) {
    await port.enqueueNotification({ recipientUserId: a, kind: n.kind, params: { date: now.toISOString(), records: n.records, students: n.students }, href: `/admin/imports?batch=${encodeURIComponent(batchId)}`, dedupeKey: n.key }).catch(() => "failed");
  }
}

/** For S29's exception queue: students with active imported records awaiting staff review (pull model). */
export async function importReviewSummary(db: SqlExecutor): Promise<Array<{ studentId: string; tier: "provider_reported" | "institution_reported"; count: number }>> {
  try {
    return rows(await db.execute(sql`SELECT student_id, tier, count(*)::int AS n FROM academic_reported_records WHERE status = 'active' AND review_state = 'needs_review'
      GROUP BY student_id, tier ORDER BY student_id, tier LIMIT 2000`)).map((r) => ({ studentId: String(r.student_id), tier: r.tier as "provider_reported" | "institution_reported", count: Number(r.n) }));
  } catch (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
}

export async function discardBatch(db: TxDb, id: string, actorId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const b = await loadBatch(tx, id, true);
    requireStatus(b, ["uploaded", "validated", "approved"], "discard");
    await clearRaw(tx, id);
    await tx.execute(sql`UPDATE academic_import_batches SET status = 'discarded', updated_at = now() WHERE id = ${id}::uuid`);
    void actorId;
  });
}

// ── reads ────────────────────────────────────────────────────────────────────

export async function listBatches(db: SqlExecutor, limit = 50): Promise<ImportBatchView[]> {
  const list = rows(await db.execute(sql`SELECT * FROM academic_import_batches ORDER BY uploaded_at DESC, id LIMIT ${Math.min(Math.max(limit, 1), 200)}`));
  return list.map((r) => toBatchView(r));
}

export async function getBatch(db: SqlExecutor, id: string): Promise<ImportBatchDetail> {
  const b = await loadBatch(db, id);
  const list = rows(await db.execute(sql`SELECT r.row_number, r.raw, r.normalized, r.student_id, r.outcome, r.diff, r.issues, s.first_name, s.last_name
      FROM academic_import_rows r LEFT JOIN students s ON s.id = r.student_id WHERE r.batch_id = ${id}::uuid ORDER BY r.row_number LIMIT 2001`));
  const truncated = list.length > 2000;
  const rowsOut: ImportRowView[] = list.slice(0, 2000).map((r) => {
    const n = (r.normalized as (ImportNormalizedRow & { previous?: Partial<ImportNormalizedRow> | null }) | null) ?? null;
    const { previous = null, ...normalized } = n ?? ({} as ImportNormalizedRow & { previous?: null });
    return {
      rowNumber: Number(r.row_number), raw: (r.raw as Record<string, string>) ?? {}, normalized: n ? (normalized as ImportNormalizedRow) : null,
      studentId: str(r.student_id), studentName: r.student_id ? `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() : null,
      outcome: r.outcome as ImportRowView["outcome"], diff: (r.diff as ImportRowView["diff"]) ?? null, issues: (r.issues as ImportIssue[]) ?? [], previous: previous ?? null,
    };
  });
  return { ...toBatchView(b, await duplicateOf(db, b)), rows: rowsOut, rowsTruncated: truncated };
}

export async function listMappings(db: SqlExecutor): Promise<ImportMappingView[]> {
  return rows(await db.execute(sql`SELECT id, name, source_kind, columns, updated_at FROM academic_import_mappings ORDER BY name LIMIT 200`))
    .map((r) => ({ id: String(r.id), name: String(r.name), sourceKind: r.source_kind as ImportSourceKind, columns: r.columns as ImportColumnMapping, updatedAt: iso(r.updated_at) }));
}

export async function listReportedRecords(db: SqlExecutor, studentId: string): Promise<ReportedRecordView[]> {
  return rows(await db.execute(sql`SELECT id, student_id, tier, provider_label, course_key, course_label, task_label, progress_status, percent_complete, score_percent, credits_reported,
      reported_on::text AS reported_on, review_state, batch_id, created_at FROM academic_reported_records WHERE student_id = ${studentId} AND status = 'active' ORDER BY created_at DESC, id LIMIT 500`))
    .map((r) => ({
      id: String(r.id), studentId: String(r.student_id), tier: r.tier as ReportedRecordView["tier"], providerLabel: str(r.provider_label), courseKey: str(r.course_key), courseLabel: String(r.course_label),
      taskLabel: str(r.task_label), progressStatus: (r.progress_status as ReportedRecordView["progressStatus"]) ?? null, percentComplete: r.percent_complete === null ? null : Number(r.percent_complete),
      scorePercent: r.score_percent === null ? null : Number(r.score_percent), creditsReported: r.credits_reported === null ? null : Number(r.credits_reported), reportedOn: str(r.reported_on),
      reviewState: r.review_state as ReportedRecordView["reviewState"], batchId: String(r.batch_id), createdAt: iso(r.created_at),
    }));
}

/** Marks a reported record reviewed (or back to needs_review). This NEVER records an official result or credit. */
export async function setReviewState(db: SqlExecutor, studentId: string, id: string, state: "reviewed" | "needs_review", actorId: string): Promise<boolean> {
  const out = rows(await db.execute(sql`UPDATE academic_reported_records SET review_state = ${state}, reviewed_by = ${actorId}, reviewed_at = now(), updated_at = now()
    WHERE id = ${id}::uuid AND student_id = ${studentId} AND status = 'active' AND review_state <> 'none' RETURNING id`));
  return out.length > 0;
}
