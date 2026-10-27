/** S21 Opus: "What Lumière remembers" panel (review / correct / retract), deep link and /assistant route. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { describe, expect, it } from "vitest";
import { MemoryView, sanitiseMemory, type MemoryViewProps } from "../client/src/components/academic-assistant/memory";
import { makeTr } from "../client/src/components/academic-assistant/tr";
import { deepLinkFromSearch } from "../client/src/components/academic-assistant/logic";

(globalThis as { React?: unknown }).React = React;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const noop = async () => {};
const RAW = { items: [
  { id: "m1", category: "intended_major", statement: "Intended major: communications", status: "active", basis: "student_reported",
    sources: [{ kind: "message", id: "x", path: "/assistant?conversation=c1", excerpt: "I want to study communications", createdAt: "2026-10-27T10:00:00Z" }], createdAt: "", updatedAt: "" },
  { id: "m0", category: "intended_major", statement: "Intended major: biology", status: "superseded", basis: "student_reported", sources: [] },
  { id: "bad", statement: 3 },
  { id: "m2", category: "x", statement: "Evil link", status: "active", basis: "student_reported", sources: [{ kind: "message", path: "https://evil.example", excerpt: null }] },
] };
const view = (lang: "en" | "fr", over: Partial<MemoryViewProps> = {}) => renderToStaticMarkup(
  React.createElement(Router, { ssrPath: "/" }, React.createElement(MemoryView, {
    tr: makeTr(lang), language: lang, state: "ready", items: sanitiseMemory(RAW), highlightId: "m1", actionError: null,
    onCorrect: noop, onRetract: noop, onRetry: () => {}, ...over,
  })),
);

describe("S21 memory panel", () => {
  it("sanitises items, drops malformed rows and unsafe (external) source links", () => {
    const items = sanitiseMemory(RAW);
    expect(items.map((i) => i.id)).toEqual(["m1", "m0", "m2"]);
    expect(items.find((i) => i.id === "m2")!.sources[0]!.path).toBeNull();
  });
  it("shows only active items with basis, provenance link and correct/retract controls (EN)", () => {
    const html = view("en");
    expect(html).toContain("What Lumière remembers");
    expect(html).toContain("Intended major: communications");
    expect(html).not.toContain("biology");
    expect(html).toContain("You told us");
    expect(html).toContain('href="/assistant?conversation=c1"');
    expect(html).not.toContain("evil.example");
    expect(html).toContain('data-testid="assistant-memory-correct"');
    expect(html).toContain('data-testid="assistant-memory-retract"');
    expect(html).toMatch(/never change your official credits/);
  });
  it("French copy and empty state", () => {
    expect(view("fr")).toContain("Vous nous l’avez dit");
    expect(view("en", { items: [] })).toContain('data-testid="assistant-memory-empty"');
  });
  it("memory deep link is parsed and /assistant is a routed student page", () => {
    expect(deepLinkFromSearch("?memory=mem-12345678").memoryId).toBe("mem-12345678");
    expect(read("client/src/App.tsx")).toMatch(/<Route path="\/assistant">/);
  });
});
