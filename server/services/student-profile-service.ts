/**
 * S09 student profile service.
 *
 * Field-ownership partitioning, the StudentProfileView read model, the
 * identity-correction workflow and contact authority. Implements
 * shared/student-profile-contract.ts. Reads academic data only; never writes
 * credit, roadmap, program-assignment or billing tables.
 */
import {
  type StudentContact,
  type Student,
  type StudentIdentityCorrectionRow,
} from '@shared/schema';
import {
  IDENTITY_CORRECTION_FIELDS,
  LOGIN_EMAIL_FIELD,
  PREFERRED_CONTACT_CHANNELS,
  PROFILE_ERROR_CODES,
  STUDENT_EDITABLE_PROFILE_FIELDS,
  contactRequestsAuthority,
  effectiveContactScopes,
  identityCorrectionChangesSchema,
  maskIdentifier,
  CONTACT_SCOPES,
  type ContactAuthorityStatus,
  type ContactScope,
  type ContactType,
  type CreateIdentityCorrection,
  type EvidenceStatus,
  type IdentityCorrectionField,
  type IdentityCorrectionRequestView,
  type PreferredContactChannel,
  type ProfileEvidenceItem,
  type ProfileReadinessItem,
  type ResolveContactAuthority,
  type ResolveIdentityCorrection,
  type StudentContactInput,
  type StudentContactView,
  type StudentProfileView,
  type CorrectionStatus,
} from '@shared/student-profile-contract';
import { logger } from '../lib/logger';
import { writeAuditLog } from '../lib/audit';
import { resolvePhotoUrl } from '../lib/profile-photo';
import * as studentService from './student-service';
import * as profileRepo from '../repositories/student-profile-repo';
import {
  authorityStatusOf,
  buildStudentProfileView,
  priorCredentialsFromSources,
  toContactView,
  type ProfileViewInputs,
} from './student-profile-read-model';

export { buildStudentProfileView, toContactView, type ProfileViewInputs };
import { CorrectionAlreadyPendingError, CorrectionNotPendingError } from '../repositories/student-profile-repo';

export class ProfileHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ProfileHttpError';
  }
}

// ---------------------------------------------------------------------------
// Masking
// ---------------------------------------------------------------------------

/** Replace the raw government id with null + a masked display value. */
export function maskStudentRecord<T extends object>(student: T): T & {
  gov_id_number: null;
  gov_id_number_masked: string | null;
} {
  const raw = (student as Record<string, unknown>).gov_id_number;
  return {
    ...student,
    gov_id_number: null,
    gov_id_number_masked: maskIdentifier(typeof raw === 'string' ? raw : null),
  };
}

// ---------------------------------------------------------------------------
// Field ownership
// ---------------------------------------------------------------------------

/**
 * Every column of `students` a client could name. Kept static (and asserted
 * equal to studentSchema's keys in tests/s09-profile-security.test.ts) so this
 * module has no load-time dependency on the schema value.
 */
export const KNOWN_STUDENT_FIELDS: ReadonlySet<string> = new Set([
  'id', 'user_id', 'student_code', 'status',
  'first_name', 'middle_name', 'last_name', 'preferred_name', 'dob', 'sex', 'nationality',
  'gov_id_type', 'gov_id_number', 'photo_url',
  'residency', 'hs_completion', 'hs_path', 'hs_country', 'hs_school', 'hs_year', 'hs_doc_url',
  'email', 'email_verified_at', 'phone_primary', 'phone_secondary', 'whatsapp_primary', 'timezone',
  'preferred_contact_channel',
  'address_country', 'address_state', 'address_city', 'address_postal', 'address_line1', 'address_line2',
  'target_degree', 'target_major', 'start_term', 'prior_credits', 'prior_credits_est', 'prior_sources',
  'transcripts_url', 'target_pace',
  'marketing_opt_in', 'media_release', 'consent_signed_at', 'consent_signature',
  'created_at', 'updated_at',
]);
const EDITABLE: ReadonlySet<string> = new Set(STUDENT_EDITABLE_PROFILE_FIELDS);
const IDENTITY: ReadonlySet<string> = new Set(IDENTITY_CORRECTION_FIELDS);

function normalizeComparable(key: string, value: unknown): unknown {
  if (value === '' || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (key === 'dob') return trimmed.slice(0, 10);
    if (key === LOGIN_EMAIL_FIELD) return trimmed.toLowerCase();
    return trimmed === '' ? null : trimmed;
  }
  return value;
}

/** Whether a submitted value equals the stored one (forms resubmit whole sections). */
export function sameStoredValue(key: string, submitted: unknown, stored: unknown): boolean {
  return JSON.stringify(normalizeComparable(key, submitted)) === JSON.stringify(normalizeComparable(key, stored));
}

/** The profile never returns the raw id, so null / a masked value means "not supplied". */
export function isUnsuppliedGovId(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && (value === '' || value.startsWith('•')));
}

export interface StudentUpdatePartition {
  /** Student-editable fields supplied by the caller. */
  allowed: Record<string, unknown>;
  /** Identity fields whose submitted value differs from the stored one. */
  identityFields: string[];
  /** The login email was submitted with a different value. */
  emailChanged: boolean;
  /** Other protected fields whose submitted value differs from the stored one. */
  staffControlled: string[];
  /** Keys that are not student columns at all. */
  unknown: string[];
}

/**
 * Split a student-initiated update by ownership. A protected field is
 * tolerated only when it equals the stored value; a differing identity value
 * is never accepted here (it needs a correction request).
 */
export function partitionStudentProfileUpdate(
  updates: Record<string, unknown>,
  stored: Record<string, unknown>,
): StudentUpdatePartition {
  const result: StudentUpdatePartition = {
    allowed: {},
    identityFields: [],
    emailChanged: false,
    staffControlled: [],
    unknown: [],
  };
  for (const [key, value] of Object.entries(updates)) {
    if (!KNOWN_STUDENT_FIELDS.has(key)) {
      result.unknown.push(key);
    } else if (EDITABLE.has(key)) {
      result.allowed[key] = value;
    } else if (key === LOGIN_EMAIL_FIELD) {
      if (!sameStoredValue(key, value, stored[key])) result.emailChanged = true;
    } else if (key === 'gov_id_number' && isUnsuppliedGovId(value)) {
      continue;
    } else if (!sameStoredValue(key, value, stored[key])) {
      if (IDENTITY.has(key)) result.identityFields.push(key);
      else result.staffControlled.push(key);
    }
  }
  return result;
}

export interface StaffUpdatePreparation {
  /** Body with the email / unsupplied-gov-id noise removed, ready for the staff schema. */
  body: Record<string, unknown>;
  emailChanged: boolean;
}

export function prepareStaffProfileUpdate(
  updates: Record<string, unknown>,
  stored: Record<string, unknown>,
): StaffUpdatePreparation {
  const body: Record<string, unknown> = {};
  let emailChanged = false;
  for (const [key, value] of Object.entries(updates)) {
    if (key === LOGIN_EMAIL_FIELD) {
      if (!sameStoredValue(key, value, stored[key])) emailChanged = true;
    } else if (key === 'gov_id_number' && isUnsuppliedGovId(value)) {
      continue;
    } else {
      body[key] = value;
    }
  }
  return { body, emailChanged };
}

export function changedIdentityFields(
  updates: Record<string, unknown>,
  stored: Record<string, unknown>,
): string[] {
  return Object.keys(updates).filter(
    (k) => IDENTITY.has(k) && !sameStoredValue(k, updates[k], stored[k]),
  );
}

/** Throws the 403 for a student's disallowed fields; returns the editable subset otherwise. */
export function assertStudentMayUpdate(
  updates: Record<string, unknown>,
  stored: Record<string, unknown>,
): Record<string, unknown> {
  const p = partitionStudentProfileUpdate(updates, stored);
  if (p.unknown.length > 0) {
    throw new ProfileHttpError(400, 'VALIDATION_FAILED', 'Validation failed', { fields: p.unknown });
  }
  if (p.emailChanged) {
    throw new ProfileHttpError(
      403,
      PROFILE_ERROR_CODES.EMAIL_MANAGED_BY_ACCOUNT,
      'Your email is your login and is changed from account security',
    );
  }
  if (p.identityFields.length > 0) {
    throw new ProfileHttpError(
      403,
      PROFILE_ERROR_CODES.IDENTITY_REQUIRES_CORRECTION,
      'Legal identity changes need a correction request',
      { fields: p.identityFields },
    );
  }
  if (p.staffControlled.length > 0) {
    throw new ProfileHttpError(
      403,
      PROFILE_ERROR_CODES.FIELDS_STAFF_CONTROLLED,
      'These fields can only be changed by staff',
      { fields: p.staffControlled },
    );
  }
  return p.allowed;
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export function initialAuthorityStatus(type: ContactType, scopes: readonly ContactScope[]): ContactAuthorityStatus {
  return contactRequestsAuthority(type, scopes) ? 'pending_verification' : 'listed';
}

export async function listContactViews(studentId: string): Promise<StudentContactView[]> {
  const rows = await studentService.getStudentContacts(studentId);
  return rows.map((r) => toContactView(r as unknown as Record<string, unknown>));
}

export async function createContact(
  studentId: string,
  input: StudentContactInput,
  actorId: string,
): Promise<StudentContactView> {
  const created = await studentService.addStudentContact(
    studentId,
    {
      type: input.type,
      full_name: input.full_name,
      relationship: input.relationship,
      phone: input.phone,
      email: input.email,
      language: input.language,
      scopes: input.scopes,
      consent_doc_url: null,
      authority_status: initialAuthorityStatus(input.type, input.scopes),
    },
    actorId,
  );
  return toContactView(created as unknown as Record<string, unknown>);
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

export async function updateContact(
  stored: StudentContact,
  input: Partial<StudentContactInput>,
  actorId: string,
  staff: boolean,
): Promise<StudentContactView> {
  const status = authorityStatusOf(stored.authority_status);
  const storedScopes = Array.isArray(stored.scopes) ? (stored.scopes as string[]) : [];
  const typeChanged = input.type !== undefined && input.type !== stored.type;
  const nameChanged = input.full_name !== undefined && input.full_name !== stored.full_name;
  const scopesChanged = input.scopes !== undefined && !sameSet(input.scopes, storedScopes);

  if (!staff && status === 'verified' && (typeChanged || nameChanged || scopesChanged)) {
    throw new ProfileHttpError(
      403,
      PROFILE_ERROR_CODES.CONTACT_AUTHORITY_STAFF_MANAGED,
      'A verified contact can only be changed by staff, apart from phone, email and language',
    );
  }

  const updates: Record<string, unknown> = { ...input };
  const newScopes = (input.scopes ?? storedScopes) as ContactScope[];
  const newType = (input.type ?? stored.type) as ContactType;
  let authorityAudit: { action: string; from: ContactAuthorityStatus; to: ContactAuthorityStatus } | null = null;

  if (status === 'verified') {
    // Fail-closed S10 rule. Verified authority was granted for ONE person, ONE type and ONE scope set.
    // Any staff edit that changes the person's name, the contact type, or ADDS/changes a scope
    // (anything other than a pure subset of the verified scopes) invalidates it: back to
    // pending_verification, verifier cleared, until staff explicitly re-verify.
    // A pure narrowing (same name, same type, every new scope already verified) cannot grant
    // anything new, so the remaining subset stays verified and effectiveScopes shrinks with it.
    const narrowOnly = !typeChanged && !nameChanged && scopesChanged && newScopes.every((s) => storedScopes.includes(s));
    if ((typeChanged || nameChanged || scopesChanged) && !narrowOnly) {
      updates.authority_status = 'pending_verification';
      updates.authority_verified_by = null;
      updates.authority_verified_at = null;
      updates.authority_note = null;
      authorityAudit = { action: 'authority_reset', from: status, to: 'pending_verification' };
    } else if (narrowOnly) {
      authorityAudit = { action: 'authority_narrowed', from: status, to: status };
    }
  } else if (status !== 'revoked' && (typeChanged || scopesChanged)) {
    // listed / pending_verification: recompute from what is now requested.
    updates.authority_status = initialAuthorityStatus(newType, newScopes);
    updates.authority_verified_by = null;
    updates.authority_verified_at = null;
  }
  // revoked stays revoked: only an explicit staff decision (resolveContactAuthority) can re-verify.

  const updated = await studentService.updateStudentContact(stored.id, updates as never, actorId);
  if (authorityAudit) {
    writeAuditLog({
      studentId: stored.student_id,
      actorId,
      action: authorityAudit.action,
      entityType: 'contact',
      entityId: stored.id,
      oldValue: { authority_status: authorityAudit.from, scopes: storedScopes, type: stored.type },
      newValue: { authority_status: authorityAudit.to, scopes: newScopes, type: newType },
      metadata: { changed: [typeChanged && 'type', nameChanged && 'name', scopesChanged && 'scopes'].filter(Boolean) },
    }).catch((err) => logger.warn('Audit log failed', { err }));
  }
  return toContactView(updated as unknown as Record<string, unknown>);
}

export async function assertContactDeletable(stored: StudentContact, staff: boolean): Promise<void> {
  if (!staff && authorityStatusOf(stored.authority_status) === 'verified') {
    throw new ProfileHttpError(
      403,
      PROFILE_ERROR_CODES.CONTACT_AUTHORITY_STAFF_MANAGED,
      'A verified contact can only be removed by staff',
    );
  }
}

export async function resolveContactAuthority(
  contactId: string,
  input: ResolveContactAuthority,
  staffUserId: string,
): Promise<StudentContactView> {
  const before = await profileRepo.getContactById(contactId);
  if (!before) throw new ProfileHttpError(404, 'CONTACT_NOT_FOUND', 'Contact not found');
  const next: ContactAuthorityStatus = input.decision === 'verify' ? 'verified' : 'revoked';
  const row = await profileRepo.setContactAuthority(contactId, next, staffUserId, input.note);
  writeAuditLog({
    studentId: before.student_id,
    actorId: staffUserId,
    action: `authority_${input.decision}`,
    entityType: 'contact',
    entityId: contactId,
    oldValue: { authority_status: before.authority_status },
    newValue: { authority_status: next },
    metadata: { note: input.note, scopes: before.scopes, type: before.type },
  }).catch((err) => logger.warn('Audit log failed', { err }));
  return toContactView(row as unknown as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Identity corrections
// ---------------------------------------------------------------------------

function display(field: string, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (field === 'gov_id_number') return maskIdentifier(String(value));
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function displayMap(
  fields: readonly string[],
  source: Record<string, unknown>,
  alreadyMasked: boolean,
): Partial<Record<IdentityCorrectionField, string | null>> {
  const out: Partial<Record<IdentityCorrectionField, string | null>> = {};
  for (const f of fields) {
    const v = source[f];
    out[f as IdentityCorrectionField] =
      f === 'gov_id_number' && alreadyMasked ? (typeof v === 'string' ? v : null) : display(f, v);
  }
  return out;
}

export function toCorrectionView(row: StudentIdentityCorrectionRow, staff: boolean): IdentityCorrectionRequestView {
  const requested = (row.requested_changes ?? {}) as Record<string, unknown>;
  const snapshot = (row.current_snapshot ?? {}) as Record<string, unknown>;
  const fields = Object.keys(requested).filter((k) => IDENTITY.has(k)) as IdentityCorrectionField[];
  return {
    id: row.id,
    studentId: row.student_id,
    status: row.status as CorrectionStatus,
    fields,
    // The snapshot stores gov_id_number already masked.
    currentDisplay: displayMap(fields, snapshot, true),
    requestedDisplay: displayMap(fields, requested, false),
    reason: row.reason,
    evidenceDocumentId: row.evidence_document_id ?? null,
    createdAt: row.created_at.toISOString(),
    reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    reviewNote: row.review_note ?? null,
    reviewerUserId: staff ? row.reviewer_user_id ?? null : null,
  };
}

export async function createIdentityCorrection(
  student: Student,
  actorUserId: string,
  input: CreateIdentityCorrection,
): Promise<IdentityCorrectionRequestView> {
  const stored = student as unknown as Record<string, unknown>;
  const changed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input.changes)) {
    if (!sameStoredValue(k, v, stored[k])) changed[k] = v;
  }
  if (Object.keys(changed).length === 0) {
    throw new ProfileHttpError(
      422,
      PROFILE_ERROR_CODES.CORRECTION_NO_CHANGE,
      'The requested values are the same as what is on record',
    );
  }

  const evidenceId = input.evidence_document_id ?? null;
  if (evidenceId) {
    let owned = false;
    try {
      owned = await profileRepo.studentOwnsDocument(student.id, evidenceId);
    } catch (error) {
      logger.warn('Evidence ownership lookup failed', { studentId: student.id, error });
    }
    if (!owned) {
      throw new ProfileHttpError(
        403,
        PROFILE_ERROR_CODES.EVIDENCE_NOT_OWNED,
        'The supporting document must be one of your own uploads',
      );
    }
  }

  if (await profileRepo.getPendingCorrection(student.id)) {
    throw alreadyPending();
  }

  const snapshot = profileRepo.pickIdentity(stored);
  snapshot.gov_id_number = maskIdentifier(typeof stored.gov_id_number === 'string' ? stored.gov_id_number : null);

  let row: StudentIdentityCorrectionRow;
  try {
    row = await profileRepo.createCorrection({
      studentId: student.id,
      requestedBy: actorUserId,
      requestedChanges: changed as never,
      currentSnapshot: snapshot,
      reason: input.reason,
      evidenceDocumentId: evidenceId,
    });
  } catch (error) {
    if (error instanceof CorrectionAlreadyPendingError) throw alreadyPending();
    throw error;
  }

  writeAuditLog({
    studentId: student.id,
    actorId: actorUserId,
    action: 'identity_correction_requested',
    entityType: 'identity_correction',
    entityId: row.id,
    newValue: { fields: Object.keys(changed), status: 'pending' },
    metadata: { reason: input.reason, evidence_document_id: evidenceId },
  }).catch((err) => logger.warn('Audit log failed', { err }));

  return toCorrectionView(row, false);
}

function alreadyPending(): ProfileHttpError {
  return new ProfileHttpError(
    409,
    PROFILE_ERROR_CODES.CORRECTION_ALREADY_PENDING,
    'You already have a correction request waiting for review',
  );
}

function notPending(): ProfileHttpError {
  return new ProfileHttpError(
    409,
    PROFILE_ERROR_CODES.CORRECTION_NOT_PENDING,
    'This correction request is no longer pending',
  );
}

export async function listOwnCorrections(studentId: string): Promise<IdentityCorrectionRequestView[]> {
  const rows = await profileRepo.listCorrectionsForStudent(studentId);
  return rows.map((r) => toCorrectionView(r, false));
}

export async function listStudentCorrectionsForStaff(studentId: string): Promise<IdentityCorrectionRequestView[]> {
  const rows = await profileRepo.listCorrectionsForStudent(studentId);
  return rows.map((r) => toCorrectionView(r, true));
}

export type CorrectionQueueItem = IdentityCorrectionRequestView & { studentName: string; studentCode: string };

export async function listCorrectionQueue(status: CorrectionStatus | null): Promise<CorrectionQueueItem[]> {
  const rows = await profileRepo.listCorrectionQueue(status);
  return rows.map((r) => ({
    ...toCorrectionView(r, true),
    studentName: r.student_name,
    studentCode: r.student_code,
  }));
}

export async function withdrawCorrection(
  student: Pick<Student, 'id'>,
  requestId: string,
  actorUserId: string,
): Promise<IdentityCorrectionRequestView> {
  const existing = await profileRepo.getCorrection(requestId);
  if (!existing || existing.student_id !== student.id) {
    throw new ProfileHttpError(404, 'CORRECTION_NOT_FOUND', 'Correction request not found');
  }
  try {
    const row = await profileRepo.withdrawCorrection(requestId, student.id);
    writeAuditLog({
      studentId: student.id,
      actorId: actorUserId,
      action: 'identity_correction_withdrawn',
      entityType: 'identity_correction',
      entityId: requestId,
      oldValue: { status: 'pending' },
      newValue: { status: 'withdrawn' },
    }).catch((err) => logger.warn('Audit log failed', { err }));
    return toCorrectionView(row, false);
  } catch (error) {
    if (error instanceof CorrectionNotPendingError) throw notPending();
    throw error;
  }
}

export async function resolveIdentityCorrection(
  requestId: string,
  input: ResolveIdentityCorrection,
  staffUserId: string,
): Promise<IdentityCorrectionRequestView> {
  const existing = await profileRepo.getCorrection(requestId);
  if (!existing) throw new ProfileHttpError(404, 'CORRECTION_NOT_FOUND', 'Correction request not found');
  if (existing.status !== 'pending') throw notPending();

  try {
    if (input.decision === 'approve') {
      const parsed = identityCorrectionChangesSchema.safeParse(existing.requested_changes);
      if (!parsed.success) {
        throw new ProfileHttpError(422, 'CORRECTION_INVALID', 'The stored request is not valid and cannot be applied');
      }
      const { correction, previous } = await profileRepo.approveCorrection(requestId, staffUserId, input.note ?? null);
      writeAuditLog({
        studentId: correction.student_id,
        actorId: staffUserId,
        action: 'identity_correction_approved',
        entityType: 'student',
        entityId: correction.student_id,
        oldValue: previous,
        newValue: parsed.data,
        metadata: { material_identity_change: true, correction_id: requestId, note: input.note ?? null },
      }).catch((err) => logger.warn('Audit log failed', { err }));
      writeAuditLog({
        studentId: correction.student_id,
        actorId: staffUserId,
        action: 'identity_correction_approved',
        entityType: 'identity_correction',
        entityId: requestId,
        oldValue: { status: 'pending' },
        newValue: { status: 'approved', fields: Object.keys(parsed.data) },
      }).catch((err) => logger.warn('Audit log failed', { err }));
      return toCorrectionView(correction, true);
    }

    const row = await profileRepo.rejectCorrection(requestId, staffUserId, input.note ?? '');
    writeAuditLog({
      studentId: row.student_id,
      actorId: staffUserId,
      action: 'identity_correction_rejected',
      entityType: 'identity_correction',
      entityId: requestId,
      oldValue: { status: 'pending' },
      newValue: { status: 'rejected' },
      metadata: { note: input.note },
    }).catch((err) => logger.warn('Audit log failed', { err }));
    return toCorrectionView(row, true);
  } catch (error) {
    if (error instanceof CorrectionNotPendingError) throw notPending();
    throw error;
  }
}

async function loadPriorCredentials(studentId: string): Promise<ProfileViewInputs['priorCredentials']> {
  try {
    const { studentAcademicService } = await import('./student-academic-service');
    const record = await studentAcademicService.getStudentAcademicRecord(studentId);
    return priorCredentialsFromSources(record.academicSources ?? []);
  } catch (error) {
    logger.warn('Prior credentials unavailable for profile view', { studentId, error });
    return [];
  }
}

async function safe<T>(label: string, studentId: string, fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    logger.warn(`Profile view: ${label} unavailable`, { studentId, error });
    return fallback;
  }
}

/** Loads everything for a student and projects the StudentProfileView. `viewer` decides reviewer visibility. */
export async function loadStudentProfileView(
  student: Student,
  viewer: { role: string },
): Promise<StudentProfileView> {
  const staff = viewer.role === 'admin' || viewer.role === 'staff';
  const [contacts, documents, englishProof, correctionRows, priorCredentials, photo] = await Promise.all([
    listContactViews(student.id),
    safe('documents', student.id, [] as profileRepo.DocumentStatusRow[], () => profileRepo.listDocumentStatuses(student.id)),
    safe('english proof', student.id, null, () => studentService.getEnglishProof(student.id)),
    profileRepo.listCorrectionsForStudent(student.id),
    loadPriorCredentials(student.id),
    resolvePhotoUrl(student.photo_url),
  ]);
  return buildStudentProfileView({
    student,
    contacts,
    documents,
    englishProof,
    corrections: correctionRows.map((r) => toCorrectionView(r, staff)),
    priorCredentials,
    photoUrl: typeof photo === 'string' ? photo : null,
    role: viewer.role,
  });
}
