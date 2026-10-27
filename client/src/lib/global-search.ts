/**
 * Global search helpers (S21). Pure: no React, no DOM at import time.
 * Static portal pages are matched here in the browser; records come from GET /api/search (see docs/recovery/s21/api-contracts.md).
 * The ranking, grouping and keyboard model follow the "top-bar search, grouped by type, Ctrl/Cmd+K" pattern.
 */
import type { Language } from "@/i18n";

export type SearchType = "page" | "course" | "roadmap" | "document" | "ticket" | "conversation" | "memory" | "billing" | "student";
export const SEARCH_TYPES: readonly SearchType[] = ["page", "course", "roadmap", "document", "ticket", "billing", "conversation", "memory", "student"];
export const SEARCH_MIN_CHARS = 2;
export const SEARCH_LIMIT = 20;
export const SEARCH_DEBOUNCE_MS = 200;

export interface SearchResult {
  type: SearchType;
  id: string;
  title: string;
  subtitle: string | null;
  path: string;
  score: number;
}
export interface SearchGroup { type: SearchType; results: SearchResult[] }

export type SearchAudience = "student" | "staff";

interface StaticPage { id: string; path: string; en: string; fr: string; keywords: readonly string[]; programs?: "university" | "highSchool" }

/** Portal destinations a student can reach. Keywords are matched in both languages. */
export const STUDENT_PAGES: readonly StaticPage[] = [
  { id: "flight-deck", path: "/flight-deck", en: "Flight Deck", fr: "Tableau de bord", keywords: ["cockpit", "home", "accueil", "progress", "progression", "credits", "crédits", "dashboard"], programs: "university" },
  { id: "high-school", path: "/high-school", en: "High School", fr: "École secondaire", keywords: ["secondary", "secondaire", "diploma", "diplôme", "pathway", "parcours"], programs: "highSchool" },
  { id: "roadmap", path: "/roadmap", en: "Your Roadmap", fr: "Votre feuille de route", keywords: ["courses", "cours", "plan", "semester", "session", "feuille"], programs: "university" },
  { id: "documents", path: "/documents", en: "Documents", fr: "Documents", keywords: ["upload", "téléverser", "transcript", "relevé", "passport", "passeport", "files", "fichiers"] },
  { id: "billing", path: "/billing", en: "Billing", fr: "Facturation", keywords: ["invoice", "facture", "payment", "paiement", "fees", "frais"] },
  { id: "support", path: "/support", en: "Support", fr: "Assistance", keywords: ["help", "aide", "ticket", "contact", "question", "request", "demande"] },
  { id: "profile", path: "/profile", en: "My Profile", fr: "Mon profil", keywords: ["photo", "account", "compte", "password", "mot de passe", "identity", "identité", "address", "adresse"] },
];

/** Lowercase, accent-folded, collapsed whitespace. */
export function normaliseQuery(raw: string): string {
  return raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function shouldSearch(raw: string): boolean {
  return normaliseQuery(raw).length >= SEARCH_MIN_CHARS;
}

/** 100 exact, 80 prefix, 60 word-prefix, 40 substring, 0 none. */
export function matchScore(haystack: string, query: string): number {
  const h = normaliseQuery(haystack);
  const q = normaliseQuery(query);
  if (!q || !h) return 0;
  if (h === q) return 100;
  if (h.startsWith(q)) return 80;
  if (h.split(/[\s\-_/.,:;()]+/).some((w) => w.startsWith(q))) return 60;
  if (h.includes(q)) return 40;
  return 0;
}

export function isSafeResultPath(path: unknown): path is string {
  return typeof path === "string" && /^\/(?!\/)[^\s\\]*$/.test(path);
}


/** Static pages matching the query, best first. `programs` hides pages the student's program does not have. */
export function searchPages(query: string, language: Language, programs?: { hasHighSchool: boolean; highSchoolOnly: boolean }): SearchResult[] {
  if (!shouldSearch(query)) return [];
  const out: SearchResult[] = [];
  for (const p of STUDENT_PAGES) {
    if (programs) {
      if (p.programs === "highSchool" && !programs.hasHighSchool) continue;
      if (p.programs === "university" && programs.highSchoolOnly) continue;
    }
    const label = language === "fr" ? p.fr : p.en;
    const other = language === "fr" ? p.en : p.fr;
    const kw = p.keywords.reduce((m, k) => Math.max(m, matchScore(k, query)), 0);
    const score = Math.max(matchScore(label, query), Math.round(matchScore(other, query) * 0.9), Math.round(kw * 0.7));
    if (score > 0) out.push({ type: "page", id: p.id, title: label, subtitle: null, path: p.path, score });
  }
  return out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

const KNOWN: ReadonlySet<string> = new Set(SEARCH_TYPES);

/** Defensive shaping of GET /api/search. Unknown types and unsafe paths are dropped. */
export function sanitiseServerResults(raw: unknown, allowed?: readonly SearchType[]): SearchResult[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { results?: unknown }).results) ? (raw as { results: unknown[] }).results : [];
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const item of list) {
    const r = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    if (typeof r.type !== "string" || !KNOWN.has(r.type) || r.type === "page") continue;
    if (allowed && !allowed.includes(r.type as SearchType)) continue;
    if (typeof r.id !== "string" || typeof r.title !== "string" || !r.title.trim() || !isSafeResultPath(r.path)) continue;
    const key = `${r.type}:${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      type: r.type as SearchType, id: r.id, title: r.title.trim(), path: r.path,
      subtitle: typeof r.subtitle === "string" && r.subtitle.trim() ? r.subtitle.trim() : null,
      score: typeof r.score === "number" && Number.isFinite(r.score) ? r.score : 0,
    });
  }
  return out;
}

/** Best match first inside a group; groups in a fixed, predictable order (pages first). */
export function groupResults(results: readonly SearchResult[], order: readonly SearchType[] = SEARCH_TYPES, perGroup = 6): SearchGroup[] {
  const groups: SearchGroup[] = [];
  for (const type of order) {
    const rows = results.filter((r) => r.type === type).map((r, i) => ({ r, i })).sort((a, b) => b.r.score - a.r.score || a.i - b.i).map((x) => x.r).slice(0, perGroup);
    if (rows.length) groups.push({ type, results: rows });
  }
  return groups;
}

export function flattenGroups(groups: readonly SearchGroup[]): SearchResult[] {
  return groups.flatMap((g) => g.results);
}

export function buildGroups(query: string, language: Language, server: readonly SearchResult[], audience: SearchAudience, programs?: { hasHighSchool: boolean; highSchoolOnly: boolean }): SearchGroup[] {
  const pages = audience === "student" ? searchPages(query, language, programs) : [];
  return groupResults([...pages, ...server]);
}

export function resultKey(r: Pick<SearchResult, "type" | "id">): string {
  return `${r.type}:${r.id}`;
}

/* ---- keyboard ---- */

export function isSearchShortcut(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }): boolean {
  return e.key.toLowerCase() === "k" && !!(e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
}

export type SearchKeyAction = { kind: "move"; index: number } | { kind: "open"; index: number } | { kind: "close" } | { kind: "none" };

/** Combobox keys. Enter opens the highlighted row (or the first when none is highlighted); Escape closes. */
export function searchKeyAction(key: string, active: number, count: number): SearchKeyAction {
  if (key === "Escape") return { kind: "close" };
  if (count <= 0) return { kind: "none" };
  if (key === "ArrowDown") return { kind: "move", index: active < 0 ? 0 : (active + 1) % count };
  if (key === "ArrowUp") return { kind: "move", index: active < 0 ? count - 1 : (active - 1 + count) % count };
  if (key === "Home") return { kind: "move", index: 0 };
  if (key === "End") return { kind: "move", index: count - 1 };
  if (key === "Enter") return { kind: "open", index: active < 0 ? 0 : active };
  return { kind: "none" };
}

/** Where a result goes: conversations open the assistant drawer, everything else is a normal route. */
export function resultAction(r: SearchResult): { kind: "navigate"; path: string } | { kind: "assistant"; conversationId: string } {
  if (r.type === "conversation") return { kind: "assistant", conversationId: r.id };
  return { kind: "navigate", path: r.path };
}

/** The bit of a title to emphasise, for rendering: [before, match, after]. */
export function highlightParts(text: string, query: string): [string, string, string] {
  const q = query.trim();
  if (!q) return [text, "", ""];
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return [text, "", ""];
  return [text.slice(0, i), text.slice(i, i + q.length), text.slice(i + q.length)];
}
