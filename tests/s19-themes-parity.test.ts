/**
 * S19: the Portal's nine packs equal the Lumière ClientDesk palette, role for role.
 * Expected values are hard-coded fixtures taken from ClientDesk's generator (palette approved for Portal use).
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { THEMES, THEME_STORAGE_KEY, applyTheme, resolveTheme, saveTheme, storedTheme, type ThemeStore } from "../client/src/lib/themes";

const css = fs.readFileSync("client/src/styles/themes.css", "utf8");

// id: [label, bg, panel, p2, p3, rail-bg, rail-head, rail-act, text, heading, muted, gold, gold-ink, accent-text, red, amber, green, blue]
const CD: Record<string, string[]> = {
  lumiere: ["Lumière Desk", "#f4f3ef", "#ffffff", "#fbfaf8", "#efede7", "#0f1522", "#f4efe4", "#e8cc8e", "#1b1f27", "#10141c", "#535a66", "#c29a4e", "#1a1407", "#74561b", "#b42318", "#8a5300", "#1c6b43", "#2b53b8"],
  "lumiere-dark": ["Lumière Dark", "#09090a", "#0f0f11", "#141417", "#1a1a1e", "#0c0c0e", "#efe9df", "#e2cb98", "#ebe6de", "#f1ece4", "#99948b", "#c9aa6c", "#17130b", "#e2cb98", "#d98b7f", "#d7b56d", "#9ec4a7", "#a9bde6"],
  midnight: ["Midnight Slate", "#0b0e14", "#121722", "#161c29", "#1c2331", "#0e121a", "#eef1f5", "#b3c2d8", "#e7eaf0", "#f2f4f8", "#9ca4b2", "#8b9fbb", "#0b0e14", "#b3c2d8", "#d49a91", "#cdb17c", "#9dbca7", "#a9bde6"],
  monaco: ["Monaco Navy", "#0b1120", "#111a2e", "#151f36", "#1b2640", "#0d1425", "#f4efe5", "#ddca9e", "#f2ede3", "#f7f2e8", "#aaa599", "#c8ae76", "#0a1020", "#ddca9e", "#d99a90", "#d4b57a", "#a3c2ab", "#a9bde6"],
  forest: ["Forest Ledger", "#0b100d", "#111915", "#16201a", "#1c2821", "#0e1411", "#efebdf", "#cdbd90", "#ece8dc", "#f3efe3", "#a1a496", "#b09a64", "#0b100d", "#cdbd90", "#d49b8e", "#cdb178", "#a4bd9c", "#a9bde6"],
  bordeaux: ["Bordeaux Reserve", "#120a0c", "#1b1013", "#211419", "#29191f", "#160d10", "#f3ebe5", "#d9bcab", "#f0e8e2", "#f6eee8", "#ab9993", "#c09a85", "#150c0e", "#d9bcab", "#dca195", "#d1b47d", "#a9bea3", "#a9bde6"],
  graphite: ["Graphite Executive", "#131416", "#1a1b1e", "#1f2124", "#26282c", "#161719", "#f3f1ed", "#d4d9de", "#f1efeb", "#f7f5f1", "#a7a6a2", "#b7bdc5", "#131416", "#d4d9de", "#d69c93", "#cfb47f", "#a3bfaa", "#a9bde6"],
  sandstone: ["Sandstone Light", "#f3efe7", "#faf7f1", "#efe9de", "#e6dfd1", "#ece6da", "#23201b", "#634c24", "#23201b", "#1b1915", "#58514a", "#8a6d3c", "#fffcf6", "#634c24", "#9e4035", "#7f5a12", "#3b6a49", "#2b53b8"],
  teal: ["Teal Reserve", "#091214", "#0f1c1e", "#142325", "#192b2e", "#0c1719", "#f0f2ed", "#b0cfcb", "#edefe9", "#f3f5f0", "#9daba8", "#86aba7", "#091214", "#b0cfcb", "#d69b91", "#cfb27b", "#a1c3a6", "#a9bde6"],
};
const ROLES = ["bg", "panel", "panel-2", "panel-3", "rail-bg", "rail-head", "rail-act", "text", "heading", "muted", "accent", "accent-ink", "accent-text", "red", "amber", "green", "blue"];

function block(id: string): Record<string, string> {
  const head = id === "lumiere" ? ':root,\nhtml[data-theme="lumiere"] {' : `html[data-theme="${id}"] {`;
  const start = css.indexOf(head);
  expect(start, id).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf("\n}", start));
  return Object.fromEntries([...body.matchAll(/(--t-[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

describe("S19 ClientDesk palette parity", () => {
  it("registers exactly the nine packs with ClientDesk labels", () => {
    expect(THEMES.map((t) => t.id)).toEqual(Object.keys(CD));
    expect(THEMES.map((t) => t.label)).toEqual(Object.values(CD).map((v) => v[0]));
  });
  describe.each(Object.keys(CD))("%s", (id) => {
    const t = block(id);
    const f = CD[id];
    it("matches ClientDesk values for canvas, panels, rail, text, accent and status", () => {
      ROLES.forEach((role, i) => expect(t[`--t-${role}`], `${id} ${role}`).toBe(f[i + 1]));
    });
    it("swatch equals ClientDesk [canvas, rail-or-panel-2, gold, text]", () => {
      const sw = THEMES.find((x) => x.id === id)!.swatch;
      expect(sw[0]).toBe(f[1]);
      expect(sw[2]).toBe(f[11]);
      expect(sw[3]).toBe(f[8]);
      expect(sw[1]).toBe(id === "lumiere" ? f[5] : f[3]);
    });
    it("declares the full role set (card, lines, rail, focus, status variants)", () => {
      for (const k of ["card", "card-shadow", "line", "line-2", "line-3", "faint", "figure", "accent-2", "accent-dim", "accent-line", "red-dim", "red-line", "amber-dim", "green-dim", "blue-dim",
        "hover", "focus", "sel", "backdrop", "shadow-color", "rail-bg2", "rail-text", "rail-muted", "rail-sub", "rail-actbg", "rail-line", "rail-hover", "rail-alert", "rail-alertbg"])
        expect(t[`--t-${k}`], k).toBeTruthy();
      expect(t["--t-card"]).toBe(f[2]);
    });
    it("bridges shadcn, student and sidebar variables from the same palette", () => {
      const sel = id === "lumiere" ? 'html[data-theme="lumiere"]' : `html[data-theme="${id}"]`;
      const from = css.indexOf(`${sel} {\n  --background`);
      expect(from).toBeGreaterThan(-1);
      expect(css.slice(from, css.indexOf("\n}", from))).toMatch(/--primary: [\d.]+ [\d.]+% [\d.]+%;/);
      expect(css).toContain(`${sel} body.student-shell`);
      expect(css).toContain(`${sel} .student-surface`);
    });
  });
  it("themes.css equals the generator output (--check)", () => {
    expect(() => execFileSync("python3", ["scripts/s19/gen-portal-themes.py", "--check"], { stdio: "pipe" })).not.toThrow();
  });
  it("generator contrast audit passes", () => {
    expect(() => execFileSync("python3", ["scripts/s19/gen-portal-themes.py", "--audit"], { stdio: "pipe" })).not.toThrow();
  });
});

describe("S19 theme persistence", () => {
  const mem = (): ThemeStore & { d: Record<string, string> } => {
    const d: Record<string, string> = {};
    return { d, getItem: (k) => d[k] ?? null, setItem: (k, v) => void (d[k] = v) };
  };
  it("a chosen pack survives a reload (save -> new read)", () => {
    const store = mem();
    for (const id of Object.keys(CD)) {
      saveTheme(id as never, store);
      expect(storedTheme(store)).toBe(id);
      expect(store.d[THEME_STORAGE_KEY]).toBe(id);
    }
  });
  it("applies data-theme + colour scheme, and falls back for unknown values", () => {
    const attrs: Record<string, string> = {};
    const root = { setAttribute: (n: string, v: string) => void (attrs[n] = v), classList: { add() {}, remove() {} }, style: {} as { colorScheme?: string } };
    expect(applyTheme("sandstone", root)).toBe("sandstone");
    expect(root.style.colorScheme).toBe("light");
    expect(resolveTheme("nope")).toBe("lumiere");
  });
  it("index.html bootstrap lists the same ids, key and dark flags as themes.ts", () => {
    const html = fs.readFileSync("client/index.html", "utf8");
    expect(html).toContain(THEME_STORAGE_KEY);
    for (const t of THEMES) expect(html).toContain(`${/-/.test(t.id) ? `"${t.id}"` : t.id}: ${t.dark ? 1 : 0}`);
  });
});
