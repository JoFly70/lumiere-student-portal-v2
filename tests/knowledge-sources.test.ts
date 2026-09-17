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
    return { isLoading: false, isError: false, data: { items: queryState.mode === "empty" ? [] : [{ id: "source-1", title: "Real Catalog", sourceType: "official_catalog", lifecycleStatus: "pending_review", academicYear: "2025-2026", versionLabel: "v1", externalFileId: null }] }, refetch: vi.fn() };
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/api", () => ({ apiRequest: vi.fn() }));

import { KnowledgeSources, operationLabel, canRetryOperation, openSignedDownload, sourceQueryKey, paginationState, resetPaginationForInstitutionFilter } from "../client/src/components/knowledge-sources";

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
  it("builds fixed-size paged queries and preserves institution filtering", () => {
    expect(sourceQueryKey("all", 0)).toEqual(["/api/admin/knowledge/evidence-sources", { institutionId: undefined, limit: 50, offset: 0 }]);
    expect(sourceQueryKey("inst-1", 2)).toEqual(["/api/admin/knowledge/evidence-sources", { institutionId: "inst-1", limit: 50, offset: 100 }]);
  });
  it("keeps exact terminal-page navigation recoverable", () => {
    expect(paginationState(0, 50)).toMatchObject({ hasNext: true, hasPrevious: false });
    expect(paginationState(1, 0)).toMatchObject({ hasNext: false, hasPrevious: true, page: 1 });
    expect(resetPaginationForInstitutionFilter()).toBe(0);
    expect(sourceQueryKey("inst-1", resetPaginationForInstitutionFilter())).toEqual([
      "/api/admin/knowledge/evidence-sources", { institutionId: "inst-1", limit: 50, offset: 0 },
    ]);
  });
  it("opens a placeholder before awaiting and navigates after signing", async () => {
    let resolve!: (value: { download_url: string }) => void;
    const events: string[] = [];
    const request = vi.fn(() => { events.push(`request:${popup.opener === null}`); return new Promise<{ download_url: string }>((r) => { resolve = r; }); });
    const popup: any = { location: { href: "about:blank" }, close: vi.fn(), opener: {} };
    const open = vi.fn((url?: string, target?: string) => { events.push("open"); return popup; });
    const opened = openSignedDownload(request, open);
    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(events).toEqual(["open", "request:true"]);
    expect(popup.location.href).toBe("about:blank");
    resolve({ download_url: "https://signed" });
    await opened;
    expect(popup.location.href).toBe("https://signed");
    const blockedRequest = vi.fn();
    await expect(openSignedDownload(blockedRequest, vi.fn(() => null))).rejects.toThrow(/Popup was blocked/);
    expect(blockedRequest).not.toHaveBeenCalled();
    await expect(openSignedDownload(async () => { throw new Error("failed"); }, vi.fn(() => popup))).rejects.toThrow("failed");
    expect(popup.close).toHaveBeenCalled();
  });
});