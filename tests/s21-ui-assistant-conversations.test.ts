import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { AcademicAssistant, AssistantPanelView, type AssistantFeatures, type AssistantViewProps } from "../client/src/components/academic-assistant";
import { HistoryView, type HistoryViewProps } from "../client/src/components/academic-assistant/history";
import { makeTr } from "../client/src/components/academic-assistant/tr";
import {
  assistantDeepLink, classifyFailure, conversationFromLocation, displayTitle, needsSupportEscalation, normaliseTitle, rovingIndex, sanitiseConversation,
  sanitiseConversationList, sanitiseHits, sanitiseMessage, sanitiseMessages, sortConversations, titleFromMessage, type ChatEntry, type ConversationSummary,
} from "../client/src/components/academic-assistant/logic";
import { I18nProvider } from "../client/src/i18n";
import { ApiError } from "../client/src/lib/api";

(globalThis as { React?: unknown }).React = React;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const C = (id: string, over: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id, title: `Title ${id}`, createdAt: "2026-10-01T10:00:00Z", lastActivityAt: "2026-10-01T10:00:00Z", archived: false, messageCount: 2, lastMessagePreview: "preview", ...over,
});
const STATUS = { enabled: true, liveModel: false, mode: "local" as const, suggestions: [] };
const noop = () => {};

function historyProps(over: Partial<HistoryViewProps> = {}): Omit<HistoryViewProps, "tr" | "language"> {
  return {
    conversations: [], listState: "ready", filter: "active", activeId: null, query: "", hits: [], searchState: "idle", actionError: null,
    onQuery: noop, onFilter: noop, onSelect: noop, onNew: noop, onRename: noop, onArchive: noop, onRetry: noop, ...over,
  };
}
function features(over: Partial<AssistantFeatures> = {}): AssistantFeatures {
  return {
    panel: "chat", conversationTitle: null, conversationArchived: false, conversationState: "idle", history: historyProps(),
    picker: { state: "ready", docs: [], selected: [], onToggle: noop, onConfirm: noop, onCancel: noop, onRetry: noop },
    attach: { items: [], policy: null, problem: null, menuOpen: false, onToggleMenu: noop, onUploadClick: noop, onChoose: noop, onRemove: noop, onRetry: noop, onFiles: noop, busy: false },
    onOpenHistory: noop, onBack: noop, onRestore: noop, onOpenAttachment: noop, attachmentError: null, ...over,
  };
}
function view(over: Partial<AssistantViewProps> = {}, lang: "en" | "fr" = "en") {
  const props: AssistantViewProps = {
    language: lang, entries: [], status: STATUS, statusState: "ready", pending: false, failure: null, cooling: false, draft: "",
    onDraft: noop, onSend: noop, onRetry: noop, onRetryStatus: noop, onClear: noop, onClose: noop, features: features(), ...over,
  };
  return renderToStaticMarkup(createElement(I18nProvider, { initialLanguage: lang }, createElement(Router, { ssrPath: "/" }, createElement(AssistantPanelView, props))));
}
function history(over: Partial<HistoryViewProps> = {}, lang: "en" | "fr" = "en") {
  const tr = makeTr(lang);
  return renderToStaticMarkup(createElement(Router, { ssrPath: "/" }, createElement(HistoryView, { tr, language: lang, ...historyProps(), ...over })));
}

describe("S21 conversations: data shaping", () => {
  it("lists newest activity first", () => {
    const list = sortConversations([C("a", { lastActivityAt: "2026-10-01T10:00:00Z" }), C("b", { lastActivityAt: "2026-10-20T10:00:00Z" }), C("c", { lastActivityAt: "2026-10-10T10:00:00Z" })]);
    expect(list.map((c) => c.id)).toEqual(["b", "c", "a"]);
    const parsed = sanitiseConversationList({ conversations: [{ id: "x", title: "Old", lastActivityAt: "2026-01-01T00:00:00Z" }, { id: "y", title: "New", lastActivityAt: "2026-02-01T00:00:00Z", archived: true }, { nope: 1 }] });
    expect(parsed.map((c) => c.id)).toEqual(["y", "x"]);
    expect(parsed[0]!.archived).toBe(true);
    expect(sanitiseConversation(null)).toBeNull();
    expect(sanitiseConversationList(undefined)).toEqual([]);
  });
  it("titles: fallback to the preview, never blank; rename input is trimmed, capped and rejects blank", () => {
    expect(displayTitle({ title: "  ", lastMessagePreview: "How does my roadmap work today?" }, "Untitled")).toBe("How does my roadmap work today?");
    expect(displayTitle({ title: "", lastMessagePreview: null }, "Untitled")).toBe("Untitled");
    expect(normaliseTitle("   ")).toBeNull();
    expect(normaliseTitle("  My   plan \n for fall ")).toBe("My plan for fall");
    expect(normaliseTitle("x".repeat(300))!.length).toBe(120);
    expect(titleFromMessage("short")).toBe("short");
    expect(titleFromMessage("w".repeat(100)).length).toBe(58);
  });
  it("search hits keep only well-formed rows", () => {
    const hits = sanitiseHits({ hits: [{ conversationId: "c1", conversationTitle: "T", messageId: "m1", role: "student", snippet: "roadmap", createdAt: "2026-10-01" }, { conversationId: 3 }] });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ conversationId: "c1", snippet: "roadmap" });
  });
  it("maps stored messages: student/assistant only, local unless explicitly live, attachments and private refs kept", () => {
    const entries = sanitiseMessages({
      messages: [
        { id: "m1", seq: 1, role: "student", content: "Hi", attachments: [{ documentId: "d1", fileName: "transcript.pdf", mimeType: "application/pdf", sizeBytes: 1200 }, { bad: true }] },
        { id: "m2", seq: 2, role: "assistant", content: "Answer", mode: null, sources: [{ title: "S", url: "https://example.org/a", verifiedAt: "2026-10-01" }, { title: "bad", url: "javascript:x" }], links: [{ label: "Roadmap", path: "/roadmap" }, { label: "bad", path: "//x" }], privateRefs: [{ kind: "document", title: "My transcript", path: "/documents" }, { kind: "x", title: "bad", path: "https://evil.example" }], notice: "Careful" },
        { id: "m3", seq: 3, role: "system", content: "internal" },
        { id: "m4", seq: 4, role: "assistant", content: "Live one", mode: "live" },
      ],
    });
    expect(entries.map((e) => e.id)).toEqual(["m1", "m2", "m4"]);
    const user = entries[0] as Extract<ChatEntry, { role: "user" }>;
    expect(user.attachments).toEqual([{ documentId: "d1", fileName: "transcript.pdf", mimeType: "application/pdf", sizeBytes: 1200 }]);
    const a = entries[1] as Extract<ChatEntry, { role: "assistant" }>;
    expect(a.mode).toBe("local");
    expect(a.sources).toHaveLength(1);
    expect(a.links).toEqual([{ label: "Roadmap", path: "/roadmap" }]);
    expect(a.privateRefs).toEqual([{ kind: "document", title: "My transcript", path: "/documents" }]);
    expect((entries[2] as Extract<ChatEntry, { role: "assistant" }>).mode).toBe("live");
    expect(sanitiseMessage({ id: "z", role: "robot", content: "x" })).toBeNull();
  });
  it("escalates to Support only when an answer has neither a source nor a record reference", () => {
    const base = { id: "a", role: "assistant" as const, text: "t", mode: "local" as const, links: [] };
    expect(needsSupportEscalation({ ...base, sources: [] })).toBe(true);
    expect(needsSupportEscalation({ ...base, sources: [{ title: "s", url: "https://example.org" }] })).toBe(false);
    expect(needsSupportEscalation({ ...base, sources: [], privateRefs: [{ kind: "document", title: "d", path: "/documents" }] })).toBe(false);
  });
  it("deep links: /assistant?conversation=<id>", () => {
    expect(assistantDeepLink("abc-12345678")).toBe("/assistant?conversation=abc-12345678");
    expect(conversationFromLocation("/assistant", "?conversation=abc-12345678")).toBe("abc-12345678");
    expect(conversationFromLocation("/assistant", "conversation=abc-12345678")).toBe("abc-12345678");
    expect(conversationFromLocation("/roadmap", "?conversation=abc-12345678")).toBeNull();
    expect(conversationFromLocation("/assistant", "?conversation=../../etc")).toBeNull();
    expect(conversationFromLocation("/assistant", "")).toBeNull();
  });
  it("classifies archived (409) and rejected attachments (422)", () => {
    expect(classifyFailure(new ApiError("x", 409, "archived"))).toBe("archived");
    expect(classifyFailure(new ApiError("x", 422, "attachment_rejected"))).toBe("attachment");
  });
  it("roving focus wraps and supports Home/End", () => {
    expect(rovingIndex("ArrowDown", 2, 3)).toBe(0);
    expect(rovingIndex("ArrowUp", 0, 3)).toBe(2);
    expect(rovingIndex("Home", 1, 3)).toBe(0);
    expect(rovingIndex("End", 1, 3)).toBe(2);
    expect(rovingIndex("a", 1, 3)).toBeNull();
    expect(rovingIndex("ArrowDown", 0, 0)).toBeNull();
  });
});

describe("S21 conversations: history panel", () => {
  it("lists conversations with title, preview, count and rename / archive controls; marks the open one", () => {
    const html = history({ conversations: [C("a", { title: "Transfer credits" }), C("b", { title: "Documents", archived: false })], activeId: "b" });
    expect(html).toContain('data-testid="assistant-conversation-list"');
    expect(html.match(/data-testid="assistant-conversation"/g)).toHaveLength(2);
    expect(html).toContain("Transfer credits");
    expect(html).toContain("2 messages in total");
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("Open now");
    expect(html).toContain('aria-label="Rename “Transfer credits”"');
    expect(html).toContain('aria-label="Archive “Transfer credits”"');
    expect(html).toContain('data-testid="assistant-history-new"');
    expect(html).toContain('type="search"');
  });
  it("archived filter: restore control and the archived badge; its own empty state", () => {
    const html = history({ filter: "archived", conversations: [C("a", { archived: true })] });
    expect(html).toContain('aria-label="Restore “Title a”"');
    expect(html).toContain("Archived");
    expect(history({ filter: "archived" })).toContain("No archived conversations.");
    expect(history({ filter: "archived" })).toMatch(/aria-pressed="true"[^>]*data-testid="assistant-filter-archived"/);
  });
  it("states: loading, error with retry, empty", () => {
    expect(history({ listState: "loading" })).toContain("Loading your conversations");
    const err = history({ listState: "error" });
    expect(err).toContain('role="alert"');
    expect(err).toContain("Try again");
    expect(history()).toContain("No conversations yet");
  });
  it("search: too short, loading, no match, and hits that resume the conversation", () => {
    expect(history({ query: "a" })).toContain("at least 2 characters");
    expect(history({ query: "roadmap", searchState: "loading" })).toContain("Searching");
    expect(history({ query: "roadmap", searchState: "ready", hits: [] })).toContain("No conversation matches “roadmap”.");
    const hits = history({ query: "roadmap", searchState: "ready", hits: [{ conversationId: "c1", conversationTitle: "Planning", messageId: "m1", role: "student", snippet: "my roadmap", createdAt: "2026-10-01T00:00:00Z" }] });
    expect(hits).toContain('data-testid="assistant-search-hits"');
    expect(hits).toContain("Planning");
    expect(hits).toContain("my roadmap");
    expect(hits).toContain("You");
    expect(hits).not.toContain("assistant-filter-active");
  });
  it("French", () => {
    const html = history({ conversations: [C("a", { archived: true })], filter: "archived" }, "fr");
    expect(html).toContain("Restaurer");
    expect(html).toContain("Archivées");
    expect(html).toContain("Nouvelle conversation");
  });
});

describe("S21 conversations: the drawer", () => {
  it("opens a saved conversation: its title replaces the subtitle, no greeting, and records are labelled", () => {
    const entries: ChatEntry[] = [
      { id: "u1", role: "user", text: "Where is my transcript?", attachments: [{ documentId: "d1", fileName: "transcript.pdf", mimeType: "application/pdf", sizeBytes: 2048 }] },
      { id: "a1", role: "assistant", mode: "local", text: "It is under Documents.", sources: [], links: [{ label: "Documents", path: "/documents" }], privateRefs: [{ kind: "document", title: "transcript.pdf", path: "/documents" }] },
      { id: "a2", role: "assistant", mode: "live", text: "General note", sources: [], links: [] },
    ];
    const html = view({ entries, features: features({ conversationTitle: "Transcript question" }) });
    expect(html).toContain('data-testid="assistant-subtitle">Transcript question<');
    expect(html).not.toContain('data-testid="assistant-greeting"');
    expect(html).toContain("From your records");
    expect(html).toContain('data-testid="assistant-private-refs"');
    expect(html).toContain('data-testid="assistant-sent-attachment"');
    expect(html).toContain("transcript.pdf");
    expect(html).toContain("2.0 KB");
    // local vs AI labelling is unchanged
    expect(html).toContain("Lumière guide · local guidance");
    expect(html).toContain("AI-assisted answer");
    // a sourceless answer offers Support; the grounded one does not
    expect(html.match(/data-testid="assistant-escalate"/g)).toHaveLength(1);
    expect(html).toContain('href="/support"');
  });
  it("history and picker are views inside the dialog, with a Back control; the composer is hidden, not removed", () => {
    const h = view({ features: features({ panel: "history" }) });
    expect(h).toContain('data-panel="history"');
    expect(h).toContain('data-testid="assistant-back"');
    expect(h).toContain('data-testid="assistant-history"');
    expect(h).toMatch(/<footer class="aa-foot" hidden/);
    expect(view({ features: features({ panel: "picker" }) })).toContain('data-testid="assistant-picker"');
    expect(view()).toContain('data-testid="assistant-history-btn"');
    expect(view()).toContain('aria-label="Show your earlier conversations"');
  });
  it("an archived conversation cannot be continued until restored", () => {
    const html = view({ features: features({ conversationTitle: "Old", conversationArchived: true }) });
    expect(html).toContain('data-testid="assistant-archived-notice"');
    expect(html).toContain("Restore and continue");
    expect(html).not.toContain('data-testid="assistant-input"');
  });
  it("French greeting and labels", () => {
    const html = view({}, "fr");
    expect(html).toContain("Bonjour et bienvenue");
    expect(html).toContain("Afficher vos conversations précédentes");
  });
  it("the live region and the focus trap are kept; reduced motion and a 360px composer are styled", () => {
    const html = view();
    expect(html).toContain('role="log"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-modal="true"');
    const css = read("client/src/styles/academic-assistant.css");
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain("max-width: 420px");
    const src = read("client/src/components/academic-assistant/index.tsx");
    expect(src).toContain("nextTrapTarget");
    expect(src).toContain("ASSISTANT_OPEN_EVENT");
    expect(src).toContain("/api/assistant/conversations");
  });
  it("closed container renders only the button (S20 contract holds with the S21 queries)", () => {
    const qc = new QueryClient();
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(I18nProvider, { initialLanguage: "en" }, createElement(Router, { ssrPath: "/" }, createElement(AcademicAssistant, { defaultOpen: false })))));
    expect(html).toContain('data-testid="assistant-fab"');
    expect(html).not.toContain('role="dialog"');
  });
});
