import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AttachmentChips, DocumentPicker, SentAttachments, problemMessage, uploadChatAttachment, type ComposerAttachment, type UploadDeps } from "../client/src/components/academic-assistant/attachments";
import { makeTr } from "../client/src/components/academic-assistant/tr";
import {
  canAddDocument, formatBytes, newClientRequestId, planSend, sanitiseDocuments, sanitisePolicy, validateAttachmentFile, type AttachableDocument, type AttachmentPolicy,
} from "../client/src/components/academic-assistant/logic";

(globalThis as { React?: unknown }).React = React;
const MB = 1024 * 1024;
const policy: AttachmentPolicy = {
  types: [
    { ext: "pdf", mime: "application/pdf", maxBytes: 25 * MB },
    { ext: "png", mime: "image/png", maxBytes: 10 * MB },
    { ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", maxBytes: 25 * MB },
  ],
  maxPerMessage: 5, maxBytesPerMessage: 50 * MB, quotaBytes: 250 * MB, usedBytes: 100 * MB,
};
const file = (name: string, size: number, type = "application/pdf") => ({ name, size, type });
const none = { count: 0, bytes: 0 };

describe("S21 attachments: client pre-validation", () => {
  it("accepts an allowed file", () => {
    expect(validateAttachmentFile(file("transcript.pdf", 2 * MB), policy, none)).toBeNull();
    expect(validateAttachmentFile(file("scan.PNG", 1 * MB, "image/png"), policy, none)).toBeNull();
    expect(validateAttachmentFile(file("x.pdf", 1 * MB, ""), policy, none)).toBeNull(); // some browsers send no type
  });
  it("rejects by type (extension and mismatching mime) and empty files", () => {
    expect(validateAttachmentFile(file("run.exe", 1000, "application/x-msdownload"), policy, none)).toBe("type");
    expect(validateAttachmentFile(file("noext", 1000), policy, none)).toBe("type");
    expect(validateAttachmentFile(file("fake.pdf", 1000, "image/png"), policy, none)).toBe("type");
    expect(validateAttachmentFile(file("empty.pdf", 0), policy, none)).toBe("empty");
  });
  it("rejects by per-type size", () => {
    expect(validateAttachmentFile(file("big.png", 10 * MB + 1, "image/png"), policy, none)).toBe("size");
    expect(validateAttachmentFile(file("ok.png", 10 * MB, "image/png"), policy, none)).toBeNull();
  });
  it("max 5 per message", () => {
    expect(validateAttachmentFile(file("a.pdf", 1000), policy, { count: 4, bytes: 0 })).toBeNull();
    expect(validateAttachmentFile(file("a.pdf", 1000), policy, { count: 5, bytes: 0 })).toBe("count");
    expect(sanitisePolicy({ ...policy, maxPerMessage: 99 })!.maxPerMessage).toBe(5);
  });
  it("50 MB combined per message", () => {
    expect(validateAttachmentFile(file("a.pdf", 20 * MB), policy, { count: 2, bytes: 30 * MB })).toBeNull();
    expect(validateAttachmentFile(file("a.pdf", 20 * MB + 1), policy, { count: 2, bytes: 30 * MB })).toBe("total");
  });
  it("storage quota counts what is already used plus this composer's uploads", () => {
    expect(validateAttachmentFile(file("a.pdf", 20 * MB), policy, none, 130 * MB)).toBeNull();
    expect(validateAttachmentFile(file("a.pdf", 20 * MB + 1), policy, none, 130 * MB)).toBe("quota");
  });
  it("the same file name twice is a duplicate", () => {
    expect(validateAttachmentFile(file("a.pdf", 1000), policy, { count: 1, bytes: 1000, names: ["a.pdf"] })).toBe("duplicate");
  });
  it("stored documents: duplicate, count and combined size", () => {
    const d = { id: "d1", sizeBytes: 10 * MB };
    expect(canAddDocument(d, policy, { ids: [], bytes: 0 })).toBeNull();
    expect(canAddDocument(d, policy, { ids: ["d1"], bytes: 0 })).toBe("duplicate");
    expect(canAddDocument(d, policy, { ids: ["a", "b", "c", "e", "f"], bytes: 0 })).toBe("count");
    expect(canAddDocument(d, policy, { ids: ["a"], bytes: 45 * MB })).toBe("total");
    expect(canAddDocument(d, null, { ids: [], bytes: 0 })).toBeNull();
  });
  it("human messages in both languages name the file and the limit", () => {
    const en = makeTr("en");
    const fr = makeTr("fr");
    expect(problemMessage(en, "type", { name: "run.exe", policy, language: "en" })).toContain("PDF, PNG, DOCX");
    expect(problemMessage(en, "total", { name: "a", policy, language: "en" })).toContain("50 MB");
    expect(problemMessage(fr, "total", { name: "a", policy, language: "fr" })).toContain("50 Mo");
    expect(problemMessage(en, "count", { name: "a", policy, language: "en" })).toContain("up to 5 files");
  });
  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(50 * MB)).toBe("50 MB");
    expect(formatBytes(1536 * 1024, "fr")).toBe("1,5 Mo");
  });
  it("shapes the policy and document list defensively", () => {
    expect(sanitisePolicy({ types: "nope" })).toBeNull();
    expect(sanitisePolicy(null)).toBeNull();
    expect(sanitiseDocuments({ documents: [{ id: "d1", fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 5, source: "chat", extractionStatus: "indexed" }, { id: 4 }] })).toEqual([
      expect.objectContaining({ id: "d1", source: "chat", extractionStatus: "indexed" }),
    ]);
  });
});

describe("S21 attachments: upload flow", () => {
  it("upload-url, then PUT to the signed URL, then finalize, in that order", async () => {
    const calls: string[] = [];
    const deps: UploadDeps = {
      post: async (url, body) => {
        calls.push(`POST ${url} ${JSON.stringify(body)}`);
        if (url.endsWith("/upload-url")) return { uploadUrl: "https://storage.example/signed?token=1", uploadToken: "t", storagePath: "chat/u/abc.pdf", expiresIn: 60 } as never;
        return { document: { id: "doc-9", fileName: "transcript.pdf", mimeType: "application/pdf", sizeBytes: 2000, source: "chat", extractionStatus: "pending" } } as never;
      },
      put: async (url, f, type) => { calls.push(`PUT ${url} ${f.name} ${type}`); },
    };
    const f = new File([new Uint8Array(2000)], "transcript.pdf", { type: "application/pdf" });
    const doc = await uploadChatAttachment(f, policy, deps);
    expect(calls).toEqual([
      'POST /api/student/attachments/upload-url {"fileName":"transcript.pdf","sizeBytes":2000,"mimeType":"application/pdf"}',
      "PUT https://storage.example/signed?token=1 transcript.pdf application/pdf",
      'POST /api/student/attachments/finalize {"storagePath":"chat/u/abc.pdf","fileName":"transcript.pdf"}',
    ]);
    expect(doc).toMatchObject({ id: "doc-9", source: "chat", extractionStatus: "pending" });
  });
  it("a failed PUT never reaches finalize", async () => {
    const calls: string[] = [];
    const deps: UploadDeps = {
      post: async (url) => { calls.push(url); return { uploadUrl: "https://s.example/x", storagePath: "p" } as never; },
      put: async () => { throw new Error("403"); },
    };
    await expect(uploadChatAttachment(new File([new Uint8Array(10)], "a.pdf", { type: "application/pdf" }), policy, deps)).rejects.toThrow();
    expect(calls).toEqual(["/api/student/attachments/upload-url"]);
  });
});

describe("S21 attachments: idempotent send", () => {
  it("generates RFC 4122 style ids", () => {
    expect(newClientRequestId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(newClientRequestId()).not.toBe(newClientRequestId());
  });
  it("a retry of the same text and files reuses the clientRequestIds", () => {
    const first = planSend(null, "Where is my transcript?", ["d1", "d2"], "c1");
    const retry = planSend(first, "Where is my transcript?", ["d1", "d2"], "c1");
    expect(retry.messageRequestId).toBe(first.messageRequestId);
    expect(retry.createRequestId).toBe(first.createRequestId);
  });
  it("a new question, different files or another conversation is a new request", () => {
    const first = planSend(null, "A", ["d1"], "c1");
    expect(planSend(first, "B", ["d1"], "c1").messageRequestId).not.toBe(first.messageRequestId);
    expect(planSend(first, "A", ["d2"], "c1").messageRequestId).not.toBe(first.messageRequestId);
    expect(planSend(first, "A", ["d1", "d3"], "c1").messageRequestId).not.toBe(first.messageRequestId);
    expect(planSend(first, "A", ["d1"], "c2").messageRequestId).not.toBe(first.messageRequestId);
    expect(planSend(null, "A", ["d1"], "c1").messageRequestId).not.toBe(first.messageRequestId);
  });
  it("a first message retried before the conversation was created keeps both ids", () => {
    const first = planSend(null, "Hello", [], null);
    const retry = planSend(first, "Hello", [], null);
    expect(retry).toBe(first);
  });
  it("the container sends the id and the attachment ids exactly as the contract says", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("client/src/components/academic-assistant/index.tsx", "utf8");
    expect(src).toContain("clientRequestId: plan.messageRequestId");
    expect(src).toContain("attachmentDocumentIds: [...ids]");
    expect(src).toContain("clientRequestId: plan.createRequestId");
    expect(src).toContain("/api/documents/${encodeURIComponent(documentId)}");
  });
});

describe("S21 attachments: markup", () => {
  const tr = makeTr("en");
  const items: ComposerAttachment[] = [
    { key: "1", documentId: "d1", fileName: "transcript.pdf", mimeType: "application/pdf", sizeBytes: 2 * MB, state: "ready", source: "upload" },
    { key: "2", documentId: null, fileName: "scan.png", mimeType: "image/png", sizeBytes: 1000, state: "uploading", source: "upload" },
    { key: "3", documentId: null, fileName: "bad.pdf", mimeType: "application/pdf", sizeBytes: 1000, state: "failed", source: "upload" },
  ];
  it("chips are removable before send, show upload state and offer retry for failures", () => {
    const html = renderToStaticMarkup(createElement(AttachmentChips, { items, tr, language: "en", onRemove: () => {}, onRetry: () => {} }));
    expect(html.match(/data-testid="assistant-attachment-remove"/g)).toHaveLength(3);
    expect(html).toContain('aria-label="Remove transcript.pdf"');
    expect(html).toContain("Uploading scan.png");
    expect(html.match(/data-testid="assistant-attachment-retry"/g)).toHaveLength(1);
    expect(html).toContain("2.0 MB");
  });
  it("sent attachments open through a button (signed URL), not a raw link", () => {
    const html = renderToStaticMarkup(createElement(SentAttachments, { items: [{ documentId: "d1", fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 10 }], tr, language: "en", onOpen: () => {} }));
    expect(html).toContain("<button");
    expect(html).toContain('aria-label="Open a.pdf"');
    expect(html).not.toContain("href=");
  });
  const docs: AttachableDocument[] = [
    { id: "d1", fileName: "transcript.pdf", mimeType: "application/pdf", sizeBytes: 2 * MB, source: "documents", extractionStatus: "indexed" },
    { id: "d2", fileName: "chat-note.docx", mimeType: "x", sizeBytes: 1000, source: "chat", extractionStatus: "stored_only" },
  ];
  const picker = (over = {}) => renderToStaticMarkup(createElement(DocumentPicker, {
    tr, language: "en", state: "ready" as const, docs, policy, current: { ids: [], bytes: 0 }, selected: [], onToggle: () => {}, onConfirm: () => {}, onCancel: () => {}, onRetry: () => {}, ...over,
  }));
  it("picker lists both sources with their reading status; a document already attached is disabled", () => {
    const html = picker({ current: { ids: ["d1"], bytes: 2 * MB } });
    expect(html).toContain("My documents");
    expect(html).toContain("Chat upload");
    expect(html).toContain("The guide can read it");
    expect(html).toContain("Stored, not readable by the guide");
    expect(html).toMatch(/checked=""[^>]*disabled=""|disabled=""[^>]*checked=""/);
    expect(html).toContain("Attach selected (0)");
    expect(html).toMatch(/data-testid="assistant-picker-add"[^>]*disabled|disabled=""[^>]*data-testid="assistant-picker-add"/);
  });
  it("picker states: loading, error, empty", () => {
    expect(picker({ state: "loading", docs: [] })).toContain("Loading your documents");
    expect(picker({ state: "error", docs: [] })).toContain('role="alert"');
    expect(picker({ docs: [] })).toContain("no documents to attach yet");
  });
  it("picker stops offering documents once the message is full", () => {
    const html = picker({ current: { ids: ["a", "b", "c", "e", "f"], bytes: 0 } });
    expect(html).toContain("Cannot add");
  });
});
