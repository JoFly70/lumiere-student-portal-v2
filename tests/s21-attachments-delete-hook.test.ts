import { beforeEach, describe, expect, it, vi } from "vitest";

const invalidate = vi.hoisted(() => vi.fn(async () => {}));
const fromMock = vi.hoisted(() => vi.fn());
const deleteObject = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../server/services/chat-attachments/invalidate", () => ({ invalidateDocumentIndex: invalidate }));
vi.mock("../server/lib/supabase", () => ({ supabaseAdmin: { from: fromMock, storage: { from: () => ({}) } }, isSupabaseConfigured: () => true }));
vi.mock("../server/services/student-service", () => ({ getStudent: vi.fn(), getStudentByUserId: vi.fn() }));
vi.mock("../server/lib/audit", () => ({ writeAuditLog: vi.fn(() => Promise.resolve()), auditDocument: vi.fn() }));
vi.mock("../server/lib/document-storage", () => ({ documentStorage: { deleteDocument: deleteObject } }));

function chain(result: { data: unknown; error: unknown }) {
  const q: any = {};
  for (const m of ["select", "eq", "update", "delete"]) q[m] = vi.fn(() => q);
  q.single = vi.fn(() => Promise.resolve(result));
  q.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
  return q;
}

describe("S21: document delete paths invalidate the text index", () => {
  beforeEach(() => {
    invalidate.mockClear();
    fromMock.mockReset();
  });

  it("softDeleteDocument drops the index after the row is soft-deleted", async () => {
    const doc = { id: "d1", student_id: "s1", status: "pending", doc_type: "chat_attachment", storage_path: "p" };
    fromMock.mockReturnValueOnce(chain({ data: doc, error: null })).mockReturnValueOnce(chain({ data: null, error: null }));
    const { softDeleteDocument } = await import("../server/services/document-service");
    await softDeleteDocument("d1", null);
    expect(invalidate).toHaveBeenCalledWith("d1");
  });

  it("softDeleteDocument does not invalidate when the update fails", async () => {
    const doc = { id: "d2", student_id: "s1", status: "pending", doc_type: "other", storage_path: "p" };
    fromMock.mockReturnValueOnce(chain({ data: doc, error: null })).mockReturnValueOnce(chain({ data: null, error: new Error("boom") }));
    const { softDeleteDocument } = await import("../server/services/document-service");
    await expect(softDeleteDocument("d2", null)).rejects.toThrow("boom");
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("hardDeleteDocument drops the index too", async () => {
    const doc = { id: "d3", student_id: "s1", status: "pending", doc_type: "other", storage_path: "students/X/other/1700000000000_a.pdf" };
    fromMock.mockReturnValueOnce(chain({ data: doc, error: null })).mockReturnValueOnce(chain({ data: null, error: null }));
    const { hardDeleteDocument } = await import("../server/services/document-service");
    await hardDeleteDocument("d3");
    expect(invalidate).toHaveBeenCalledWith("d3");
  });
});
