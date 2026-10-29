import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HS_MID_WAY, HS_TODAY, HS_STUDENT_NAME } from "./helpers/s11-hs-ui-fixtures";
import { milestoneRows, plannedHalfUnits, upcomingTasks } from "../client/src/lib/hs-journey-extras";
import { HS_DESCRIBED_COURSE_KEYS, courseDescription } from "../client/src/lib/hs-course-descriptions";
import { HighSchoolPageView } from "../client/src/components/high-school/high-school-view";
import { Router } from "wouter";
import { I18nProvider } from "../client/src/i18n";

(globalThis as { React?: unknown }).React = React;

describe("course descriptions", () => {
  it("covers 17 core + 10 elective keys in EN and FR, neutral and without a school name", () => {
    expect(HS_DESCRIBED_COURSE_KEYS.length).toBe(27);
    for (const k of HS_DESCRIBED_COURSE_KEYS) {
      for (const l of ["en", "fr"] as const) {
        const d = courseDescription(k, l);
        expect(d, `${k}/${l}`).toBeTruthy();
        expect(d).not.toMatch(/Tennessee|Meridian|Lumi[eè]re|accredited/i);
      }
      expect(courseDescription(k, "en")).not.toBe(courseDescription(k, "fr"));
    }
    expect(courseDescription("unknown-key", "en")).toBeNull();
  });
});

describe("journey extras", () => {
  it("computes planned credits as the sum of non-replaced courses (not official credit)", () => {
    const planned = plannedHalfUnits(HS_MID_WAY);
    expect(planned).toBeGreaterThan(HS_MID_WAY.credits.earnedHalfUnits);
  });
  it("buckets open tasks by week and never includes official/submitted ones", () => {
    const up = upcomingTasks(HS_MID_WAY, HS_TODAY);
    for (const u of up) expect(["not_started", "in_progress"]).toContain(u.task.status);
    const sorted = [...up].map((u) => u.task.dueDate);
    expect(sorted).toEqual([...sorted].sort());
  });
  it("lists milestones with the current month flagged", () => {
    const view = { ...HS_MID_WAY, milestones: [{ month: "2026-09", cumulativeHalfUnits: 4 }, { month: "2026-10", cumulativeHalfUnits: 8 }] };
    const rows = milestoneRows(view, HS_TODAY);
    expect(rows.map((r) => [r.month, r.past, r.current])).toEqual([["2026-09", true, false], ["2026-10", false, true]]);
  });
});

describe("high school page", () => {
  const render = (lang: "en" | "fr", view = { ...HS_MID_WAY, milestones: [{ month: "2026-11", cumulativeHalfUnits: 6 }] }) =>
    renderToStaticMarkup(
      createElement(Router, { ssrPath: "/high-school" },
        createElement(I18nProvider, { initialLanguage: lang },
          createElement(HighSchoolPageView, { view, today: HS_TODAY, welcome: { name: HS_STUDENT_NAME, photoUrl: null } }))),
    );
  it("shows welcome, planned vs official credits, upcoming tasks, milestones and the syllabus note", () => {
    const html = render("en");
    expect(html).toContain('data-testid="hs-welcome"');
    expect(html).toContain(HS_STUDENT_NAME);
    expect(html).toContain('data-testid="credits-planned"');
    expect(html).toContain('data-testid="credits-official"');
    expect(html).toContain('data-testid="upcoming-tasks"');
    expect(html).toContain('data-testid="milestones-card"');
    expect(html).toContain("General, non-official description");
  });
  it("renders French", () => {
    const html = render("fr");
    expect(html).toContain("Bienvenue, ");
    expect(html).toContain("Jalons mensuels");
    expect(html).toContain("Tâches à venir");
  });
});
