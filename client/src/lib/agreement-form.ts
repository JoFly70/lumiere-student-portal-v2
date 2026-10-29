/**
 * Agreement editor form model (S27). Pure: converts the server's ProgramAgreementView to editable strings and back
 * to a minimal UpdateAgreementInput (only the parts the person changed), validated with the shared zod schema.
 * The view does not expose the language-test score/target as numbers, only in `detail`, so they are prefilled
 * best-effort from that text; an untouched group is never sent, so a failed parse can never overwrite data.
 */
import {
  updateAgreementSchema,
  type DeadlineStatus,
  type PostSecondaryGoal,
  type ProgramAgreementView,
  type UpdateAgreementInput,
} from "@shared/s27-contract";

export interface TargetForm { name: string; city: string; track: string; program: string; why: string; admission: string; url: string }
export interface GoalForm { field: string; region: string; interests: string; targets: TargetForm[]; alsoReviewed: string; studyOn: string }
export interface AgreementForm {
  signedOn: string; activatedOn: string;
  supportMonths: string; accessMonths: string; languageTestDays: string; priorSchoolingDays: string; sessionsIncluded: string;
  ltStatus: DeadlineStatus; ltDoneOn: string; ltScore: string; ltTarget: string;
  psStatus: DeadlineStatus; psDoneOn: string;
  hasGoal: boolean; goal: GoalForm;
}

export const EMPTY_TARGET: TargetForm = { name: "", city: "", track: "", program: "", why: "", admission: "", url: "" };
export const EMPTY_GOAL: GoalForm = { field: "", region: "", interests: "", targets: [], alsoReviewed: "", studyOn: "" };

const firstInt = (s: string | undefined, fallback: number): number => {
  const m = /(\d+)/.exec(s ?? "");
  return m ? Number(m[1]) : fallback;
};

export function goalToForm(g: PostSecondaryGoal | null | undefined): GoalForm {
  if (!g) return { ...EMPTY_GOAL };
  return {
    field: g.field, region: g.region, interests: g.interests.join(", "), alsoReviewed: g.alsoReviewed.join("\n"), studyOn: g.studyOn ?? "",
    targets: g.targets.map((t) => ({ name: t.name, city: t.city, track: t.track, program: t.program, why: t.why, admission: t.admission, url: t.url ?? "" })),
  };
}

export function agreementToForm(a: ProgramAgreementView | null | undefined): AgreementForm {
  const lt = a?.deadlines.find((d) => d.key === "language_test");
  const ps = a?.deadlines.find((d) => d.key === "prior_schooling_proof");
  return {
    signedOn: a?.signedOn ?? "", activatedOn: a?.activatedOn ?? "",
    supportMonths: String(a?.supportMonths ?? 9), accessMonths: String(a?.accessMonths ?? 36),
    languageTestDays: String(firstInt(lt?.rule, 30)), priorSchoolingDays: String(firstInt(ps?.rule, 90)),
    sessionsIncluded: String(a?.orientationSessionsIncluded ?? 2),
    ltStatus: lt?.status ?? "open", ltDoneOn: lt?.doneOn ?? "",
    ltScore: /score\s+(\d+)/i.exec(lt?.detail ?? "")?.[1] ?? "", ltTarget: /target\s+([^)]+)/i.exec(lt?.detail ?? "")?.[1]?.trim() ?? "",
    psStatus: ps?.status ?? "open", psDoneOn: ps?.doneOn ?? "",
    hasGoal: !!a?.goal, goal: goalToForm(a?.goal),
  };
}

const splitList = (s: string, sep: RegExp): string[] => s.split(sep).map((x) => x.trim()).filter(Boolean);
const nullable = (s: string) => (s.trim() === "" ? null : s.trim());
const int = (s: string): number => Number(s.trim());

export function goalFromForm(g: GoalForm) {
  return {
    field: g.field.trim(), region: g.region.trim(), interests: splitList(g.interests, /[,\n]/),
    targets: g.targets.map((t) => ({ name: t.name.trim(), city: t.city.trim(), track: t.track.trim(), program: t.program.trim(), why: t.why.trim(), admission: t.admission.trim(), url: nullable(t.url) })),
    alsoReviewed: splitList(g.alsoReviewed, /\n/), studyOn: nullable(g.studyOn),
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export interface AgreementUpdateResult {
  /** Only the changed parts; empty object = nothing to save. */
  readonly input: UpdateAgreementInput;
  readonly changed: boolean;
  /** Human-readable problems from the shared schema, e.g. "goal.field: String must contain at least 1 character". */
  readonly errors: readonly string[];
}

export function formToUpdate(initial: AgreementForm, f: AgreementForm): AgreementUpdateResult {
  const out: Record<string, unknown> = {};
  const errors: string[] = [];
  if (f.signedOn !== initial.signedOn) out.signedOn = nullable(f.signedOn);
  if (f.activatedOn !== initial.activatedOn) out.activatedOn = nullable(f.activatedOn);
  const numeric: [keyof AgreementForm, string][] = [
    ["supportMonths", "supportMonths"], ["accessMonths", "accessMonths"], ["languageTestDays", "languageTestDays"],
    ["priorSchoolingDays", "priorSchoolingDays"], ["sessionsIncluded", "orientationSessionsIncluded"],
  ];
  for (const [formKey, apiKey] of numeric) {
    if (f[formKey] !== initial[formKey]) {
      const n = int(String(f[formKey]));
      if (!Number.isInteger(n)) errors.push(`${apiKey}: not a whole number`);
      else out[apiKey] = n;
    }
  }
  if (f.ltStatus !== initial.ltStatus || f.ltDoneOn !== initial.ltDoneOn || f.ltScore !== initial.ltScore || f.ltTarget !== initial.ltTarget) {
    const score = f.ltScore.trim() === "" ? null : int(f.ltScore);
    if (score !== null && !Number.isInteger(score)) errors.push("languageTest.score: not a whole number");
    out.languageTest = { status: f.ltStatus, doneOn: nullable(f.ltDoneOn), score, target: nullable(f.ltTarget) };
  }
  if (f.psStatus !== initial.psStatus || f.psDoneOn !== initial.psDoneOn) {
    out.priorSchoolingProof = { status: f.psStatus, doneOn: nullable(f.psDoneOn) };
  }
  if (!f.hasGoal && initial.hasGoal) out.goal = null;
  else if (f.hasGoal && (!initial.hasGoal || !same(f.goal, initial.goal))) out.goal = goalFromForm(f.goal);

  const parsed = updateAgreementSchema.safeParse(out);
  if (!parsed.success) for (const issue of parsed.error.issues) errors.push(`${issue.path.join(".") || "form"}: ${issue.message}`);
  return { input: (parsed.success ? parsed.data : out) as UpdateAgreementInput, changed: Object.keys(out).length > 0, errors };
}
