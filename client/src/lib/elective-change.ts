/**
 * Student-initiated elective change request (S26). Pure helpers: the request
 * is an ordinary support ticket; nothing here edits a roadmap.
 */
export const ELECTIVE_SUBJECT_PREFIX = "Elective change request:";
export const ELECTIVE_ALTERNATE_MAX = 120;
export const ELECTIVE_REASON_MAX = 600;
export const ELECTIVE_STATUS_LINE =
  "Status: REQUESTED — awaiting Lumière review, then school approval. The roadmap changes only after approval (new roadmap version).";

const PENDING_MARKERS = /TEST ONLY|APPROVAL PENDING|PROPOSED/i;
const SUFFIX = /\s*\((?:confirmed per enrollment|to be confirmed)\)\s*$/i;

/** True when the course title says the school has not approved it yet. Otherwise we make no claim. */
export function electiveAwaitsApproval(title: string): boolean {
  return PENDING_MARKERS.test(title);
}

/** Short, human title: placeholder suffixes and approval markers removed. */
export function electiveShortTitle(title: string): string {
  const cleaned = title
    .replace(SUFFIX, "")
    .replace(/\s*[\[(—–-]*\s*(?:TEST ONLY|APPROVAL PENDING|PROPOSED)\s*[\])]*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || title.trim();
}

export interface ElectiveChangeInput {
  readonly courseKey: string;
  readonly courseTitle: string;
  readonly alternate: string;
  readonly reason: string;
}

export function electiveChangeValid(i: { alternate: string; reason: string }): boolean {
  const a = i.alternate.trim().length;
  const r = i.reason.trim().length;
  return a > 0 && a <= ELECTIVE_ALTERNATE_MAX && r > 0 && r <= ELECTIVE_REASON_MAX;
}

export function buildElectiveChangeTicket(i: ElectiveChangeInput): { subject: string; description: string } {
  const alternate = i.alternate.trim();
  const subject = `${ELECTIVE_SUBJECT_PREFIX} ${electiveShortTitle(i.courseTitle)} → ${alternate}`.slice(0, 200);
  const description = [
    `Current course: ${i.courseTitle.trim()} (key: ${i.courseKey})`,
    `Preferred alternate: ${alternate}`,
    `Reason: ${i.reason.trim()}`,
    "",
    ELECTIVE_STATUS_LINE,
  ].join("\n");
  return { subject, description };
}

export const isElectiveChangeSubject = (subject: string): boolean => subject.startsWith(ELECTIVE_SUBJECT_PREFIX);
