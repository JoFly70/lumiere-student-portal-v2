import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const queryState = vi.hoisted(() => ({ mode: "ready" }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryState.mode === "loading") return { isLoading: true, isError: false };
    if (queryState.mode === "error") return { isLoading: false, isError: true, refetch: vi.fn() };
    if (queryKey[0].includes("institutions")) return { isLoading: false, isError: false, data: { institutions: [] }, refetch: vi.fn() };
    return { isLoading: false, isError: false, data: { items: queryState.mode === "empty" ? [] : [{ id: "source-1", title: "Real Catalog", sourceType: "official_catalog", lifecycleStatus: "pending_review", academicYear: 2025, versionLabel: "v1", externalFileId: null }] }, refetch: vi.fn() };
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/api", () => ({ apiRequest: vi.fn() }));

import { KnowledgeSources, operationLabel, canRetryOperation } from "../client/src/components/knowledge-sources";

const view = () => renderToStaticMarkup(React.createElement(KnowledgeSources));
describe("KnowledgeSources rendered states", () => {
  beforeEach(() => { queryState.mode = "ready"; });
  it("renders loading state", () => { queryState.mode = "loading"; expect(view()).toContain("Loading Knowledge sources"); });
  it("renders empty state without fake rows", () => { queryState.mode = "empty"; const html = view(); expect(html).toContain("No evidence sources found"); expect(html).not.toContain("Real Catalog"); });
  it("renders load error and Retry", () => { queryState.mode = "error"; const html = view(); expect(html).toContain("Unable to load Knowledge sources"); expect(html).toContain("Retry"); });
  it("renders a real source row and editing controls", () => { const html = view(); expect(html).toContain("Real Catalog"); expect(html).toContain("Upload PDF"); expect(html).toContain("Academic year"); });
  it("uses operation-specific pending labels and retry decisions", () => {
    expect(operationLabel("upload", false)).toBe("Upload PDF");
    expect(operationLabel("upload", true)).toBe("Uploading…");
    expect(operationLabel("download", false)).toBe("View / download");
    expect(operationLabel("download", true)).toBe("Opening…");
    expect(canRetryOperation("upload", true)).toBe(true);
    expect(canRetryOperation("download", false)).toBe(false);
  });
});