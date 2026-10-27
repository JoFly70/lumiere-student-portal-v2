/**
 * Global search (S21): a top-bar search field on desktop, a compact icon with a full-screen overlay on phones.
 * Students get portal pages (matched here) plus their own records from GET /api/search; staff get students only.
 * Keyboard: Ctrl/Cmd+K focuses it, Up/Down move, Enter opens, Esc closes; an outside click closes the list.
 */
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Search, X } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useT, type Language } from "@/i18n";
import { useStudentPrograms } from "@/lib/student-programs";
import { FOCUSABLE_SELECTOR, nextTrapTarget, openAssistantConversation } from "@/components/academic-assistant/logic";
import {
  SEARCH_DEBOUNCE_MS, SEARCH_LIMIT, buildGroups, flattenGroups, highlightParts, isSearchShortcut, normaliseQuery, resultAction, resultKey,
  sanitiseServerResults, searchKeyAction, shouldSearch, type SearchAudience, type SearchGroup, type SearchResult, type SearchType,
} from "@/lib/global-search";

void React;

type Tr = (key: string, vars?: Record<string, string | number>) => string;

/* ------------------------------------------------------------------------------------------ results view */

export interface SearchResultsViewProps {
  groups: readonly SearchGroup[];
  query: string;
  active: number;
  idPrefix: string;
  status: "idle" | "loading" | "error" | "ready";
  t: Tr;
  onHover?: (index: number) => void;
  onPick?: (result: SearchResult) => void;
}

/** The dropdown body. Pure presentation: rendered by tests and by the harness without a server. */
export function SearchResultsView({ groups, query, active, idPrefix, status, t, onHover, onPick }: SearchResultsViewProps) {
  const flat = flattenGroups(groups);
  let counter = -1;
  const short = !shouldSearch(query);
  return (
    <div data-testid="global-search-panel">
      {short && groups.length === 0 ? (
        <p className="px-3 py-3 text-sm text-student-muted" data-testid="global-search-hint">{t("gs.hint")}</p>
      ) : null}
      {!short && status === "loading" && flat.length === 0 ? (
        <p className="px-3 py-3 text-sm text-student-muted" data-testid="global-search-loading">{t("gs.searching")}</p>
      ) : null}
      {!short && status === "error" ? (
        <p className="px-3 py-2 text-sm text-student-attn" role="alert" data-testid="global-search-error">{t("gs.error")}</p>
      ) : null}
      {!short && status !== "loading" && flat.length === 0 && status !== "error" ? (
        <p className="px-3 py-3 text-sm text-student-muted" data-testid="global-search-empty">{t("gs.empty", { q: query.trim() })}</p>
      ) : null}
      {flat.length > 0 && (
        <ul role="listbox" id={`${idPrefix}-list`} aria-label={t("gs.results")} className="max-h-[min(26rem,60dvh)] overflow-y-auto py-1" data-testid="global-search-list">
          {groups.map((g) => (
            <li key={g.type} role="presentation">
              <ul role="group" aria-labelledby={`${idPrefix}-g-${g.type}`}>
                <li role="presentation" id={`${idPrefix}-g-${g.type}`} className="px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-student-muted" data-testid={`global-search-group-${g.type}`}>
                  {t(`gs.type.${g.type}`)}
                </li>
                {g.results.map((r) => {
                  counter += 1;
                  const index = counter;
                  const [pre, hit, post] = highlightParts(r.title, query);
                  return (
                    <li
                      key={resultKey(r)}
                      id={`${idPrefix}-opt-${index}`}
                      role="option"
                      aria-selected={index === active}
                      data-active={index === active ? "true" : "false"}
                      data-testid={`global-search-option-${r.type}`}
                      className={cn(
                        "mx-1 flex min-h-[44px] cursor-pointer flex-col justify-center rounded-md px-2.5 py-1.5",
                        index === active ? "bg-student-gold-soft text-student-ink" : "text-student-ink hover:bg-student-gold-soft/60",
                      )}
                      onMouseMove={() => onHover?.(index)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onPick?.(r)}
                    >
                      <span className="truncate text-sm font-medium">
                        {pre}{hit ? <mark className="bg-transparent font-semibold text-student-gold-ink underline decoration-student-gold-ink/50 underline-offset-2">{hit}</mark> : null}{post}
                      </span>
                      {r.subtitle ? <span className="truncate text-xs text-student-muted">{r.subtitle}</span> : null}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ hooks */

function useMediaQuery(query: string, initial: boolean): boolean {
  const [match, setMatch] = useState<boolean>(() => (typeof window === "undefined" || !window.matchMedia ? initial : window.matchMedia(query).matches));
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mql = window.matchMedia(query);
    const on = () => setMatch(mql.matches);
    on();
    mql.addEventListener("change", on);
    return () => mql.removeEventListener("change", on);
  }, [query]);
  return match;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function shortcutLabel(): string {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  return /mac|iphone|ipad/i.test(nav?.platform ?? nav?.userAgent ?? "") ? "⌘K" : "Ctrl K";
}

/* --------------------------------------------------------------------------------------------- component */

export function GlobalSearch({ audience, className }: { audience: SearchAudience; className?: string }) {
  const { t, language } = useT();
  const tr = t as unknown as Tr;
  const [, navigate] = useLocation();
  const uid = useId().replace(/:/g, "");
  const desktop = useMediaQuery("(min-width: 768px)", true);
  const programs = useStudentPrograms(audience === "student");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [overlay, setOverlay] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<HTMLButtonElement>(null);

  const debounced = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
  const enabled = shouldSearch(debounced);
  const allowed: readonly SearchType[] | undefined = audience === "staff" ? ["student"] : undefined;
  const q = useQuery({
    queryKey: ["/api/search", debounced, audience],
    queryFn: async () => sanitiseServerResults(await api.get(`/api/search?q=${encodeURIComponent(debounced)}&limit=${SEARCH_LIMIT}&lang=${language}`), allowed),
    enabled,
    staleTime: 30_000,
    retry: false,
  });

  const groups = useMemo(
    () => buildGroups(query, language as Language, enabled && normaliseQuery(debounced) === normaliseQuery(query) ? q.data ?? [] : [], audience, { hasHighSchool: programs.hasHighSchool, highSchoolOnly: programs.highSchoolOnly }),
    [query, debounced, enabled, q.data, language, audience, programs.hasHighSchool, programs.highSchoolOnly],
  );
  const flat = useMemo(() => flattenGroups(groups), [groups]);
  const status: SearchResultsViewProps["status"] = !shouldSearch(query) ? "idle" : q.isError ? "error" : q.isFetching || debounced !== query.trim() ? "loading" : "ready";

  useEffect(() => { setActive(flat.length ? 0 : -1); }, [flat.length, debounced]);

  const closeAll = useCallback(() => { setOpen(false); setOverlay(false); setActive(-1); }, []);
  const pick = useCallback((r: SearchResult) => {
    const action = resultAction(r);
    closeAll();
    setQuery("");
    inputRef.current?.blur();
    if (action.kind === "assistant") openAssistantConversation(action.conversationId);
    else navigate(action.path);
  }, [closeAll, navigate]);

  // Ctrl/Cmd+K from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isSearchShortcut(e)) return;
      e.preventDefault();
      if (desktop) { inputRef.current?.focus(); inputRef.current?.select(); setOpen(true); } else setOverlay(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [desktop]);

  // Outside click closes the desktop list.
  useEffect(() => {
    if (!open || !desktop) return undefined;
    const onDown = (e: PointerEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, desktop]);

  useEffect(() => { if (overlay) inputRef.current?.focus(); else if (!overlay && iconRef.current && !desktop) iconRef.current.focus({ preventScroll: true }); }, [overlay]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (desktop && overlay) setOverlay(false); }, [desktop, overlay]);

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    const a = searchKeyAction(e.key, active, flat.length);
    if (a.kind === "close") {
      if (!desktop) { e.preventDefault(); e.stopPropagation(); closeAll(); return; }
      if (query) { e.preventDefault(); e.stopPropagation(); setQuery(""); setOpen(true); } else { closeAll(); inputRef.current?.blur(); }
      if (!query) e.stopPropagation();
      return;
    }
    if (a.kind === "none") return;
    e.preventDefault();
    if (a.kind === "move") { setOpen(true); setActive(a.index); document.getElementById(`${uid}-opt-${a.index}`)?.scrollIntoView({ block: "nearest" }); }
    else if (flat[a.index]) pick(flat[a.index]!);
  };

  // Escape and Tab inside the phone overlay.
  useEffect(() => {
    if (!overlay) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); closeAll(); return; }
      if (e.key !== "Tab" || !overlayRef.current) return;
      const nodes = Array.from(overlayRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((n) => n.offsetParent !== null);
      const cur = document.activeElement as HTMLElement | null;
      const target = nextTrapTarget(nodes, cur && overlayRef.current.contains(cur) ? cur : null, e.shiftKey);
      if (target) { e.preventDefault(); target.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [overlay, closeAll]);

  const placeholder = tr(audience === "staff" ? "gs.placeholder.staff" : "gs.placeholder");
  const showList = desktop ? open : overlay;
  const listId = `${uid}-list`;
  const announce = status === "ready" || status === "idle" ? (flat.length === 1 ? tr("gs.count.one") : tr("gs.count.other", { n: flat.length })) : "";

  const field = (
    <div className="relative">
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-student-muted" />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label={tr("gs.label")}
        aria-expanded={showList && flat.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 && flat.length > 0 ? `${uid}-opt-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        value={query}
        placeholder={placeholder}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onInputKey}
        className="h-11 w-full rounded-lg border border-student-line bg-student-bg pl-9 pr-16 text-base text-student-ink placeholder:text-student-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--t-focus,#c29a4e)] md:h-10 md:text-sm [&::-webkit-search-cancel-button]:hidden"
        data-testid="global-search-input"
      />
      {query ? (
        <button
          type="button"
          onClick={() => { setQuery(""); inputRef.current?.focus(); }}
          aria-label={tr("gs.clearAria")}
          className="absolute right-1.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-student-muted hover:text-student-ink"
          data-testid="global-search-clear"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      ) : (
        <kbd aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-student-line px-1.5 py-0.5 text-[11px] font-medium text-student-muted md:block">{shortcutLabel()}</kbd>
      )}
    </div>
  );
  const body = showList ? (
    <SearchResultsView groups={groups} query={query} active={active} idPrefix={uid} status={status} t={tr} onHover={setActive} onPick={pick} />
  ) : null;
  const live = <p className="sr-only" role="status" aria-live="polite" data-testid="global-search-live">{announce}</p>;

  if (desktop) {
    return (
      <div ref={wrapRef} className={cn("relative w-full max-w-md", className)} role="search" data-testid="global-search">
        {field}
        {showList && (
          <div className="absolute left-0 right-0 top-full z-40 mt-1.5 overflow-hidden rounded-lg border border-student-line bg-student-card shadow-lg" data-testid="global-search-dropdown">
            {body}
          </div>
        )}
        {live}
      </div>
    );
  }
  return (
    <div className={className} data-testid="global-search">
      <button
        ref={iconRef}
        type="button"
        onClick={() => setOverlay(true)}
        aria-label={tr("gs.openAria")}
        aria-haspopup="dialog"
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-student-ink hover:bg-student-gold-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        data-testid="global-search-open"
      >
        <Search aria-hidden="true" className="h-5 w-5" />
      </button>
      {overlay && typeof document !== "undefined"
        ? createPortal(
            <div ref={overlayRef} role="dialog" aria-modal="true" aria-label={tr("gs.label")} className="student-surface fixed inset-0 z-[80] flex flex-col bg-student-bg" data-testid="global-search-overlay">
              <div className="flex items-center gap-2 border-b border-student-line bg-student-card p-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
                <div className="min-w-0 flex-1" role="search">{field}</div>
                <button type="button" onClick={closeAll} aria-label={tr("gs.closeAria")} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-student-ink hover:bg-student-gold-soft" data-testid="global-search-close">
                  <X aria-hidden="true" className="h-5 w-5" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto bg-student-card">{body}</div>
              {live}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export default GlobalSearch;
