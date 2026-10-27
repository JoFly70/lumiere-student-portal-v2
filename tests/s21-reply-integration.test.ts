/** S21 Opus integration: private context is appended locally, never passed to the public answer path. */
import { describe, expect, it, vi } from "vitest";
import { composeWithPrivateContext, createIntegratedGenerateReply, type GeneratedReply } from "../server/services/assistant-conversations/reply";

const base: GeneratedReply = { content: "Public answer.", mode: "local", sources: [{ title: "T", url: "https://x", verifiedAt: null }], links: [], notice: null, privateRefs: [] };

describe("S21 reply pipeline integration", () => {
  it("appends labelled private items with deep links and records them as privateRefs", () => {
    const out = composeWithPrivateContext(base, [
      { kind: "memory", title: "Intended major: communications", snippet: "I want to study communications", path: "/assistant?memory=m1", label: "You told us" },
      { kind: "document", title: "transcript.pdf", snippet: "Biology 9 A", path: "/documents", label: "Found in your document" },
    ], "en", "c1");
    expect(out.content).toContain("From your records (private, not sent to any AI model):");
    expect(out.content).toContain("Found in your document: transcript.pdf");
    expect(out.privateRefs).toEqual([
      { kind: "memory", title: "Intended major: communications", path: "/assistant?memory=m1" },
      { kind: "document", title: "transcript.pdf", path: "/documents" },
    ]);
  });
  it("does not cite the current conversation to itself and caps at 3 items", () => {
    const items = [
      { kind: "message", title: "same", snippet: "", path: "/assistant?conversation=c1" },
      ...[1, 2, 3, 4].map((n) => ({ kind: "message", title: `m${n}`, snippet: "", path: `/assistant?conversation=other${n}` })),
    ];
    const out = composeWithPrivateContext(base, items, "fr", "c1");
    expect(out.privateRefs.map((r) => r.title)).toEqual(["m1", "m2", "m3"]);
    expect(out.content).toContain("Dans votre dossier");
  });
  it("offers Support when neither public sources nor private items ground the answer", () => {
    const out = composeWithPrivateContext({ ...base, sources: [] }, [], "en", "c1");
    expect(out.links).toContainEqual({ label: "Contact Support", path: "/support" });
  });
  it("the public answer receives only the message and recent turns; retrieval failure degrades gracefully", async () => {
    const publicFn = vi.fn(async () => base);
    const gen = createIntegratedGenerateReply({ base: publicFn, retrievePrivate: async () => { throw new Error("db down"); }, logger: { warn: () => {} } });
    const args = { user: { id: "u1", role: "student" }, conversationId: "c1", message: "hello", language: "en" as const, recentTurns: [] };
    const out = await gen(args);
    expect(publicFn).toHaveBeenCalledWith(args);
    expect(out.privateRefs).toEqual([]);
  });
});
