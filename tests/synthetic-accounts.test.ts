import { describe, expect, it } from "vitest";
import { isSyntheticAccount } from "../shared/synthetic-accounts";

describe("isSyntheticAccount", () => {
  it("flags reserved email domains", () => {
    for (const email of ["a@b.invalid", "a@b.test", "a@b.example", "x@example.com", "x@EXAMPLE.org"]) {
      expect(isSyntheticAccount({ email })).toBe(true);
    }
  });
  it("flags synthetic names", () => {
    expect(isSyntheticAccount({ name: "DEMO — Amine" })).toBe(true);
    expect(isSyntheticAccount({ preferred_name: "QA Student" })).toBe(true);
    expect(isSyntheticAccount({ first_name: "TEST" })).toBe(true);
    expect(isSyntheticAccount({ first_name: "S23 SYNTHETIC Student" })).toBe(true);
    expect(isSyntheticAccount({ name: "S24 STAGING Learner" })).toBe(true);
    expect(isSyntheticAccount({ name: "A synthetic one" })).toBe(true);
  });
  it("keeps real people", () => {
    expect(isSyntheticAccount({ email: "sara@gmail.com", name: "Sara Benali", first_name: "Sara" })).toBe(false);
    expect(isSyntheticAccount({ name: "Quentin Adams", first_name: "Qasim" })).toBe(false);
    expect(isSyntheticAccount({ name: "Tesla Moreau" })).toBe(false);
    expect(isSyntheticAccount({ name: "Demore Smith" })).toBe(false);
    expect(isSyntheticAccount({ name: "S2 Kids" })).toBe(false);
    expect(isSyntheticAccount({ email: null, name: null })).toBe(false);
    expect(isSyntheticAccount(null)).toBe(false);
  });
});
