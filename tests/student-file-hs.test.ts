import React from "react";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StudentFileHsOverview, StudentFileHsAcademics, enrollmentCheckpoints, plannedHalfUnits } from "../client/src/components/admin/student-file-hs";
import { validateStaffUploadFile } from "../client/src/components/admin/student-documents-upload-logic";

const course = (key: string, title: string, halfUnits: number, status = "planned") => ({ key, title, areaKey: "core", halfUnits, status, replacesCourseKey: null, plannedStart: "2026-11-01", plannedEnd: "2026-12-15", tasks: [] });
const state: any = {
  studentId: "s1", enrollments: [], hasUniversityProgram: false, guardians: [], events: [],
  current: {
    enrollment: { id: "e1", status: "active", programTitle: "Ontario Secondary School Diploma", startedOn: "2026-10-01", targetCompletionDate: "2027-06-30", institutionDisclosed: false, schoolStudentRef: null },
    published: { versionNumber: 2, content: { courses: [course("a", "English 11", 2), course("b", "TEST ONLY Course", 1), course("c", "Old", 2, "removed")] } },
    draft: null,
    credits: { requiredHalfUnits: 60, earnedHalfUnits: 4, awaitingConfirmationHalfUnits: 1, remainingHalfUnits: 56, core: { requiredHalfUnits: 36, earnedHalfUnits: 4 }, elective: { requiredHalfUnits: 24, earnedHalfUnits: 0 } },
    reviewQueue: [{ courseKey: "a" }], results: [], priorEducation: [], graduation: { status: "in_progress" },
  },
};
const student = { id: "s1", status: "active", user_id: null };

describe("HS-only student file overview", () => {
  it("separates planned, earned and reported credit and never fabricates checkpoints", () => {
    expect(plannedHalfUnits(state)).toBe(3);
    const cps = enrollmentCheckpoints({ student, state });
    expect(cps.filter((c) => c.done).map((c) => c.key)).toEqual(["roadmap"]);
    const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client: new QueryClient() }, React.createElement(Router, { ssrPath: "/x" },
      React.createElement(StudentFileHsOverview, { studentId: "s1", student, state, attention: [] }))));
    expect(html).toContain("Ontario Secondary School Diploma");
    expect(html).toContain("Planned");
    expect(html).toContain("Officially earned");
    expect(html).toContain("Reported, awaiting confirmation");
    // The course list lives on the Academics tab since S26.
    const academics = renderToStaticMarkup(React.createElement(QueryClientProvider, { client: new QueryClient() }, React.createElement(Router, { ssrPath: "/x" },
      React.createElement(StudentFileHsAcademics, { studentId: "s1", state }))));
    expect(academics).toContain("Approval pending");
    expect(academics).not.toContain(">Old<");
    expect(html).toContain("Pending");
    expect(html).not.toContain("Old");
    expect(html).toContain('href="/admin/students/s1/high-school"');
  });
  it("staff upload accepts only what the server accepts", () => {
    expect(validateStaffUploadFile({ name: "a.webp", size: 5, type: "" }).valid).toBe(true);
    expect(validateStaffUploadFile({ name: "a.docx", size: 5, type: "" }).valid).toBe(false);
  });
});

import { contractGates, plannedCourses, isDraftPlan, coursePhase, isTestOnlyTitle } from "../client/src/components/admin/student-file-hs";
describe("S26 contract gates and draft plan (real-student pre-enrollment)", () => {
  const course = { key: "english-1", title: "English 1", areaKey: "english", halfUnits: 2, status: "planned", replacesCourseKey: null, plannedStart: null, plannedEnd: null,
    tasks: [{ key: "english-1-target", kind: "lesson", title: "Planning target: accelerated weeks 1–4 after activation (not a school deadline)", dueDate: null }] };
  const base: any = { current: { enrollment: { startedOn: null, institutionDisclosed: false }, published: null, draft: { content: { courses: [course] } }, priorEducation: [] } };
  it("shows the draft to staff, labelled as draft, with the relative phase", () => {
    expect(isDraftPlan(base)).toBe(true);
    expect(plannedCourses(base)).toHaveLength(1);
    expect(coursePhase(course as any)).toBe("Weeks 1–4 after activation");
    expect(isTestOnlyTitle("Human Relations — PROPOSED — AWAITING SCHOOL ACCEPTANCE")).toBe(true);
  });
  it("marks nothing done without a record; relative deadlines wait for their anchor", () => {
    const gates = contractGates({ state: base, documents: [{ doc_type: "consent_form", status: "pending" } as any], billing: { student: { state: "configured", currency: "USD", netObligationCents: 1, paidCents: 0 } } as any });
    const by = Object.fromEntries(gates.map((g) => [g.key, g]));
    expect(gates.every((g) => g.status !== "done")).toBe(true);
    expect(by.agreement.detail).toMatch(/signature not verified/);
    expect(by.english.status).toBe("not_set");
    expect(by.support.detail).toMatch(/Date not yet set/);
    const signed = contractGates({ state: { current: { ...base.current, enrollment: { startedOn: "2027-01-04", institutionDisclosed: false } } } as any,
      documents: [{ doc_type: "consent_form", status: "verified", verified_at: "2026-11-10T00:00:00Z" } as any] });
    const s = Object.fromEntries(signed.map((g) => [g.key, g]));
    expect(s.english.detail).toBe("Due by 2026-12-10.");
    expect(s.records.detail).toBe("Due by 2027-04-04.");
    expect(s.support.detail).toBe("Runs to 2027-10-04.");
  });
});
