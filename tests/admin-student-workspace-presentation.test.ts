import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ADMIN_STUDENT_WORKSPACE_QUERY_KEY,
  ADMIN_STUDENT_WORKSPACE_QUERY_OPTIONS,
  ADMIN_STUDENTS_PATH,
  adminTabFromSearch,
  adminStudentWorkspacePath,
  academicCreditRows,
  attentionItemLabel,
  classifyWorkspaceQueryError,
  diagnosticItemStatus,
  selectWorkspaceState,
  toWorkspaceViewModel,
} from "@/pages/admin-student-workspace-presentation";

const useQueryMock = vi.hoisted(() => vi.fn(() => ({ isLoading: true })));
const useLocationMock = vi.hoisted(() => vi.fn());
const useSearchMock = vi.hoisted(() => vi.fn());
const setLocationMock = vi.hoisted(() => vi.fn());
const tabsPropsMock = vi.hoisted(() => vi.fn());
const useDocumentsMock = vi.hoisted(() => vi.fn(() => ({
  isLoading: true, isError: false, data: undefined, refetch: vi.fn(),
})));
const useTicketsMock = vi.hoisted(() => vi.fn(() => ({
  isLoading: true, isError: false, data: undefined, refetch: vi.fn(),
})));
vi.stubGlobal("React", React);
vi.mock("@tanstack/react-query", () => ({
  useQuery: useQueryMock,
  useMutation: vi.fn(() => ({ isPending: false, mutate: vi.fn() })),
  useQueryClient: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  useAuthFetch: vi.fn(() => vi.fn()),
}));
vi.mock("@/hooks/use-documents", () => ({
  useDocuments: useDocumentsMock,
}));
vi.mock("@/hooks/use-tickets", () => ({
  useTickets: useTicketsMock,
}));
vi.mock("wouter", () => ({
  useParams: () => ({ studentId: "student-1" }),
  useLocation: useLocationMock,
  useSearch: useSearchMock,
  Link: ({ children }: { children: unknown }) => children,
}));
vi.mock("@/components/ui/tabs", () => ({
  Tabs: (props: Record<string, unknown>) => {
    tabsPropsMock(props);
    return null;
  },
  TabsContent: () => null,
  TabsList: () => null,
  TabsTrigger: () => null,
}));

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
  it("does not confuse an authoritative result kind with a client diagnostic wrapper", () => {
    const item = { kind: "diagnostic", status: "MISSING", requirementId: "r-kind" };
    const vm = toWorkspaceViewModel({
      report: { status: "COMPOSED" },
      needsAttention: { groups: { manualReview: [], missing: [item], partial: [], conflict: [] } },
      displayLabels: {},
    });
    expect(vm.attention.items).toEqual([item]);
    expect(vm.attention.grouped.MISSING).toEqual([item]);
    expect(vm.provenance.evidence).toEqual([]);
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
  it("preserves every authoritative occurrence in sidecar order", () => {
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
    expect(vm.attention.total).toBe(6);
    expect(vm.attention.items).toHaveLength(vm.attention.total);
    expect(vm.attention.items.slice(0, 2)).toEqual(serverResponse.needsAttention.groups.missing);
    expect(vm.attention.items.slice(2, 4)).toEqual([
      { kind: "diagnostic", diagnostic: serverResponse.needsAttention.diagnostics[0] },
      { kind: "diagnostic", diagnostic: serverResponse.needsAttention.diagnostics[1] },
    ]);
    expect(vm.attention.items.slice(4)).toEqual([
      { kind: "integration-diagnostic", diagnostic: serverResponse.needsAttention.integrationDiagnostics[0] },
      { kind: "integration-diagnostic", diagnostic: serverResponse.needsAttention.integrationDiagnostics[1] },
    ]);
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
  it("shows diagnostic statuses only when the server supplied them", () => {
    const diagnostic = { code: "SOURCE_UNAVAILABLE", message: "Source unavailable" };
    const integration = { code: "TIMEOUT" };
    const supplied = { code: "REVIEW", status: "MANUAL_REVIEW" };
    const vm = toWorkspaceViewModel({
      report: { status: "COMPOSED", integrationDiagnostics: [integration] },
      needsAttention: { hasAttention: false, groups: { manualReview: [], missing: [], partial: [], conflict: [] }, reasons: [], diagnostics: [diagnostic, supplied], integrationDiagnostics: [integration] },
      displayLabels: {},
    });
    expect(vm.attention.items).toEqual([
      expect.objectContaining({ kind: "diagnostic", diagnostic }),
      expect.objectContaining({ kind: "diagnostic", diagnostic: supplied }),
      expect.objectContaining({ kind: "integration-diagnostic", diagnostic: integration }),
    ]);
    expect(vm.attention.items[0]).not.toHaveProperty("status");
    expect(vm.attention.items[2]).not.toHaveProperty("status");
    expect(diagnosticItemStatus(vm.attention.items[0] as any)).toBeUndefined();
    expect(diagnosticItemStatus(vm.attention.items[1] as any)).toBe("MANUAL_REVIEW");
    expect(vm.attention.total).toBe(3);
    expect(vm.attention.hasAttention).toBe(true);
  });
  it("keeps duplicate authoritative source occurrences visible", () => {
    const source = { status: "MISSING", requirementId: "r1" };
    const vm = toWorkspaceViewModel({
      report: { status: "COMPOSED" },
      needsAttention: { hasAttention: true, groups: { manualReview: [], missing: [source, source], partial: [], conflict: [] }, diagnostics: [source], integrationDiagnostics: [] },
      displayLabels: {},
    });
    expect(vm.attention.items.filter((item) => item === source)).toHaveLength(2);
    expect(vm.attention.total).toBe(3);
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
  it("presents coherent canonical academic rows without selecting latest state", () => {
    const latestVerification = { id: "verification-latest", creditRecordId: "credit-1", action: "verified", seq: 9 };
    const latestDecision = { id: "decision-latest", creditRecordId: "credit-1", programAssignmentId: "assignment-1", action: "accepted", creditsAwarded: "3.00", seq: 7 };
    const placement = {
      id: "placement-1",
      studentCreditDecisionId: "decision-latest",
      programAssignmentId: "assignment-1",
      requirementId: "requirement-1",
      status: "superseded",
      rationale: "Canonical history",
      provenance: { evidenceExcerptId: "excerpt-1" },
      supersededByPlacementId: "placement-2",
    };
    const vm = toWorkspaceViewModel({
      report: { status: "COMPOSED" },
      needsAttention: { groups: { manualReview: [], missing: [], partial: [], conflict: [] } },
      displayLabels: {},
      academicDetail: {
        academicSources: [{ id: "source-1", studentId: "student-1", title: "Official transcript" }],
        creditRecords: [{ id: "credit-1", studentId: "student-1", sourceId: "source-1", rawTitle: "Calculus I" }],
        latestVerifications: { "credit-1": latestVerification },
        latestDecisions: { "credit-1": latestDecision },
        placements: [placement],
      },
    });
    const rows = academicCreditRows(vm.academicDetail);
    expect(rows).toEqual([{
      creditRecord: expect.objectContaining({ id: "credit-1", rawTitle: "Calculus I" }),
      source: expect.objectContaining({ id: "source-1", title: "Official transcript" }),
      latestVerification,
      latestDecision,
      placements: [placement],
    }]);
    expect(rows[0].placements[0]).toMatchObject({
      status: "superseded",
      provenance: { evidenceExcerptId: "excerpt-1" },
      supersededByPlacementId: "placement-2",
    });
  });
  it("renders operator academic detail as read-only canonical presentation", async () => {
    useQueryMock.mockReturnValueOnce({
      isLoading: false,
      isError: false,
      data: {
        student: { id: "student-1", first_name: "Ada", last_name: "Lovelace", email: "ada@example.test" },
        assignment: { id: "assignment-1" },
        program: { id: "program-1", name: "Computer Science" },
        programVersion: { id: "version-1", versionLabel: "2025" },
        report: { status: "COMPOSED" },
        needsAttention: { groups: { manualReview: [], missing: [], partial: [], conflict: [] } },
        displayLabels: { requirements: { "requirement-1": { label: "Quantitative reasoning", source: "canonical" } } },
        academicDetail: {
          academicSources: [{ id: "source-1", title: "Official transcript", sourceType: "institution_transcript", status: "verified" }],
          creditRecords: [{ id: "credit-1", sourceId: "source-1", rawCourseCode: "MATH 101", rawTitle: "Calculus I", normalizedCredits: "3.00", status: "verified" }],
          latestVerifications: { "credit-1": { id: "verification-1", creditRecordId: "credit-1", action: "verified" } },
          latestDecisions: { "credit-1": { id: "decision-1", creditRecordId: "credit-1", action: "accepted", creditsAwarded: "3.00" } },
          placements: [
            { id: "placement-1", studentCreditDecisionId: "decision-1", requirementId: "requirement-1", status: "active", rationale: "Canonical placement", provenance: { sourceId: "source-1" } },
            { id: "placement-history", studentCreditDecisionId: "decision-older", requirementId: "requirement-1", status: "superseded", rationale: "Earlier recorded placement", provenance: { sourceId: "source-1" }, supersededByPlacementId: "placement-1" },
          ],
        },
      },
    } as any);
    const { default: AdminStudentWorkspace } = await import("@/pages/admin-student-workspace");
    const markup = renderToStaticMarkup(React.createElement(AdminStudentWorkspace));
    expect(markup).toContain("Operator academic detail");
    expect(markup).toContain("Official transcript");
    expect(markup).toContain("MATH 101");
    expect(markup).toContain("Latest verification");
    expect(markup).toContain("Latest decision");
    expect(markup).toContain("Quantitative reasoning");
    expect(markup).toContain("Lifecycle &amp; provenance");
    expect(markup).toContain("Historical placement records");
    expect(markup).toContain("Earlier recorded placement");
    expect(markup).toContain("Canonical view · controlled placement writes");
    expect(markup).toContain("Placement controls are disabled until a fresh canonical snapshot");
    expect(markup).toContain("No academic values are recomputed here");
    expect(markup).toContain("Add placement");
    expect(markup).toContain("Replace this placement");
    expect(markup).toContain("Revoke placement");
    expect(markup).toContain("disabled");
    expect(markup).toContain("Refresh workspace");
    expect(markup).toContain("Documents");
    expect(markup).toContain("Support");
    expect(markup).toContain("Loading…");
  });
  it("renders selected-student documents and support records without inventing records", async () => {
    useQueryMock.mockReturnValueOnce({
      isLoading: false,
      isError: false,
      data: {
        student: { id: "student-1", first_name: "Ada", last_name: "Lovelace" },
        report: { status: "COMPOSED" },
        needsAttention: { groups: { manualReview: [], missing: [], partial: [], conflict: [] } },
        displayLabels: {},
        academicDetail: {},
      },
    } as any);
    useDocumentsMock.mockReturnValueOnce({
      isLoading: false,
      isError: false,
      data: [{ id: "doc-1", file_name: "transcript.pdf", doc_type: "transcript", status: "verified", uploaded_at: "2025-01-01" }],
      refetch: vi.fn(),
    });
    useTicketsMock.mockReturnValueOnce({
      isLoading: false,
      isError: false,
      data: {
        tickets: [{ id: "ticket-1", ticket_number: "SUP-1", subject: "Enrollment question", category: "enrollment", priority: "medium", status: "open", created_at: "2025-01-02" }],
        pagination: { total: 1, limit: 50, offset: 0 },
      },
      refetch: vi.fn(),
    });
    const { default: AdminStudentWorkspace } = await import("@/pages/admin-student-workspace");
    const markup = renderToStaticMarkup(React.createElement(AdminStudentWorkspace));
    expect(useDocumentsMock).toHaveBeenCalledWith("student-1");
    expect(useTicketsMock).toHaveBeenCalledWith({ studentId: "student-1" });
    expect(markup).toContain("transcript.pdf");
    expect(markup).toContain("Enrollment question");
    expect(markup).not.toContain("demo");
    expect(markup).not.toContain("fake");
  });
  it("shows explicit empty and error/retry states for documents and support", async () => {
    useQueryMock.mockReturnValueOnce({
      isLoading: false,
      isError: false,
      data: {
        student: { id: "student-1" },
        report: { status: "COMPOSED" },
        needsAttention: { groups: { manualReview: [], missing: [], partial: [], conflict: [] } },
        displayLabels: {},
        academicDetail: {},
      },
    } as any);
    useDocumentsMock.mockReturnValueOnce({
      isLoading: false, isError: false, data: [], refetch: vi.fn(),
    });
    useTicketsMock.mockReturnValueOnce({
      isLoading: true, isError: false, data: undefined, refetch: vi.fn(),
    });
    const { default: AdminStudentWorkspace } = await import("@/pages/admin-student-workspace");
    const emptyMarkup = renderToStaticMarkup(React.createElement(AdminStudentWorkspace));
    expect(emptyMarkup.match(/No records are available for this student\./g)).toHaveLength(1);
    expect(emptyMarkup).toContain("Loading…");

    useQueryMock.mockReturnValueOnce({
      isLoading: false,
      isError: false,
      data: {
        student: { id: "student-1" },
        report: { status: "COMPOSED" },
        needsAttention: { groups: { manualReview: [], missing: [], partial: [], conflict: [] } },
        displayLabels: {},
        academicDetail: {},
      },
    } as any);
    const documentsRefetch = vi.fn();
    const ticketsRefetch = vi.fn();
    useDocumentsMock.mockReturnValueOnce({
      isLoading: false, isError: true, data: undefined, refetch: documentsRefetch,
    });
    useTicketsMock.mockReturnValueOnce({
      isLoading: false, isError: true, data: undefined, refetch: ticketsRefetch,
    });
    const errorMarkup = renderToStaticMarkup(React.createElement(AdminStudentWorkspace));
    expect(errorMarkup.match(/Could not load this section\./g)).toHaveLength(2);
    expect(errorMarkup.match(/Retry/g)).toHaveLength(2);
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
  it("configures the workspace page to refetch whenever it mounts", async () => {
    expect(ADMIN_STUDENT_WORKSPACE_QUERY_OPTIONS).toEqual({
      staleTime: 0,
      refetchOnMount: true,
    });
    const { default: AdminStudentWorkspace } = await import("@/pages/admin-student-workspace");
    renderToStaticMarkup(React.createElement(AdminStudentWorkspace));
    expect(useQueryMock).toHaveBeenCalledWith({
      queryKey: ["/api/admin/students/student-1/workspace"],
      staleTime: 0,
      refetchOnMount: true,
    });
    expect(useQueryMock.mock.calls[0][0]).not.toHaveProperty("refetchInterval");
  });
  it("defaults missing and invalid admin search values to Overview", () => {
    expect(adminTabFromSearch("")).toBe("overview");
    expect(adminTabFromSearch("?tab=unknown")).toBe("overview");
  });
  it("opens Students from the Back destination under Wouter and navigates tab changes", async () => {
    expect(ADMIN_STUDENTS_PATH).toBe("/admin?tab=students");
    useLocationMock.mockReturnValue(["/admin", setLocationMock]);
    useSearchMock.mockReturnValue(new URL(ADMIN_STUDENTS_PATH, "https://example.test").search);
    const { default: Admin } = await import("@/pages/admin");
    renderToStaticMarkup(React.createElement(Admin));
    const tabsProps = tabsPropsMock.mock.calls.at(-1)?.[0];
    expect(useLocationMock).toHaveBeenCalled();
    expect(useSearchMock).toHaveBeenCalled();
    expect(tabsProps.value).toBe("students");
    tabsProps.onValueChange("programs");
    expect(setLocationMock).toHaveBeenCalledWith("/admin?tab=programs");
  });
  it("keeps plain Admin on Overview under Wouter", async () => {
    useLocationMock.mockReturnValue(["/admin", setLocationMock]);
    useSearchMock.mockReturnValue("");
    const { default: Admin } = await import("@/pages/admin");
    renderToStaticMarkup(React.createElement(Admin));
    expect(tabsPropsMock.mock.calls.at(-1)?.[0].value).toBe("overview");
  });
});