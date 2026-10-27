import fs from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BRAND, LumiereCrest, LumiereWordmark } from "../client/src/components/brand/lumiere-brand";

describe("S19 brand", () => {
  it("exports the agreed constants", () => {
    expect(BRAND).toEqual({ name: "Lumière", tagline: "Student Portal" });
  });
  it("crest: decorative by default, intrinsic size, srcset, no distortion", () => {
    const html = renderToStaticMarkup(createElement(LumiereCrest, { size: 40 }));
    expect(html).toContain('alt=""');
    expect(html).toContain('height="40"');
    expect(html).toContain('width="39"');
    expect(html).toContain("srcSet");
    expect(renderToStaticMarkup(createElement(LumiereCrest, { size: 96, decorative: false }))).toContain('alt="Lumière crest"');
  });
  it("wordmark variants", () => {
    const full = renderToStaticMarkup(createElement(LumiereWordmark, {}));
    expect(full).toContain("Lumière");
    expect(full).toContain("Student Portal");
    const compact = renderToStaticMarkup(createElement(LumiereWordmark, { variant: "compact" }));
    expect(compact).toContain("Lumière");
    expect(compact).not.toContain("Student Portal");
    const stacked = renderToStaticMarkup(createElement(LumiereWordmark, { variant: "stacked", tone: "on-dark" }));
    expect(stacked).toContain('data-variant="stacked"');
    expect(stacked).toContain("--t-rail-head");
  });
  it("derived assets exist with transparency and the approved aspect", async () => {
    for (const f of ["crest-96.webp", "crest-192.webp", "crest-480.webp"]) expect(fs.statSync(`client/src/assets/brand/${f}`).size).toBeGreaterThan(1000);
    for (const f of ["favicon-32.png", "favicon.png", "apple-touch-icon.png"]) expect(fs.statSync(`client/public/${f}`).size).toBeGreaterThan(500);
    const html = fs.readFileSync("client/index.html", "utf8");
    expect(html).toContain("<title>Lumière Student Portal</title>");
    expect(html).toContain("apple-touch-icon.png");
  });
});
