import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LumiereOrb } from "../client/src/components/s27/lumiere-orb";

const css = fs.readFileSync(path.resolve(import.meta.dirname, "../client/src/styles/student-s27.css"), "utf8");

describe("S27 Lumière orb", () => {
  it("is decorative by default, with eyes and mouth, sized by --s", () => {
    const html = renderToStaticMarkup(createElement(LumiereOrb, { size: 52 }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('--s:52px');
    expect(html).toContain('<i class="l">');
    expect(html).toContain('<i class="r">');
    expect(html).toContain('data-state="idle"');
  });
  it("carries think / talk state classes and an accessible name when standing alone", () => {
    expect(renderToStaticMarkup(createElement(LumiereOrb, { state: "think" }))).toContain('class="lm-orb think"');
    expect(renderToStaticMarkup(createElement(LumiereOrb, { state: "talk" }))).toContain('class="lm-orb talk"');
    const labelled = renderToStaticMarkup(createElement(LumiereOrb, { label: "Lumière" }));
    expect(labelled).toContain('role="img"');
    expect(labelled).not.toContain("aria-hidden");
  });
  it("all orb motion lives inside prefers-reduced-motion: no-preference (static portrait otherwise)", () => {
    const orbCss = css.slice(css.indexOf("Lumière orb"));
    const animated = orbCss.split("\n").filter((l) => /animation:/.test(l));
    expect(animated.length).toBeGreaterThan(3);
    const guard = orbCss.indexOf("@media (prefers-reduced-motion:no-preference)");
    expect(guard).toBeGreaterThan(-1);
    for (const l of animated) expect(orbCss.indexOf(l)).toBeGreaterThan(guard);
  });
});
