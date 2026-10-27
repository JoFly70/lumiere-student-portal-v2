/**
 * Appearance themes for the Portal (S17).
 * Visual tokens adapted from the Lumière ClientDesk design system; re-implemented for the Portal.
 *
 * The palettes live in styles/themes.css (html[data-theme="..."]). This module is the typed registry:
 * which themes exist, how a saved value resolves, and how a theme is applied to the document.
 * Every storage and DOM access is guarded, so a blocked localStorage never breaks rendering.
 */
export interface ThemeDef {
  readonly id: string;
  readonly label: string;
  readonly note: string;
  /** Dark themes also get the `.dark` class so Tailwind `dark:` variants keep working. */
  readonly dark: boolean;
  /** [canvas, rail, accent, text] for the picker swatch. */
  readonly swatch: readonly [string, string, string, string];
}

export const THEMES = [
  { id: "lumiere", label: "Lumière Desk", note: "Default", dark: false, swatch: ["#f4f3ef", "#0f1522", "#c29a4e", "#1b1f27"] },
  { id: "lumiere-dark", label: "Lumière Dark", note: "Classic", dark: true, swatch: ["#09090a", "#141417", "#c9aa6c", "#ebe6de"] },
  { id: "midnight", label: "Midnight Slate", note: "", dark: true, swatch: ["#0b0e14", "#161c29", "#8b9fbb", "#e7eaf0"] },
  { id: "monaco", label: "Monaco Navy", note: "", dark: true, swatch: ["#0b1120", "#151f36", "#c8ae76", "#f2ede3"] },
  { id: "forest", label: "Forest Ledger", note: "", dark: true, swatch: ["#0b100d", "#16201a", "#b09a64", "#ece8dc"] },
  { id: "bordeaux", label: "Bordeaux Reserve", note: "", dark: true, swatch: ["#120a0c", "#211419", "#c09a85", "#f0e8e2"] },
  { id: "graphite", label: "Graphite Executive", note: "", dark: true, swatch: ["#131416", "#1f2124", "#b7bdc5", "#f1efeb"] },
  { id: "sandstone", label: "Sandstone Light", note: "Light", dark: false, swatch: ["#f3efe7", "#efe9de", "#8a6d3c", "#23201b"] },
  { id: "teal", label: "Teal Reserve", note: "", dark: true, swatch: ["#091214", "#142325", "#86aba7", "#edefe9"] },
] as const satisfies readonly ThemeDef[];

export type ThemeId = (typeof THEMES)[number]["id"];

export const DEFAULT_THEME: ThemeId = "lumiere";
/** The dark partner used by the one-tap light/dark toggle. */
export const DEFAULT_DARK_THEME: ThemeId = "lumiere-dark";

/** Values saved by the previous light/dark-only hook, mapped to their closest themes. */
export const LEGACY_THEMES: Readonly<Record<string, ThemeId>> = { light: "lumiere", dark: "lumiere-dark" };

export const THEME_STORAGE_KEY = "lumiere-portal:theme";
/** The key the previous hook used; still read (never written) so an existing choice carries over. */
export const LEGACY_STORAGE_KEY = "theme";

export function isTheme(x: unknown): x is ThemeId {
  return THEMES.some((t) => t.id === x);
}

/** Any saved value becomes a valid theme id: legacy light/dark mapped, anything else the default. */
export function resolveTheme(x: unknown): ThemeId {
  if (isTheme(x)) return x;
  if (typeof x === "string" && Object.prototype.hasOwnProperty.call(LEGACY_THEMES, x)) return LEGACY_THEMES[x];
  return DEFAULT_THEME;
}

export function themeDef(id: ThemeId): (typeof THEMES)[number] {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function isDarkTheme(id: unknown): boolean {
  return themeDef(resolveTheme(id)).dark;
}

/** The minimal document surface applyTheme needs (the real `document.documentElement` satisfies it). */
export interface ThemeRoot {
  setAttribute(name: string, value: string): void;
  classList: { add(...tokens: string[]): void; remove(...tokens: string[]): void };
  style?: { colorScheme?: string };
}

export interface ThemeStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultRoot(): ThemeRoot | null {
  return typeof document === "undefined" ? null : document.documentElement;
}

function defaultStore(): ThemeStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // accessing localStorage can itself throw (blocked site data)
  }
}

/** Set data-theme and keep the `.dark` / `.light` class in sync. Returns the resolved id. */
export function applyTheme(id: unknown, root: ThemeRoot | null = defaultRoot()): ThemeId {
  const resolved = resolveTheme(id);
  if (root) {
    const dark = isDarkTheme(resolved);
    root.setAttribute("data-theme", resolved);
    root.classList.remove("light", "dark");
    root.classList.add(dark ? "dark" : "light");
    if (root.style) root.style.colorScheme = dark ? "dark" : "light";
  }
  return resolved;
}

/** Remember the choice for this browser. Failure (private mode, blocked storage) is silent. */
export function saveTheme(id: ThemeId, store: ThemeStore | null = defaultStore()): void {
  try {
    store?.setItem(THEME_STORAGE_KEY, id);
  } catch {
    /* still applied for this session */
  }
}

/** The saved theme (new key first, then the legacy light/dark key), or the default. */
export function storedTheme(store: ThemeStore | null = defaultStore()): ThemeId {
  try {
    const saved = store?.getItem(THEME_STORAGE_KEY);
    if (saved) return resolveTheme(saved);
    return resolveTheme(store?.getItem(LEGACY_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

/** One-tap light/dark switch: a light theme goes to Lumière Dark, a dark theme back to Lumière. */
export function oppositeTheme(id: ThemeId): ThemeId {
  return isDarkTheme(id) ? DEFAULT_THEME : DEFAULT_DARK_THEME;
}
