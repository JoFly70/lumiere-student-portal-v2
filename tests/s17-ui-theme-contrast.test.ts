/** Re-audits the generated theme CSS: text roles meet WCAG AA on every surface they appear on. */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { THEMES } from "../client/src/lib/themes";

const css = fs.readFileSync("client/src/styles/themes.css", "utf8");

function tokens(id: string): Record<string, string> {
  const head = id === "lumiere" ? ":root,\nhtml[data-theme=\"lumiere\"] {" : `html[data-theme="${id}"] {`;
  const start = css.indexOf(head);
  expect(start, id).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf("\n}", start));
  return Object.fromEntries([...body.matchAll(/(--t-[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
function lum(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const cr = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe.each(THEMES.map((t) => t.id))("theme %s", (id) => {
  const t = tokens(id);
  it("defines the full token set", () => {
    for (const k of ["--t-bg", "--t-panel", "--t-text", "--t-muted", "--t-accent", "--t-rail-bg", "--t-green", "--t-blue", "--t-amber"]) expect(t[k], k).toMatch(/^#[0-9a-f]{6}$/);
  });
  it("text roles >= 4.5:1 on canvas, panel and panel-3", () => {
    for (const role of ["text", "text-2", "muted", "faint", "heading", "accent-text", "green", "blue", "amber", "red"])
      for (const surface of ["bg", "panel", "panel-3"]) expect(cr(t[`--t-${role}`], t[`--t-${surface}`]), `${role} on ${surface}`).toBeGreaterThanOrEqual(4.5);
  });
  it("button label on accent and rail text on rail >= 4.5:1", () => {
    expect(cr(t["--t-accent-ink"], t["--t-accent"])).toBeGreaterThanOrEqual(4.5);
    for (const role of ["text", "muted", "act"]) expect(cr(t[`--t-rail-${role}`], t["--t-rail-bg"]), role).toBeGreaterThanOrEqual(4.5);
  });
  it("status colours are distinguishable (green, blue, amber differ)", () => {
    expect(new Set([t["--t-green"], t["--t-blue"], t["--t-amber"], t["--t-red"]]).size).toBe(4);
  });
});
