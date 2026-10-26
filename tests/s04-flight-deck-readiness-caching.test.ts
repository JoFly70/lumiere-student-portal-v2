import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FLIGHT_DECK_READINESS_QUERY_OPTIONS as options,
  STUDENT_RECORD_MISSING_POLL_MS,
} from "../client/src/lib/student-progress-queries";

describe("S04 Flight Deck readiness caching", () => {
  it("overrides the global infinite staleTime so a new student record is detected", () => {
    expect(options.staleTime).toBe(0);
    expect(options.refetchOnMount).toBe("always");
    expect(options.refetchOnWindowFocus).toBe(true);
  });

  it("polls only while the record is missing", () => {
    expect(options.refetchInterval({ state: { data: "missing" } })).toBe(STUDENT_RECORD_MISSING_POLL_MS);
    expect(STUDENT_RECORD_MISSING_POLL_MS).toBeGreaterThanOrEqual(30_000);
    expect(options.refetchInterval({ state: { data: "ready" } })).toBe(false);
    expect(options.refetchInterval({ state: { data: undefined } })).toBe(false);
  });

  it("is wired into the Flight Deck readiness query", () => {
    const src = readFileSync(resolve(process.cwd(), "client/src/pages/flight-deck.tsx"), "utf8");
    expect(src).toContain("...FLIGHT_DECK_READINESS_QUERY_OPTIONS");
    expect(src).toContain("flight-deck-readiness");
    expect(src).not.toContain("/api/flight-deck'");
    expect(src).not.toContain('"/api/flight-deck"');
  });
});
