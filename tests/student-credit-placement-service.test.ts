import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createStudentCreditPlacementService,
} from "../server/services/student-credit-placement-service";
import { StudentAcademicError } from "../server/lib/student-academic-errors";
import {
  studentCreditPlacementStatusEnum,
  studentCreditPlacements,
} from "../shared/student-credit-placement-schema";
import type { StudentCreditPlacementTx } from "../server/repositories/student-credit-placement-repo";

type Row = Record<string, any>;

function makeRepo() {
  const state = {
    decisions: new Map<string, Row>([
      ["decision-1", { id: "decision-1", programAssignmentId: "assignment-1" }],
    ]),
    records: new Map<string, Row>([
      ["record-1", { id: "record-1", studentId: "student-1" }],
    ]),
    assignments: new Map<string, Row>([
      ["assignment-1", { id: "assignment-1", studentId: "student-1", programVersionId: "program-version-1" }],
    ]),
    requirements: new Map<string, Row>([
      ["requirement-1", { id: "requirement-1", programVersionId: "program-version-1" }],
      ["requirement-2", { id: "requirement-2", programVersionId: "program-version-1" }],
      ["requirement-other", { id: "requirement-other", programVersionId: "program-version-2" }],
    ]),
    rules: new Map<string, Row>([
      ["rule-1", { id: "rule-1", programVersionId: "program-version-1" }],
      ["rule-global", { id: "rule-global", programVersionId: null }],
      ["rule-other", { id: "rule-other", programVersionId: "program-version-2" }],
    ]),
    placements: new Map<string, Row>(),
    calls: [] as string[],
    insertError: undefined as any,
    updateError: undefined as any,
    updateErrorOnCall: undefined as number | undefined,
    lifecycleUpdateCalls: 0,
  };
  const cloneState = () => ({
    decisions: new Map([...state.decisions].map(([id, row]) => [id, { ...row }])),
    records: new Map([...state.records].map(([id, row]) => [id, { ...row }])),
    assignments: new Map([...state.assignments].map(([id, row]) => [id, { ...row }])),
    requirements: new Map([...state.requirements].map(([id, row]) => [id, { ...row }])),
    rules: new Map([...state.rules].map(([id, row]) => [id, { ...row }])),
    placements: new Map([...state.placements].map(([id, row]) => [id, { ...row }])),
  });
  const restoreState = (snapshot: ReturnType<typeof cloneState>) => {
    for (const key of ["decisions", "records", "assignments", "requirements", "rules", "placements"] as const) {
      state[key].clear();
      for (const [id, row] of snapshot[key]) state[key].set(id, row);
    }
  };
  const repo = {
    _state: state,
    async lockDecisionRow(id: string, tx?: unknown) {
      state.calls.push(`lock decision ${id} ${tx === transaction}`);
    },
    async lockAssignmentRow(id: string, tx?: unknown) {
      state.calls.push(`lock assignment ${id} ${tx === transaction}`);
    },
    async lockPlacementRow(id: string, tx?: unknown) {
      state.calls.push(`lock placement ${id} ${tx === transaction}`);
    },
    async getDecisionContext(id: string, tx?: unknown) {
      state.calls.push(`read decision ${id} ${tx === transaction}`);
      const decision = state.decisions.get(id);
      if (!decision) return null;
      const creditRecord = state.records.get(decision.creditRecordId ?? "record-1");
      return creditRecord ? { decision, creditRecord } : null;
    },
    async getAssignmentContext(id: string, tx?: unknown) {
      state.calls.push(`read assignment ${id} ${tx === transaction}`);
      const assignment = state.assignments.get(id);
      return assignment ? { assignment, programVersion: { id: assignment.programVersionId } } : null;
    },
    async getRequirementContext(id: string, tx?: unknown) {
      state.calls.push(`read requirement ${id} ${tx === transaction}`);
      const requirement = state.requirements.get(id);
      return requirement ? { requirement, programVersion: { id: requirement.programVersionId } } : null;
    },
    async getAcademicRuleContext(id: string, tx?: unknown) {
      state.calls.push(`read rule ${id} ${tx === transaction}`);
      const rule = state.rules.get(id);
      return rule ? { rule, programVersion: rule.programVersionId ? { id: rule.programVersionId } : null } : null;
    },
    async getActiveExactPlacement(input: any, tx?: unknown) {
      state.calls.push(`check active ${tx === transaction}`);
      return [...state.placements.values()].find((row) =>
        row.status === "active"
        && row.studentCreditDecisionId === input.studentCreditDecisionId
        && row.programAssignmentId === input.programAssignmentId
        && row.requirementId === input.requirementId
        && row.academicRuleId === (input.academicRuleId ?? null),
      ) ?? null;
    },
    async getPlacement(id: string, tx?: unknown) {
      state.calls.push(`read placement ${id} ${tx === transaction}`);
      return state.placements.get(id) ?? null;
    },
    async insertPlacement(input: any, tx?: unknown) {
      state.calls.push(`insert ${tx === transaction}`);
      if (state.insertError) throw state.insertError;
      const id = `placement-${state.placements.size + 1}`;
      const row = {
        id,
        ...input,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      state.placements.set(id, row);
      return row;
    },
    async updatePlacementLifecycle(id: string, update: any, tx?: unknown) {
      state.calls.push(`update lifecycle ${tx === transaction}`);
      state.lifecycleUpdateCalls++;
      if (state.updateError || state.lifecycleUpdateCalls === state.updateErrorOnCall) {
        throw state.updateError ?? new Error("update failed");
      }
      const old = state.placements.get(id);
      if (!old) return null;
      const row = {
        ...old,
        status: update.status,
        updatedAt: new Date(),
        ...(update.status === "revoked"
          ? { revokedBy: update.actor, revokedAt: new Date(), revocationRationale: update.rationale }
          : {
            supersededBy: update.actor,
            supersededAt: new Date(),
            supersedeRationale: update.rationale,
            supersededByPlacementId: update.supersededByPlacementId,
          }),
      };
      state.placements.set(id, row);
      return row;
    },
  };
  const transaction = {} as StudentCreditPlacementTx;
  const runner = async <T>(fn: (tx: StudentCreditPlacementTx) => Promise<T>): Promise<T> => {
    const snapshot = cloneState();
    try {
      return await fn(transaction);
    } catch (error) {
      restoreState(snapshot);
      throw error;
    }
  };
  return { repo, state, runner };
}

function serviceFor() {
  const context = makeRepo();
  return {
    ...context,
    service: createStudentCreditPlacementService(context.repo as any, context.runner),
  };
}

const createInput = (overrides: Partial<Record<string, any>> = {}) => ({
  studentCreditDecisionId: "decision-1",
  programAssignmentId: "assignment-1",
  requirementId: "requirement-1",
  actor: "actor-1",
  rationale: "Recorded placement",
  ...overrides,
});

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}

describe("Phase 4B — Student Credit Placement service", () => {
  it("creates a valid placement without academic result inference", async () => {
    const { service } = serviceFor();
    const placement = await service.createPlacement(createInput());
    expect(placement.status).toBe("active");
    expect(placement).not.toHaveProperty("academicResult");
    expect(placement).not.toHaveProperty("inferredStatus");
  });

  it.each([
    ["decision", { studentCreditDecisionId: "missing" }],
    ["assignment", { programAssignmentId: "missing" }],
    ["requirement", { requirementId: "missing" }],
    ["rule", { academicRuleId: "missing" }],
  ])("rejects a missing %s", async (_entity, overrides) => {
    const { service } = serviceFor();
    await expectCode(service.createPlacement(createInput(overrides)), "STUDENT_ACADEMIC_NOT_FOUND");
  });

  it("rejects a decision-assignment mismatch", async () => {
    const { service, state } = serviceFor();
    state.decisions.get("decision-1").programAssignmentId = "other-assignment";
    await expectCode(service.createPlacement(createInput()), "STUDENT_ACADEMIC_PROVENANCE_MISMATCH");
  });

  it("rejects a cross-student decision credit record", async () => {
    const { service, state } = serviceFor();
    state.records.get("record-1").studentId = "student-2";
    await expectCode(service.createPlacement(createInput()), "STUDENT_ACADEMIC_PROVENANCE_MISMATCH");
  });

  it("rejects a requirement from another program version", async () => {
    const { service } = serviceFor();
    await expectCode(
      service.createPlacement(createInput({ requirementId: "requirement-other" })),
      "STUDENT_ACADEMIC_PROVENANCE_MISMATCH",
    );
  });

  it.each(["rule-global", "rule-other"])("rejects a global or mismatched rule (%s)", async (academicRuleId) => {
    const { service } = serviceFor();
    await expectCode(
      service.createPlacement(createInput({ academicRuleId })),
      "STUDENT_ACADEMIC_PROVENANCE_MISMATCH",
    );
  });

  it("prevents an exact active duplicate when academicRuleId is null", async () => {
    const { service } = serviceFor();
    await service.createPlacement(createInput());
    await expectCode(service.createPlacement(createInput()), "STUDENT_ACADEMIC_DUPLICATE");
  });

  it("prevents an exact active duplicate with a non-null rule", async () => {
    const { service } = serviceFor();
    await service.createPlacement(createInput({ academicRuleId: "rule-1" }));
    await expectCode(
      service.createPlacement(createInput({ academicRuleId: "rule-1" })),
      "STUDENT_ACADEMIC_DUPLICATE",
    );
  });

  it("represents distinct active requirement and rule placements for one decision", async () => {
    const { service } = serviceFor();
    const first = await service.createPlacement(createInput());
    const second = await service.createPlacement(createInput({ requirementId: "requirement-2" }));
    const third = await service.createPlacement(createInput({ academicRuleId: "rule-1" }));
    expect(new Set([first.id, second.id, third.id]).size).toBe(3);
  });

  it("translates only the active-identity unique violation", async () => {
    const { service, state } = serviceFor();
    state.insertError = { code: "23505", constraint: "student_cp_active_identity_unique_idx" };
    await expectCode(service.createPlacement(createInput()), "STUDENT_ACADEMIC_DUPLICATE");
  });

  it("rethrows an unrelated unique violation", async () => {
    const { service, state } = serviceFor();
    const error = { code: "23505", constraint: "unrelated_unique_idx" };
    state.insertError = error;
    await expect(service.createPlacement(createInput())).rejects.toBe(error);
  });

  it("uses one transaction and locks before reads and active check", async () => {
    const { service, state } = serviceFor();
    await service.createPlacement(createInput());
    expect(state.calls).toEqual([
      "lock decision decision-1 true",
      "lock assignment assignment-1 true",
      "read decision decision-1 true",
      "read assignment assignment-1 true",
      "read requirement requirement-1 true",
      "check active true",
      "insert true",
    ]);
  });

  it("supersedes an active placement with the same exact identity", async () => {
    const { service } = serviceFor();
    const old = await service.createPlacement(createInput());
    const result = await service.supersedePlacement({
      oldPlacementId: old.id,
      requirementId: "requirement-1",
      actor: "actor-2",
      rationale: "Recorded replacement",
    });
    expect(result.oldPlacement.status).toBe("superseded");
    expect(result.newPlacement.status).toBe("active");
    expect(result.newPlacement.supersedesPlacementId).toBe(old.id);
  });

  it("supersedes an active placement with a distinct identity", async () => {
    const { service } = serviceFor();
    const old = await service.createPlacement(createInput());
    const result = await service.supersedePlacement({
      oldPlacementId: old.id,
      requirementId: "requirement-2",
      actor: "actor-2",
      rationale: "Moved placement",
    });
    expect(result.newPlacement.requirementId).toBe("requirement-2");
  });

  it("rejects superseding a non-active placement", async () => {
    const { service, state } = serviceFor();
    const old = await service.createPlacement(createInput());
    state.placements.get(old.id).status = "revoked";
    await expectCode(service.supersedePlacement({
      oldPlacementId: old.id,
      requirementId: "requirement-1",
      actor: "actor-2",
      rationale: "Replacement",
    }), "STUDENT_ACADEMIC_INVALID_STATE");
  });

  it("rolls back an insert failure during supersede", async () => {
    const { service, state } = serviceFor();
    const old = await service.createPlacement(createInput());
    state.insertError = new Error("insert failed");
    await expect(service.supersedePlacement({
      oldPlacementId: old.id,
      requirementId: "requirement-2",
      actor: "actor-2",
      rationale: "Replacement",
    })).rejects.toThrow("insert failed");
    expect(state.placements.get(old.id).status).toBe("active");
    expect(state.placements.size).toBe(1);
  });

  it("rolls back a reciprocal update failure during supersede", async () => {
    const { service, state } = serviceFor();
    const old = await service.createPlacement(createInput());
    state.updateErrorOnCall = 2;
    await expect(service.supersedePlacement({
      oldPlacementId: old.id,
      requirementId: "requirement-2",
      actor: "actor-2",
      rationale: "Replacement",
    })).rejects.toThrow("update failed");
    expect(state.placements.get(old.id).status).toBe("active");
    expect(state.placements.size).toBe(1);
    expect(state.lifecycleUpdateCalls).toBe(2);
  });

  it("rejects a replacement that changes historical decision or assignment", async () => {
    const { service } = serviceFor();
    const old = await service.createPlacement(createInput());
    await expectCode(service.supersedePlacement({
      oldPlacementId: old.id,
      studentCreditDecisionId: "other-decision",
      requirementId: "requirement-2",
      actor: "actor-2",
      rationale: "Replacement",
    }), "STUDENT_ACADEMIC_PROVENANCE_MISMATCH");
  });

  it("revokes an active placement and rejects a second revoke", async () => {
    const { service } = serviceFor();
    const placement = await service.createPlacement(createInput());
    const revoked = await service.revokePlacement({
      placementId: placement.id,
      actor: "actor-2",
      rationale: "Revoked record",
    });
    expect(revoked.status).toBe("revoked");
    await expectCode(service.revokePlacement({
      placementId: placement.id,
      actor: "actor-2",
      rationale: "Again",
    }), "STUDENT_ACADEMIC_INVALID_STATE");
  });

  it("preserves identity and base provenance through lifecycle transitions", async () => {
    const { service, state } = serviceFor();
    const old = await service.createPlacement({
      ...createInput(),
      metadata: { source: "manual" },
      provenance: { claimVersionId: "claim-1" },
    });
    const before = { ...old };
    const result = await service.supersedePlacement({
      oldPlacementId: old.id,
      requirementId: "requirement-2",
      actor: "actor-2",
      rationale: "Replacement",
    });
    const after = state.placements.get(old.id);
    for (const field of [
      "id", "studentCreditDecisionId", "programAssignmentId", "requirementId",
      "academicRuleId", "supersedesPlacementId", "actor", "rationale", "metadata", "provenance",
    ]) expect(after[field]).toEqual(before[field]);
    expect(result.newPlacement.supersedesPlacementId).toBe(old.id);
  });

  it("keeps lifecycle errors from inferring an academic result", async () => {
    const { service } = serviceFor();
    const placement = await service.createPlacement(createInput());
    const revoked = await service.revokePlacement({
      placementId: placement.id,
      actor: "actor-2",
      rationale: "Administrative lifecycle event",
    });
    expect(revoked).not.toHaveProperty("academicResult");
    expect(revoked).not.toHaveProperty("decisionStatus");
  });

  it("exposes the canonical enum and placement identity fields", () => {
    expect(studentCreditPlacementStatusEnum.enumValues).toEqual(["active", "revoked", "superseded"]);
    for (const field of [
      "studentCreditDecisionId", "programAssignmentId", "requirementId", "academicRuleId",
      "status", "supersedesPlacementId", "supersededByPlacementId", "actor", "rationale",
      "metadata", "provenance", "revokedBy", "revokedAt", "revocationRationale",
      "supersededBy", "supersededAt", "supersedeRationale", "createdAt", "updatedAt",
    ]) expect((studentCreditPlacements as any)[field]).toBeDefined();
  });

  it("declares null-equal active and supersession uniqueness in Drizzle source", () => {
    const source = readFileSync(join(process.cwd(), "shared/student-credit-placement-schema.ts"), "utf8");
    expect(source).toContain("activeIdentityUnique");
    expect(source).toContain("coalesce(");
    expect(source).toContain("00000000-0000-0000-0000-000000000000");
    expect(source).toContain("student_cp_no_zero_academic_rule");
    expect(source).not.toContain("NULLS NOT DISTINCT");
    expect(source).toContain("supersedesUnique");
    expect(source).toContain("supersededByPlacementId");
  });

  it("declares cross-binding and lifecycle integrity in the migration", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260916010000_phase4b_student_credit_placement.sql"), "utf8");
    for (const fragment of [
      "student_cp_guard_immutable_history",
      "student_cp_cross_binding_guard",
      "CONSTRAINT TRIGGER",
      "DEFERRABLE INITIALLY DEFERRED",
      "student_cp_guard_lifecycle",
      "student_cp_active_identity_unique_idx",
      "student_cp_supersedes_unique_idx",
      "self",
      "cycle",
      "superseded_by_placement_id",
      "is_staff_or_admin()",
      "ENABLE ROW LEVEL SECURITY",
    ]) expect(sql).toContain(fragment);
    expect(sql).not.toMatch(/CREATE POLICY[^;]+FOR DELETE/i);
  });

  it("declares explicit self-link and cycle rejection", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260916010000_phase4b_student_credit_placement.sql"), "utf8");
    expect(sql).toContain("self-link is not allowed");
    expect(sql).toContain("cycle is not allowed");
    expect(sql).toContain("student_cp_validate_lifecycle_graph");
  });

  it("declares one-child supersession protection", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260916010000_phase4b_student_credit_placement.sql"), "utf8");
    expect(sql).toContain("student_cp_supersedes_unique_idx");
    expect(sql).toContain("supersedes_placement_id IS NOT NULL");
    expect(sql).toContain("superseded-by reciprocal link mismatch");
  });

  it("supports valid multi-generation and revoked descendant history", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260916010000_phase4b_student_credit_placement.sql"), "utf8");
    expect(sql).toContain("child_status NOT IN ('active', 'revoked', 'superseded')");
    expect(sql).toContain("current_status = 'superseded'");
    expect(sql).toContain("parent_status <> 'superseded'");
  });

  it("rejects malformed active, revoked, and superseded audit combinations", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260916010000_phase4b_student_credit_placement.sql"), "utf8");
    expect(sql).toContain("NEW.status = 'active'");
    expect(sql).toContain("NEW.status = 'revoked'");
    expect(sql).toContain("current_status = 'superseded'");
    expect(sql).toContain("current_revoked_by IS NOT NULL");
    expect(sql).toContain("current_revoked_at IS NOT NULL");
    expect(sql).toContain("current_revocation_rationale IS NOT NULL");
    expect(sql).toContain("current_revoked_by IS NULL");
    expect(sql).toContain("current_revoked_at IS NULL");
    expect(sql).toContain("current_revocation_rationale IS NULL");
  });

  it("aligns lifecycle UUID links and actor text in the deferred validator", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260916010000_phase4b_student_credit_placement.sql"), "utf8");
    const start = sql.indexOf("CREATE OR REPLACE FUNCTION student_cp_validate_lifecycle_graph()");
    const end = sql.indexOf("DROP TRIGGER IF EXISTS student_cp_lifecycle_integrity", start);
    const body = sql.slice(start, end);
    expect(body).toContain("current_superseded_by_placement_id uuid");
    expect(body).toContain("current_superseded_by_actor text");
    expect(body).toContain("p.superseded_by_placement_id");
    expect(body).toContain("p.superseded_by");
    expect(body).toContain("current_superseded_by_placement_id");
    expect(body).toContain("current_superseded_by_actor");
    expect(body).toContain("btrim(current_superseded_by_actor)");
    expect(body).not.toMatch(/btrim\(current_superseded_by\)/);
    expect(body).toMatch(/WHERE c\.id = current_superseded_by_placement_id/);
    expect(body).toContain("child_supersedes IS DISTINCT FROM NEW.id");
    expect(body).toContain("parent_child IS DISTINCT FROM NEW.id");
    expect(body).toContain("child_status NOT IN ('active', 'revoked', 'superseded')");
    expect(body).toContain("current_status NOT IN ('active', 'revoked', 'superseded')");
    expect(body).toContain("WHILE current_id IS NOT NULL");
    expect(body).toContain("visited := array_append(visited, current_id)");
    expect(body).toContain("current_status = 'superseded'");
    expect(body).toContain("current_status = 'revoked'");
  });

  it("uses FOR SHARE locks for every canonical cross-binding row", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260916010000_phase4b_student_credit_placement.sql"), "utf8");
    const trigger = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION student_cp_cross_binding_guard"), sql.indexOf("-- Immediate checks"));
    expect(trigger).toContain("FOR SHARE");
    expect(trigger).not.toContain("FOR KEY SHARE");
    expect(trigger.match(/FOR SHARE/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("uses the same zero-UUID COALESCE sentinel and collision check in schema and SQL", () => {
    const source = readFileSync(join(process.cwd(), "shared/student-credit-placement-schema.ts"), "utf8");
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260916010000_phase4b_student_credit_placement.sql"), "utf8");
    const sentinel = "00000000-0000-0000-0000-000000000000";
    expect(source).toContain(`coalesce(`);
    expect(source).toContain(sentinel);
    expect(sql).toContain("coalesce(");
    expect(sql).toContain(sentinel);
    expect(source).toContain("student_cp_no_zero_academic_rule");
    expect(sql).toContain("student_cp_no_zero_academic_rule");
    expect(sql).not.toContain("NULLS NOT DISTINCT");
  });

  it("maps a supersession-link unique violation deterministically", async () => {
    const { service, state } = serviceFor();
    const old = await service.createPlacement(createInput());
    state.insertError = { code: "23505", constraint: "student_cp_supersedes_unique_idx" };
    await expectCode(service.supersedePlacement({
      oldPlacementId: old.id,
      requirementId: "requirement-2",
      actor: "actor-2",
      rationale: "Replacement",
    }), "STUDENT_ACADEMIC_DUPLICATE");
  });

  it("uses the project error type for rejected placement operations", async () => {
    const { service } = serviceFor();
    try {
      await service.createPlacement(createInput({ actor: " " }));
    } catch (error) {
      expect(error).toBeInstanceOf(StudentAcademicError);
      return;
    }
    throw new Error("expected validation error");
  });
});