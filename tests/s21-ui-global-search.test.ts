import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SearchResultsView } from "../client/src/components/os/global-search";
import {
  buildGroups, flattenGroups, groupResults, highlightParts, isSafeResultPath, isSearchShortcut, matchScore, normaliseQuery, resultAction,
  sanitiseServerResults, searchKeyAction, searchPages, shouldSearch, type SearchResult,
} from "../client/src/lib/global-search";
import { translate } from "../client/src/i18n";

(globalThis as { React?: unknown }).React = React;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const r = (type: SearchResult["type"], id: string, title: string, score: number, path = `/x/${id}`): SearchResult => ({ type, id, title, subtitle: null, path, score });

describe("S21 global search: matching and ranking", () => {
  it("folds accents and case, and needs two characters", () => {
    expect(normaliseQuery("  ÉCOLE  Secondaire ")).toBe("ecole secondaire");
    expect(shouldSearch("a")).toBe(false);
    expect(shouldSearch(" ab ")).toBe(true);
  });
  it("scores exact > prefix > word-prefix > substring > none", () => {
    expect(matchScore("Documents", "documents")).toBe(100);
    expect(matchScore("Documents", "doc")).toBe(80);
    expect(matchScore("Your Roadmap", "road")).toBe(60);
    expect(matchScore("Billing", "ill")).toBe(40);
    expect(matchScore("Billing", "zzz")).toBe(0);
  });
  it("finds static pages in the active language, by label or keyword, best first", () => {
    const en = searchPages("doc", "en");
    expect(en[0]).toMatchObject({ type: "page", id: "documents", path: "/documents" });
    expect(searchPages("facture", "en")[0]?.id).toBe("billing");
    expect(searchPages("releve", "fr")[0]?.id).toBe("documents");
    expect(searchPages("feuille", "fr")[0]).toMatchObject({ id: "roadmap", title: "Votre feuille de route" });
    expect(searchPages("d", "en")).toEqual([]);
  });
  it("hides pages the program does not have", () => {
    expect(searchPages("high school", "en", { hasHighSchool: false, highSchoolOnly: false }).some((p) => p.id === "high-school")).toBe(false);
    expect(searchPages("roadmap", "en", { hasHighSchool: true, highSchoolOnly: true }).some((p) => p.id === "roadmap")).toBe(false);
    expect(searchPages("high school", "en", { hasHighSchool: true, highSchoolOnly: false }).some((p) => p.id === "high-school")).toBe(true);
  });
});

describe("S21 global search: grouping", () => {
  const rows = [r("document", "d1", "Passport", 50), r("course", "c1", "Calculus", 90), r("document", "d2", "Transcript", 70), r("ticket", "t1", "Help", 10), r("page", "documents", "Documents", 80)];
  it("groups in a fixed order (pages first), best match first inside a group", () => {
    const g = groupResults(rows);
    expect(g.map((x) => x.type)).toEqual(["page", "course", "document", "ticket"]);
    expect(g.find((x) => x.type === "document")!.results.map((x) => x.id)).toEqual(["d2", "d1"]);
    expect(flattenGroups(g).map((x) => x.id)).toEqual(["documents", "c1", "d2", "d1", "t1"]);
  });
  it("caps each group", () => {
    const many = Array.from({ length: 10 }, (_, i) => r("course", `c${i}`, `C${i}`, i));
    expect(groupResults(many, undefined, 4)[0]!.results).toHaveLength(4);
  });
  it("students get pages + records; staff get records only (never static pages)", () => {
    const server = [r("student", "s1", "Amélie Laurent", 90)];
    expect(buildGroups("doc", "en", [r("document", "d1", "Doc", 5)], "student").map((g) => g.type)).toEqual(["page", "document"]);
    expect(buildGroups("doc", "en", server, "staff").map((g) => g.type)).toEqual(["student"]);
  });
  it("shapes the server payload defensively", () => {
    const out = sanitiseServerResults({
      results: [
        { type: "course", id: "1", title: "Calculus", subtitle: "MATH 101", path: "/roadmap", score: 3 },
        { type: "course", id: "1", title: "dup", path: "/roadmap", score: 1 },
        { type: "evil", id: "2", title: "x", path: "/x", score: 1 },
        { type: "document", id: "3", title: "x", path: "//evil.example", score: 1 },
        { type: "document", id: "4", title: "x", path: "javascript:alert(1)", score: 1 },
        { type: "page", id: "5", title: "server page", path: "/x", score: 1 },
        { type: "student", id: "6", title: " ", path: "/x", score: 1 },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "1", subtitle: "MATH 101" });
    expect(sanitiseServerResults({ results: [r("course", "1", "A", 1), r("student", "2", "B", 1)] }, ["student"]).map((x) => x.id)).toEqual(["2"]);
    expect(sanitiseServerResults(null)).toEqual([]);
    expect(isSafeResultPath("/documents")).toBe(true);
    expect(isSafeResultPath("//x")).toBe(false);
  });
  it("conversation results open the assistant, others navigate", () => {
    expect(resultAction(r("conversation", "abc12345", "Chat", 1))).toEqual({ kind: "assistant", conversationId: "abc12345" });
    expect(resultAction(r("course", "c", "C", 1, "/roadmap"))).toEqual({ kind: "navigate", path: "/roadmap" });
  });
  it("highlights the matched part", () => {
    expect(highlightParts("Your Roadmap", "road")).toEqual(["Your ", "Road", "map"]);
    expect(highlightParts("abc", "")).toEqual(["abc", "", ""]);
  });
});

describe("S21 global search: keyboard", () => {
  it("Ctrl+K and Cmd+K open it; plain K or Ctrl+Shift+K do not", () => {
    expect(isSearchShortcut({ key: "k", ctrlKey: true })).toBe(true);
    expect(isSearchShortcut({ key: "K", metaKey: true })).toBe(true);
    expect(isSearchShortcut({ key: "k" })).toBe(false);
    expect(isSearchShortcut({ key: "k", ctrlKey: true, shiftKey: true })).toBe(false);
  });
  it("arrows wrap, Home/End jump, Enter opens the highlighted (or first) row, Esc closes", () => {
    expect(searchKeyAction("ArrowDown", -1, 3)).toEqual({ kind: "move", index: 0 });
    expect(searchKeyAction("ArrowDown", 2, 3)).toEqual({ kind: "move", index: 0 });
    expect(searchKeyAction("ArrowUp", 0, 3)).toEqual({ kind: "move", index: 2 });
    expect(searchKeyAction("ArrowUp", -1, 3)).toEqual({ kind: "move", index: 2 });
    expect(searchKeyAction("Home", 2, 3)).toEqual({ kind: "move", index: 0 });
    expect(searchKeyAction("End", 0, 3)).toEqual({ kind: "move", index: 2 });
    expect(searchKeyAction("Enter", 1, 3)).toEqual({ kind: "open", index: 1 });
    expect(searchKeyAction("Enter", -1, 3)).toEqual({ kind: "open", index: 0 });
    expect(searchKeyAction("Escape", 1, 3)).toEqual({ kind: "close" });
    expect(searchKeyAction("Escape", -1, 0)).toEqual({ kind: "close" });
    expect(searchKeyAction("Enter", -1, 0)).toEqual({ kind: "none" });
    expect(searchKeyAction("a", 0, 3)).toEqual({ kind: "none" });
  });
});

describe("S21 global search: markup", () => {
  const t = (k: string, v?: Record<string, string | number>) => translate("en", k, v);
  const groups = groupResults([r("page", "documents", "Documents", 100, "/documents"), r("course", "c1", "Calculus I", 50, "/roadmap")]);
  it("is a combobox listbox with groups, options and an active descendant target", () => {
    const html = renderToStaticMarkup(createElement(SearchResultsView, { groups, query: "doc", active: 1, idPrefix: "gs", status: "ready", t }));
    expect(html).toContain('role="listbox"');
    expect(html).toContain('role="group"');
    expect(html).toContain("Portal pages");
    expect(html).toContain("Courses");
    expect(html).toMatch(/id="gs-opt-1"[^>]*aria-selected="true"|aria-selected="true"[^>]*id="gs-opt-1"/);
    expect(html).toContain('aria-selected="false"');
    expect(html).toContain("<mark");
  });
  it("shows hint, loading, empty and error states", () => {
    const base = { groups: [], idPrefix: "gs", t, active: -1 };
    expect(renderToStaticMarkup(createElement(SearchResultsView, { ...base, query: "", status: "idle" }))).toContain("at least 2 characters");
    expect(renderToStaticMarkup(createElement(SearchResultsView, { ...base, query: "abc", status: "loading" }))).toContain("Searching");
    expect(renderToStaticMarkup(createElement(SearchResultsView, { ...base, query: "abc", status: "ready" }))).toContain("No results for “abc”");
    const err = renderToStaticMarkup(createElement(SearchResultsView, { ...base, query: "abc", status: "error" }));
    expect(err).toContain('role="alert"');
  });
  it("renders French type labels", () => {
    const tf = (k: string, v?: Record<string, string | number>) => translate("fr", k, v);
    const html = renderToStaticMarkup(createElement(SearchResultsView, { groups, query: "doc", active: 0, idPrefix: "gs", status: "ready", t: tf }));
    expect(html).toContain("Pages du portail");
    expect(html).toContain("Cours");
  });
  it("the shell wires search for students and staff and the 44px mobile trigger", () => {
    expect(read("client/src/components/student-shell.tsx")).toContain('<GlobalSearch audience="student" />');
    expect(read("client/src/components/staff/staff-shell.tsx")).toContain('<GlobalSearch audience="staff" />');
    const src = read("client/src/components/os/global-search.tsx");
    expect(src).toContain("h-11 w-11");
    expect(src).toContain("/api/search?q=");
    expect(src).toContain('role="combobox"');
  });
});
