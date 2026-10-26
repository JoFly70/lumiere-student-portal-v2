/**
 * S07 finding 1: the student status colours are a small semantic language and
 * every pair meets WCAG contrast in light and dark. Parses the real index.css.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync(path.resolve(__dirname, "../client/src/index.css"), "utf8");

function block(selector: string): Record<string, string> {
  // The token layer is shared: `.student-surface, .staff-surface, body.staff-shell { ... }` is one rule.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`\\n${escaped}(?:,[^{]*)? \\{`).exec(css);
  expect(m).not.toBeNull();
  const start = m!.index;
  const end = css.indexOf("\n}", start);
  const out: Record<string, string> = {};
  for (const m of css.slice(start, end).matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const LIGHT = block(".student-surface");
const DARK = { ...LIGHT, ...block(".dark .student-surface") };

function hslToRgb(triple: string): [number, number, number] {
  const m = triple.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (!m) throw new Error(`bad hsl triple: ${triple}`);
  const h = Number(m[1]);
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}
function luminance(triple: string): number {
  const [r, g, b] = hslToRgb(triple).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const STATUSES = ["official", "applied", "provider", "progress", "submitted", "notstarted", "attention"] as const;

describe.each([
  ["light", LIGHT],
  ["dark", DARK],
])("S07 student tokens (%s)", (_name, t) => {
  it.each(STATUSES)("status %s: text/graphic >= 4.5:1 on the card, the page and its own tint", (s) => {
    const fg = t[`--st-${s}`];
    const soft = t[`--st-${s}-soft`];
    expect(fg, s).toBeTruthy();
    expect(soft, s).toBeTruthy();
    expect(contrast(fg, t["--s-card"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(fg, t["--s-bg"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(fg, soft)).toBeGreaterThanOrEqual(4.5);
  });

  it("official pill: seal ink on the seal fill", () => {
    expect(contrast(t["--s-seal-ink"], t["--st-official"])).toBeGreaterThanOrEqual(4.5);
  });

  it("brand gold: ink on bright gold fill and gold ink on card/soft meet 4.5:1; gold line meets 3:1", () => {
    expect(contrast(t["--s-gold-bright-ink"], t["--s-gold-bright"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["--s-gold-ink"], t["--s-card"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["--s-gold-ink"], t["--s-gold-soft"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["--s-gold"], t["--s-card"])).toBeGreaterThanOrEqual(3);
  });

  it("body, muted text and strong lines", () => {
    expect(contrast(t["--s-ink"], t["--s-bg"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["--s-muted"], t["--s-card"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["--s-muted"], t["--s-bg"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["--s-line-strong"], t["--s-card"])).toBeGreaterThanOrEqual(3);
  });

  it("the seven statuses have seven distinct colours", () => {
    const keys = STATUSES.map((s) => t[`--st-${s}`]);
    expect(new Set(keys).size).toBe(STATUSES.length);
  });
});

describe("S07 admin tokens are untouched", () => {
  it("the global --primary is not redefined by the student rules", () => {
    const staffAt = css.indexOf("Staff shell (S10 staff pass)");
    expect(staffAt).toBeGreaterThan(-1);
    const studentRules = css.slice(css.indexOf("Student-facing surface (S05"), staffAt);
    expect(studentRules).not.toMatch(/\s--primary:/);
    expect(studentRules).not.toMatch(/\s--background:/);
  });

  it("the staff pass remaps the shadcn variables only under body.staff-shell, never on student scopes", () => {
    const staffRules = css.slice(css.indexOf("Staff shell (S10 staff pass)"));
    expect(staffRules).toMatch(/\nbody\.staff-shell \{[^}]*--primary: var\(--s-seal\)/);
    expect(staffRules).not.toMatch(/\.student-(surface|shell)[^{]*\{[^}]*--primary:/);
  });
});
