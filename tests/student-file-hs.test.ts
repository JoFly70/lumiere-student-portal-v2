import React from "react";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StudentFileHsOverview, enrollmentCheckpoints, plannedHalfUnits } from "../client/src/components/admin/student-file-hs";
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
    expect(html).toContain("Approval pending");
    expect(html).toContain("Pending");
    expect(html).not.toContain("Old");
    expect(html).toContain('href="/admin/students/s1/high-school"');
  });
  it("staff upload accepts only what the server accepts", () => {
    expect(validateStaffUploadFile({ name: "a.webp", size: 5, type: "" }).valid).toBe(true);
    expect(validateStaffUploadFile({ name: "a.docx", size: 5, type: "" }).valid).toBe(false);
  });
});
