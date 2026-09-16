import { describe, expect, it } from "vitest";
import {
  ADMIN_STUDENT_WORKSPACE_QUERY_KEY,
  adminStudentWorkspacePath,
  attentionItemLabel,
  classifyWorkspaceQueryError,
  selectWorkspaceState,
  toWorkspaceViewModel,
} from "@/pages/admin-student-workspace-presentation";

describe("admin student workspace presentation", () => {
  const report = {
    status: "COMPOSED",
    phase3Output: {
      results: [
        { status: "MANUAL_REVIEW", requirementId: "r1", reason: "needs review", evidence: { sourceId: "s1" } },
        { status: "CONFLICT", requirementId: "r2", reason: "conflict" },
        { status: "MISSING", requirementId: "r3" },
        { status: "PARTIAL", requirementId: "r4", requiredAmount: 3, appliedAmount: 1, remainingAmount: 2 },
      ],
    },
    integrationDiagnostics: [{ code: "SOURCE_UNAVAILABLE" }],
    snapshot: { asOf: "2025-01-01", fingerprint: "fp" },
  };
  it("groups all attention statuses, preserves details, and falls back missing labels", () => {
    const vm = toWorkspaceViewModel({
      student: { id: "st1", first_name: "Ada", last_name: "Lovelace" },
      assignment: { programVersionId: "pv1" },
      program: { id: "p1", name: "Computer Science" },
      programVersion: { id: "pv1" },
      report,
       needsAttention: { hasAttention: true, groups: { manualReview: [report.phase3Output.results[0]], missing: [report.phase3Output.results[2]], partial: [report.phase3Output.results[3]], conflict: [report.phase3Output.results[1]] }, reasons: [], diagnostics: [], integrationDiagnostics: [] },
      displayLabels: { requirements: { r1: { label: "Requirement One", source: "canonical" } } },
      snapshot: report.snapshot,
    } as any);
    expect(vm.attention.total).toBe(4);
    expect(vm.attention.items).toEqual(expect.arrayContaining(report.phase3Output.results));
    expect(vm.labels.requirements.r3.label).toBe("r3");
    expect(vm.provenance.integrationDiagnostics).toEqual([]);
  });
  it("uses authoritative server groups without recursively scraping report provenance", () => {
    const groupedItem = { status: "MISSING", requirementId: "r-server", reason: "server item" };
    const nestedProvenance = { status: "CONFLICT", requirementId: "r-nested", provenance: { status: "MISSING", requirementId: "r-fake" } };
    const vm = toWorkspaceViewModel({
      student: {}, assignment: {}, program: {}, programVersion: {},
      report: { status: "COMPOSED", phase3Output: { results: [nestedProvenance] } },
      needsAttention: { hasAttention: true, groups: { manualReview: [], missing: [groupedItem], partial: [], conflict: [] }, reasons: [], diagnostics: [], integrationDiagnostics: [] },
      displayLabels: {}, snapshot: {},
    });
    expect(vm.attention.items).toEqual([groupedItem]);
    expect(vm.attention.items).not.toContain(nestedProvenance);
    expect(vm.attention.items).not.toContainEqual(expect.objectContaining({ requirementId: "r-fake" }));
  });
  it("does not synthesize report-level manual review without an authoritative sidecar item", () => {
    const vm = toWorkspaceViewModel({
      report: { status: "MANUAL_REVIEW" },
      needsAttention: { hasAttention: true, groups: { manualReview: [], missing: [], partial: [], conflict: [] }, reasons: [], diagnostics: [], integrationDiagnostics: [] },
      displayLabels: {},
    });
    expect(vm.attention.hasAttention).toBe(false);
    expect(vm.attention.total).toBe(0);
  });
  it("keeps an authoritative conflict group even when the embedded item status disagrees", () => {
    const item = { status: "MISSING", requirementId: "r-conflict" };
    const vm = toWorkspaceViewModel({
      report: { status: "COMPOSED" },
      needsAttention: { groups: { manualReview: [], missing: [], partial: [], conflict: [item] } },
      displayLabels: {},
    });
    expect(vm.attention.grouped.CONFLICT).toEqual([item]);
    expect(vm.attention.grouped.MISSING).toEqual([]);
    expect(vm.attention.items[0]).toBe(item);
    expect(item.status).toBe("MISSING");
  });
  it("does not append report-level manual review when serialized authoritative groups already contain attention", () => {
    const serverResponse = {
      report: { status: "MANUAL_REVIEW", integrationDiagnostics: [{ code: "REPORT_ONLY" }] },
      needsAttention: {
        hasAttention: true,
        groups: { manualReview: [], missing: [{ status: "MISSING", requirementId: "r1" }], partial: [], conflict: [] },
        diagnostics: [],
        integrationDiagnostics: [{ code: "SIDEcar" }],
      },
      displayLabels: {},
    };
    const vm = toWorkspaceViewModel(JSON.parse(JSON.stringify(serverResponse)));
    expect(vm.attention.total).toBe(2);
    expect(vm.attention.items).toEqual([
      expect.objectContaining({ status: "MISSING", requirementId: "r1" }),
      expect.objectContaining({ kind: "integration-diagnostic", diagnostic: { code: "SIDEcar" } }),
    ]);
  });
  it("uses structural keys across the serialized boundary and ignores report diagnostics when sidecar exists", () => {
    const serverResponse = {
      report: { status: "COMPOSED", integrationDiagnostics: [{ code: "TIMEOUT", message: "same" }] },
      needsAttention: {
        groups: {
          manualReview: [],
          missing: [{ status: "MISSING", requirementId: "r1", reason: "same" }, { requirementId: "r1", status: "MISSING", reason: "same" }],
          partial: [],
          conflict: [],
        },
        diagnostics: [{ code: "SOURCE_UNAVAILABLE", message: "same" }, { message: "same", code: "SOURCE_UNAVAILABLE" }],
        integrationDiagnostics: [{ code: "TIMEOUT", message: "same" }, { message: "same", code: "TIMEOUT" }],
      },
      displayLabels: {},
    };
    const vm = toWorkspaceViewModel(JSON.parse(JSON.stringify(serverResponse)));
    expect(vm.attention.total).toBe(3);
    expect(vm.attention.items).toHaveLength(vm.attention.total);
    expect(vm.attention.hasAttention).toBe(true);
    expect(vm.provenance.integrationDiagnostics).toEqual(serverResponse.needsAttention.integrationDiagnostics);
  });
  it("selects an academic-rule canonical label when requirementId is null", () => {
    const vm = toWorkspaceViewModel({
      report: { status: "COMPOSED" },
      needsAttention: {
        groups: { manualReview: [], missing: [], partial: [], conflict: [{ status: "CONFLICT", requirementId: null, academicRuleId: "rule-7" }] },
      },
      displayLabels: { academicRules: { "rule-7": { label: "Minimum residency rule", source: "canonical" } } },
    });
    expect(attentionItemLabel(vm.labels, vm.attention.items[0])).toBe("Minimum residency rule");
  });
  it("uses the server rule id fallback without inventing a rule label", () => {
    const vm = toWorkspaceViewModel({
      report: { status: "COMPOSED" },
      needsAttention: {
        groups: { manualReview: [], missing: [], partial: [], conflict: [{ status: "CONFLICT", requirementId: null, academicRuleId: "rule-404" }] },
      },
      displayLabels: { academicRules: { "rule-404": { label: "rule-404", source: "id-fallback" } } },
    });
    expect(attentionItemLabel(vm.labels, vm.attention.items[0])).toBe("rule-404");
    expect(attentionItemLabel(vm.labels, { status: "CONFLICT", academicRuleId: "rule-404" })).not.toContain("Rule");
  });
  it("shows diagnostics and integration diagnostics as visible attention items", () => {
    const diagnostic = { code: "SOURCE_UNAVAILABLE", message: "Source unavailable" };
    const integration = { code: "TIMEOUT" };
    const vm = toWorkspaceViewModel({
      report: { status: "COMPOSED", integrationDiagnostics: [integration] },
      needsAttention: { hasAttention: false, groups: { manualReview: [], missing: [], partial: [], conflict: [] }, reasons: [], diagnostics: [diagnostic], integrationDiagnostics: [integration] },
      displayLabels: {},
    });
    expect(vm.attention.items).toEqual([
      expect.objectContaining({ kind: "diagnostic", diagnostic }),
      expect.objectContaining({ kind: "integration-diagnostic", diagnostic: integration }),
    ]);
    expect(vm.attention.total).toBe(2);
    expect(vm.attention.hasAttention).toBe(true);
  });
  it("does not invent duplicate source items", () => {
    const source = { status: "MISSING", requirementId: "r1" };
    const vm = toWorkspaceViewModel({
      report: { status: "COMPOSED" },
      needsAttention: { hasAttention: true, groups: { manualReview: [], missing: [source, source], partial: [], conflict: [] }, diagnostics: [source], integrationDiagnostics: [] },
      displayLabels: {},
    });
    expect(vm.attention.items.filter((item) => item === source)).toHaveLength(1);
  });
  it("preserves typed top-level metadata", () => {
    const metadata = {
      student: { id: "s1" }, assignment: { id: "a1" }, program: { id: "p1" },
      programVersion: { id: "pv1" }, snapshot: { asOf: "2025-01-01", fingerprint: "fp" },
    };
    const vm = toWorkspaceViewModel({ ...metadata, report: { status: "COMPOSED" }, needsAttention: { groups: { manualReview: [], missing: [], partial: [], conflict: [] } }, displayLabels: {} });
    expect(vm.student).toBe(metadata.student);
    expect(vm.assignment).toBe(metadata.assignment);
    expect(vm.program).toBe(metadata.program);
    expect(vm.programVersion).toBe(metadata.programVersion);
    expect(vm.snapshot).toBe(metadata.snapshot);
  });
  it("returns no-attention empty state for complete report", () => {
    const vm = toWorkspaceViewModel({ student: {}, report: { status: "COMPOSED", phase3Output: { results: [] }, integrationDiagnostics: [] }, needsAttention: { groups: { manualReview: [], missing: [], partial: [], conflict: [] } }, displayLabels: {}, snapshot: {} } as any);
    expect(vm.attention.total).toBe(0);
  });
  it("selects loading, error, empty and ready states", () => {
    expect(selectWorkspaceState({ isLoading: true } as any).kind).toBe("loading");
    expect(selectWorkspaceState({ isError: true } as any).kind).toBe("error");
    expect(selectWorkspaceState({ data: null } as any).kind).toBe("empty");
    expect(selectWorkspaceState({ data: { student: {} } } as any).kind).toBe("ready");
  });
  it("classifies query errors by HTTP status without treating authorization failures as not-found", () => {
    expect(classifyWorkspaceQueryError(new Error("404: not found"))).toBe("not-found");
    expect(classifyWorkspaceQueryError(new Error("4040: network payload"))).toBe("error");
    expect(selectWorkspaceState({ isError: true, error: new Error("404: not found") } as any)).toMatchObject({ kind: "empty", reason: "not-found" });
    expect(selectWorkspaceState({ isError: true, error: new Error("401: unauthorized") } as any)).toMatchObject({ kind: "error" });
    expect(selectWorkspaceState({ isError: true, error: new Error("403: forbidden") } as any)).toMatchObject({ kind: "error" });
    expect(selectWorkspaceState({ isError: true, error: new Error("500: server error") } as any)).toMatchObject({ kind: "error" });
    expect(selectWorkspaceState({ isError: true, error: new Error("network failed") } as any)).toMatchObject({ kind: "error" });
  });
  it("exposes accessible loading announcement metadata", () => {
    expect(selectWorkspaceState({ isLoading: true } as any)).toMatchObject({
      kind: "loading", role: "status", ariaLive: "polite",
    });
  });
  it("exports stable endpoint query key and eye destination", () => {
    expect(ADMIN_STUDENT_WORKSPACE_QUERY_KEY("abc")).toEqual(["/api/admin/students/abc/workspace"]);
    expect(adminStudentWorkspacePath("abc")).toBe("/admin/students/abc");
  });
});