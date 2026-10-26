/**
 * S09 student profile data access (Drizzle): identity corrections, contact
 * authority and the read-only document/status queries behind the profile view.
 * Never touches credit, roadmap, program-assignment or billing tables.
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '../lib/db';
import {
  studentsTable,
  studentContactsTable,
  studentIdentityCorrectionsTable,
  type StudentIdentityCorrectionRow,
  type StudentContactsTableSelect,
} from '@shared/schema';
import {
  IDENTITY_CORRECTION_FIELDS,
  type CorrectionStatus,
  type IdentityCorrectionChanges,
  type ContactAuthorityStatus,
} from '@shared/student-profile-contract';

export class CorrectionNotPendingError extends Error {
  readonly code = 'CORRECTION_NOT_PENDING';
  constructor() {
    super('This correction request is no longer pending');
    this.name = 'CorrectionNotPendingError';
  }
}

export class CorrectionAlreadyPendingError extends Error {
  readonly code = 'CORRECTION_ALREADY_PENDING';
  constructor() {
    super('A correction request is already pending for this student');
    this.name = 'CorrectionAlreadyPendingError';
  }
}

function pgErrorCode(error: unknown): string | undefined {
  const e = error as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === 'string' ? code : undefined;
}

export function pickIdentity(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of IDENTITY_CORRECTION_FIELDS) out[f] = row[f] ?? null;
  return out;
}

export async function createCorrection(input: {
  studentId: string;
  requestedBy: string;
  requestedChanges: IdentityCorrectionChanges;
  currentSnapshot: Record<string, unknown>;
  reason: string;
  evidenceDocumentId: string | null;
}): Promise<StudentIdentityCorrectionRow> {
  try {
    const [row] = await db
      .insert(studentIdentityCorrectionsTable)
      .values({
        student_id: input.studentId,
        requested_by: input.requestedBy,
        requested_changes: input.requestedChanges,
        current_snapshot: input.currentSnapshot,
        reason: input.reason,
        evidence_document_id: input.evidenceDocumentId,
      })
      .returning();
    return row;
  } catch (error) {
    if (pgErrorCode(error) === '23505') throw new CorrectionAlreadyPendingError();
    throw error;
  }
}

export async function getCorrection(id: string): Promise<StudentIdentityCorrectionRow | null> {
  const rows = await db
    .select()
    .from(studentIdentityCorrectionsTable)
    .where(eq(studentIdentityCorrectionsTable.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getPendingCorrection(studentId: string): Promise<StudentIdentityCorrectionRow | null> {
  const rows = await db
    .select()
    .from(studentIdentityCorrectionsTable)
    .where(and(
      eq(studentIdentityCorrectionsTable.student_id, studentId),
      eq(studentIdentityCorrectionsTable.status, 'pending'),
    ))
    .limit(1);
  return rows[0] ?? null;
}

export async function listCorrectionsForStudent(studentId: string): Promise<StudentIdentityCorrectionRow[]> {
  return db
    .select()
    .from(studentIdentityCorrectionsTable)
    .where(eq(studentIdentityCorrectionsTable.student_id, studentId))
    .orderBy(desc(studentIdentityCorrectionsTable.created_at));
}

export interface CorrectionQueueRow extends StudentIdentityCorrectionRow {
  student_name: string;
  student_code: string;
}

export async function listCorrectionQueue(status: CorrectionStatus | null): Promise<CorrectionQueueRow[]> {
  const rows = await db
    .select({
      correction: studentIdentityCorrectionsTable,
      first: studentsTable.first_name,
      last: studentsTable.last_name,
      code: studentsTable.student_code,
    })
    .from(studentIdentityCorrectionsTable)
    .innerJoin(studentsTable, eq(studentsTable.id, studentIdentityCorrectionsTable.student_id))
    .where(status ? eq(studentIdentityCorrectionsTable.status, status) : undefined)
    .orderBy(asc(studentIdentityCorrectionsTable.created_at));
  return rows.map((r) => ({
    ...r.correction,
    student_name: `${r.first} ${r.last}`.trim(),
    student_code: r.code,
  }));
}

/** Student withdraws their own pending request. Conditional on status. */
export async function withdrawCorrection(id: string, studentId: string): Promise<StudentIdentityCorrectionRow> {
  const rows = await db
    .update(studentIdentityCorrectionsTable)
    .set({ status: 'withdrawn', updated_at: new Date() })
    .where(and(
      eq(studentIdentityCorrectionsTable.id, id),
      eq(studentIdentityCorrectionsTable.student_id, studentId),
      eq(studentIdentityCorrectionsTable.status, 'pending'),
    ))
    .returning();
  if (rows.length === 0) throw new CorrectionNotPendingError();
  return rows[0];
}

export async function rejectCorrection(
  id: string,
  reviewerUserId: string,
  note: string,
): Promise<StudentIdentityCorrectionRow> {
  const rows = await db
    .update(studentIdentityCorrectionsTable)
    .set({
      status: 'rejected',
      reviewer_user_id: reviewerUserId,
      reviewed_at: new Date(),
      review_note: note,
      updated_at: new Date(),
    })
    .where(and(eq(studentIdentityCorrectionsTable.id, id), eq(studentIdentityCorrectionsTable.status, 'pending')))
    .returning();
  if (rows.length === 0) throw new CorrectionNotPendingError();
  return rows[0];
}

/**
 * Approve: claim the pending row (conditional UPDATE) and apply the requested
 * values to the students row in ONE transaction. Only identity columns are
 * ever written; documents, credit, roadmap and billing are not touched.
 */
export async function approveCorrection(
  id: string,
  reviewerUserId: string,
  note: string | null,
): Promise<{ correction: StudentIdentityCorrectionRow; previous: Record<string, unknown> }> {
  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(studentIdentityCorrectionsTable)
      .set({
        status: 'approved',
        reviewer_user_id: reviewerUserId,
        reviewed_at: new Date(),
        review_note: note,
        updated_at: new Date(),
      })
      .where(and(eq(studentIdentityCorrectionsTable.id, id), eq(studentIdentityCorrectionsTable.status, 'pending')))
      .returning();
    if (claimed.length === 0) throw new CorrectionNotPendingError();
    const row = claimed[0];

    await tx.execute(sql`SELECT id FROM students WHERE id = ${row.student_id} FOR UPDATE`);
    const current = await tx.select().from(studentsTable).where(eq(studentsTable.id, row.student_id)).limit(1);
    if (current.length === 0) throw new Error('Student not found for correction');

    const requested = row.requested_changes as Record<string, unknown>;
    const allowed = new Set<string>(IDENTITY_CORRECTION_FIELDS);
    const updates: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(requested)) {
      if (allowed.has(k)) updates[k] = v;
    }
    const previous: Record<string, unknown> = {};
    for (const k of Object.keys(updates)) previous[k] = (current[0] as Record<string, unknown>)[k] ?? null;

    await tx
      .update(studentsTable)
      .set({ ...updates, updated_at: new Date() } as Partial<typeof studentsTable.$inferInsert>)
      .where(eq(studentsTable.id, row.student_id));
    const [final] = await tx
      .update(studentIdentityCorrectionsTable)
      .set({ applied_previous: previous })
      .where(eq(studentIdentityCorrectionsTable.id, id))
      .returning();
    return { correction: final, previous };
  });
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export async function getContactById(contactId: string): Promise<StudentContactsTableSelect | null> {
  const rows = await db
    .select()
    .from(studentContactsTable)
    .where(eq(studentContactsTable.id, contactId))
    .limit(1);
  return rows[0] ?? null;
}

export async function setContactAuthority(
  contactId: string,
  status: ContactAuthorityStatus,
  reviewerUserId: string | null,
  note: string | null,
): Promise<StudentContactsTableSelect> {
  const verified = status === 'verified';
  const rows = await db
    .update(studentContactsTable)
    .set({
      authority_status: status,
      authority_verified_by: verified ? reviewerUserId : null,
      authority_verified_at: verified ? new Date() : null,
      authority_note: note,
    })
    .where(eq(studentContactsTable.id, contactId))
    .returning();
  if (rows.length === 0) throw new Error('Contact not found');
  return rows[0];
}

// ---------------------------------------------------------------------------
// Read-only document status (existing student_documents verification workflow)
// ---------------------------------------------------------------------------

export interface DocumentStatusRow {
  id: string;
  doc_type: string;
  status: string;
  required_for_enrollment: boolean;
  updated_at: string | null;
}

export async function listDocumentStatuses(studentId: string): Promise<DocumentStatusRow[]> {
  const rows = await db.execute(sql`
    SELECT id::text AS id, doc_type::text AS doc_type, status::text AS status,
           required_for_enrollment, updated_at
    FROM student_documents
    WHERE student_id = ${studentId} AND soft_deleted = false
    ORDER BY uploaded_at DESC, created_at DESC`);
  return (Array.from(rows as unknown as Array<Record<string, unknown>>)).map((r) => ({
    id: String(r.id),
    doc_type: String(r.doc_type),
    status: String(r.status),
    required_for_enrollment: Boolean(r.required_for_enrollment),
    updated_at: r.updated_at ? new Date(r.updated_at as string | Date).toISOString() : null,
  }));
}

export async function studentOwnsDocument(studentId: string, documentId: string): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT 1 AS ok FROM student_documents
    WHERE id = ${documentId} AND student_id = ${studentId} AND soft_deleted = false LIMIT 1`);
  return Array.from(rows as unknown as unknown[]).length > 0;
}
