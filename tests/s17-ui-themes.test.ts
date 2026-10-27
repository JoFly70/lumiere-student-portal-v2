import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  THEMES,
  applyTheme,
  isDarkTheme,
  oppositeTheme,
  resolveTheme,
  saveTheme,
  storedTheme,
  THEME_STORAGE_KEY,
  type ThemeRoot,
  type ThemeStore,
} from "../client/src/lib/themes";

function fakeRoot() {
  const attrs: Record<string, string> = {};
  const classes = new Set<string>();
  const root: ThemeRoot = {
    setAttribute: (n, v) => void (attrs[n] = v),
    classList: { add: (...t) => t.forEach((x) => classes.add(x)), remove: (...t) => t.forEach((x) => classes.delete(x)) },
    style: {},
  };
  return { root, attrs, classes };
}
const memStore = (init: Record<string, string> = {}): ThemeStore & { data: Record<string, string> } => {
  const data = { ...init };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
};
const throwing: ThemeStore = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };

describe("theme registry", () => {
  it("has the nine themes with unique ids and 4-colour swatches", () => {
    expect(THEMES).toHaveLength(9);
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(9);
    for (const t of THEMES) expect(t.swatch).toHaveLength(4);
    expect(DEFAULT_THEME).toBe("lumiere");
  });
  it("resolves ids, legacy light/dark and junk", () => {
    expect(resolveTheme("monaco")).toBe("monaco");
    expect(resolveTheme("light")).toBe("lumiere");
    expect(resolveTheme("dark")).toBe("lumiere-dark");
    for (const junk of [null, undefined, "", "purple", 3, "__proto__", "constructor"]) expect(resolveTheme(junk)).toBe("lumiere");
  });
  it("applies data-theme and keeps the .dark class in sync", () => {
    const a = fakeRoot();
    expect(applyTheme("monaco", a.root)).toBe("monaco");
    expect(a.attrs["data-theme"]).toBe("monaco");
    expect(a.classes.has("dark")).toBe(true);
    expect(a.classes.has("light")).toBe(false);
    applyTheme("sandstone", a.root);
    expect(a.classes.has("dark")).toBe(false);
    expect(a.classes.has("light")).toBe(true);
    applyTheme("dark", a.root);
    expect(a.attrs["data-theme"]).toBe("lumiere-dark");
    expect(a.classes.has("dark")).toBe(true);
  });
  it("every dark flag matches the palette in themes.css", async () => {
    const fs = await import("node:fs");
    const css = fs.readFileSync("client/src/styles/themes.css", "utf8");
    for (const t of THEMES) {
      const block = css.split(`html[data-theme="${t.id}"] {`)[1] ?? "";
      expect(block, t.id).toContain(`color-scheme: ${t.dark ? "dark" : "light"}`);
    }
  });
  it("stores and reads with the legacy key as fallback, and survives blocked storage", () => {
    const s = memStore({ theme: "dark" });
    expect(storedTheme(s)).toBe("lumiere-dark");
    saveTheme("teal", s);
    expect(s.data[THEME_STORAGE_KEY]).toBe("teal");
    expect(storedTheme(s)).toBe("teal");
    expect(storedTheme(throwing)).toBe("lumiere");
    expect(() => saveTheme("teal", throwing)).not.toThrow();
    expect(storedTheme(null)).toBe("lumiere");
  });
  it("toggle flips between a light and a dark theme", () => {
    expect(oppositeTheme("lumiere")).toBe("lumiere-dark");
    expect(oppositeTheme("monaco")).toBe("lumiere");
    expect(isDarkTheme("sandstone")).toBe(false);
  });
});
