import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { AcademicAssistant, AssistantPanelView, makeTr, type AssistantViewProps } from "../client/src/components/academic-assistant";
import {
  buildHistory, classifyFailure, isSafeExternalUrl, isSafeInternalPath, nextTrapTarget, normaliseMessage, sanitiseReply, MAX_MESSAGE_LENGTH, type ChatEntry,
} from "../client/src/components/academic-assistant/logic";
import { I18nProvider } from "../client/src/i18n";
import { ApiError } from "../client/src/lib/api";
import { assistantEn, assistantFr } from "../client/src/i18n/modules/assistant";

(globalThis as { React?: unknown }).React = React;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const STATUS = {
  enabled: true, liveModel: false, mode: "local" as const,
  suggestions: [{ id: "roadmap-how", en: "How does my roadmap work?", fr: "Comment fonctionne ma feuille de route ?" }],
};
const localAnswer: ChatEntry = {
  id: "a1", role: "assistant", mode: "local", text: "Your roadmap lists the courses you plan to take.",
  sources: [{ title: "Lumière roadmap guide", url: "https://example.org/guide", verifiedAt: "2026-10-27" }],
  links: [{ label: "My roadmap", path: "/roadmap" }], notice: "Please do not share personal information.",
};
const liveAnswer: ChatEntry = { id: "a2", role: "assistant", mode: "live", text: "Generated text.", sources: [], links: [] };

function view(over: Partial<AssistantViewProps> = {}, lang: "en" | "fr" = "en") {
  const props: AssistantViewProps = {
    language: lang, entries: [], status: STATUS, statusState: "ready", pending: false, failure: null, cooling: false, draft: "",
    onDraft: () => {}, onSend: () => {}, onRetry: () => {}, onRetryStatus: () => {}, onClear: () => {}, onClose: () => {}, ...over,
  };
  return renderToStaticMarkup(createElement(I18nProvider, { initialLanguage: lang }, createElement(Router, { ssrPath: "/" }, createElement(AssistantPanelView, props))));
}

describe("S20 assistant: closed / open shell", () => {
  const qc = new QueryClient();
  const render = (open: boolean, lang: "en" | "fr" = "en") =>
    renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(I18nProvider, { initialLanguage: lang }, createElement(Router, { ssrPath: "/" }, createElement(AcademicAssistant, { defaultOpen: open })))));
  it("closed: only the labelled crest button, collapsed, no dialog", () => {
    const html = render(false);
    expect(html).toContain('data-testid="assistant-fab"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Open the Lumière guide to ask a question"');
    expect(html).toContain('data-testid="img-lumiere-crest"');
    expect(html).not.toContain('role="dialog"');
  });
  it("open: modal dialog labelled by its title, with Close control", () => {
    const html = render(true);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toMatch(/aria-labelledby="[^"]+-title"/);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-label="Close the Lumière guide"');
    expect(html).toContain('maxLength="500"');
  });
  it("renders French", () => {
    const html = render(true, "fr");
    expect(html).toContain("Guide Lumière");
    expect(html).toContain("Demander à Lumière");
    expect(html).toContain("Fermer le guide Lumière");
    expect(html).not.toContain("Ask Lumière");
  });
});

describe("S20 assistant: content", () => {
  it("shows greeting, suggestions in the active language, and the disclaimer", () => {
    const en = view();
    expect(en).toContain("Hello, and welcome");
    expect(en).toContain("How does my roadmap work?");
    expect(en).toContain("educational guide");
    expect(en).toContain("does not replace Lumière staff or your awarding school");
    expect(en).toContain("do not share personal information");
    const fr = view({}, "fr");
    expect(fr).toContain("Comment fonctionne ma feuille de route");
    expect(fr).toContain("Ce guide est un outil pédagogique");
    expect(fr).toContain("ni l’équipe Lumière ni votre établissement d’accueil");
  });
  it("labels local answers honestly and never calls them AI", () => {
    const html = view({ entries: [localAnswer] });
    expect(html).toContain('data-mode="local"');
    expect(html).toContain("Lumière guide · local guidance");
    expect(html).toContain("not written by an AI model");
    expect(html).not.toContain("AI-assisted answer");
    const fr = view({ entries: [localAnswer] }, "fr");
    expect(fr).toContain("Guide Lumière · repères locaux");
    expect(fr).toContain("pas été rédigée par un modèle d’IA");
  });
  it("labels live answers as AI-assisted", () => {
    const html = view({ entries: [liveAnswer] });
    expect(html).toContain('data-mode="live"');
    expect(html).toContain("AI-assisted answer");
    expect(html).not.toContain("local guidance");
  });
  it("renders external sources (noopener, new tab) and portal links as in-app anchors, plus the server notice", () => {
    const html = view({ entries: [localAnswer] });
    expect(html).toContain('href="https://example.org/guide"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("checked ");
    expect(html).toContain('href="/roadmap"');
    expect(html).toContain("My roadmap");
    expect(html).toContain("Please do not share personal information.");
  });
  it("escapes reply text (no HTML injection)", () => {
    const html = view({ entries: [{ ...liveAnswer, text: "<img src=x onerror=alert(1)>" }] });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});

describe("S20 assistant: states", () => {
  it("loading shows the thinking indicator and disables send", () => {
    const html = view({ pending: true, draft: "hello" });
    expect(html).toContain('data-testid="assistant-thinking"');
    expect(html).toMatch(/data-testid="assistant-send"[^>]*disabled|disabled=""[^>]*data-testid="assistant-send"/);
  });
  it("429 shows the throttled alert with retry, input disabled while cooling", () => {
    const html = view({ failure: { kind: "throttled", text: "q" }, cooling: true });
    expect(html).toContain('data-testid="assistant-throttled"');
    expect(html).toContain("asking quickly");
    expect(html).toContain('data-testid="assistant-retry"');
    expect(html).toMatch(/<textarea[^>]*disabled/);
  });
  it("503 shows unavailable with retry and a Support link", () => {
    const html = view({ failure: { kind: "unavailable", text: "q" } });
    expect(html).toContain('data-testid="assistant-unavailable"');
    expect(html).toContain("not available right now");
    expect(html).toContain('href="/support"');
    expect(view({ failure: { kind: "unavailable", text: "q" } }, "fr")).toContain("n’est pas disponible");
  });
  it("generic error offers retry", () => {
    const html = view({ failure: { kind: "error", text: "q" } });
    expect(html).toContain('data-testid="assistant-error"');
    expect(html).toContain("Try again");
  });
  it("status failure or enabled:false disables the composer and explains", () => {
    for (const over of [{ statusState: "error" as const, status: undefined }, { status: { ...STATUS, enabled: false } }]) {
      const html = view(over);
      expect(html).toContain('data-testid="assistant-status-unavailable"');
      expect(html).toMatch(/<textarea[^>]*disabled/);
    }
  });
});

describe("S20 assistant: logic", () => {
  it("classifies API failures", () => {
    expect(classifyFailure(new ApiError("x", 429, "throttled"))).toBe("throttled");
    expect(classifyFailure(new ApiError("x", 503, "unavailable"))).toBe("unavailable");
    expect(classifyFailure(new ApiError("x", 500))).toBe("error");
    expect(classifyFailure(new Error("network"))).toBe("error");
  });
  it("normalises and caps messages at 500", () => {
    expect(normaliseMessage("   \n  ")).toBe("");
    expect(normaliseMessage("a".repeat(900)).length).toBe(MAX_MESSAGE_LENGTH);
    expect(normaliseMessage("a\n\n\n\nb")).toBe("a\n\nb");
  });
  it("keeps the last 6 turns, truncated", () => {
    const entries: ChatEntry[] = Array.from({ length: 9 }, (_, i) => ({ id: String(i), role: "user", text: "x".repeat(900) }));
    const h = buildHistory(entries);
    expect(h).toHaveLength(6);
    expect(h[0]!.content).toHaveLength(400);
  });
  it("only allows safe link targets", () => {
    expect(isSafeInternalPath("/roadmap")).toBe(true);
    for (const bad of ["//evil.com", "https://evil.com", "javascript:alert(1)", "roadmap", "/a b"]) expect(isSafeInternalPath(bad)).toBe(false);
    expect(isSafeExternalUrl("https://a.org/x")).toBe(true);
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
  });
  it("sanitiseReply drops malformed links/sources and defaults unknown mode to local", () => {
    const r = sanitiseReply({
      reply: "ok", mode: "weird",
      sources: [{ title: "t", url: "javascript:x" }, { title: "ok", url: "https://a.org" }],
      links: [{ label: "bad", path: "//x" }, { label: "good", path: "/support" }],
    });
    expect(r.mode).toBe("local");
    expect(r.sources).toHaveLength(1);
    expect(r.links).toEqual([{ label: "good", path: "/support" }]);
    expect(() => sanitiseReply({ reply: "  " })).toThrow();
  });
  it("focus trap wraps Tab at the ends and pulls stray focus in", () => {
    const f = ["a", "b", "c"];
    expect(nextTrapTarget(f, "c", false)).toBe("a");
    expect(nextTrapTarget(f, "a", true)).toBe("c");
    expect(nextTrapTarget(f, "b", false)).toBeNull();
    expect(nextTrapTarget(f, null, false)).toBe("a");
    expect(nextTrapTarget(f, null, true)).toBe("c");
    expect(nextTrapTarget([], null, false)).toBeNull();
  });
});

describe("S20 assistant: i18n + theming + a11y contracts", () => {
  it("EN/FR modules have identical keys and differing values", () => {
    expect(Object.keys(assistantFr).sort()).toEqual(Object.keys(assistantEn).sort());
    for (const k of Object.keys(assistantEn) as (keyof typeof assistantEn)[]) expect(assistantFr[k], k).not.toBe(assistantEn[k]);
  });
  it("makeTr interpolates and applies French typography", () => {
    expect(makeTr("en")("assistant.counter", { n: 3, max: 500 })).toBe("3 of 500 characters");
    expect(makeTr("fr")("assistant.greeting")).toContain("savoir ?");
  });
  it("CSS uses theme tokens only, honours reduced motion and has no hard-coded colours", () => {
    const css = read("client/src/styles/academic-assistant.css");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain("var(--t-accent");
    expect(css).toContain("env(safe-area-inset-bottom");
    expect(css).toContain("100dvh");
  });
  it("component wiring: Escape + focus return + external rel", () => {
    const src = read("client/src/components/academic-assistant/index.tsx");
    expect(src).toContain('ev.key === "Escape"');
    expect(src).toContain("fabRef.current?.focus");
    expect(src).toContain('rel="noopener noreferrer"');
    expect(src).not.toContain("dangerouslySetInnerHTML");
  });
});
