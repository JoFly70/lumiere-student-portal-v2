import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sidebarSource = readFileSync(
  new URL("./app-sidebar.tsx", import.meta.url),
  "utf8",
);
const progressStatesSource = readFileSync(
  new URL("./student-progress/states.tsx", import.meta.url),
  "utf8",
);

describe("student portal staging corrections", () => {
  it("does not expose the Flight Deck Preview prototype in any sidebar role", () => {
    expect(sidebarSource).not.toContain("Flight Deck Preview");
    expect(sidebarSource).not.toContain("PREVIEW_FLIGHT_DECK_PATH");
    expect(sidebarSource).not.toContain("PROTOTYPES_ENABLED");
  });

  it("keeps the not-ready state explicit about advisor linking and support", () => {
    expect(progressStatesSource).toContain("Your account is ready.");
    expect(progressStatesSource).toContain("linking your student profile and");
    expect(progressStatesSource).toContain("academic plan");
    expect(progressStatesSource).toContain('<Link href="/support">Contact Support</Link>');
  });
});
