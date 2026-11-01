import { describe, expect, it } from "vitest";
import { IMPORT_ISSUE_CODES, IMPORT_FIELDS, IMPORT_SOURCE_KINDS, IMPORT_STATUSES } from "../shared/s30-contract";
import {
  actionsFor, cleanMapping, fileProblem, filterRows, formatBytes, initialMapping, missingRequired, paginate, rollbackReasonValid, shortHash, sortIssues, stepStates, uploadReasonKey,
} from "../client/src/components/s30/imports/import-helpers";
import { s30ImportsEn, s30ImportsFr } from "../client/src/i18n/modules/s30-imports";

describe("import stepper", () => {
  it("places each status on the right step", () => {
    expect(stepStates("uploaded").steps).toMatchObject({ upload: "done", map: "current", review: "todo" });
    expect(stepStates("validated").steps).toMatchObject({ map: "done", review: "current", approve: "todo" });
    expect(stepStates("approved").steps).toMatchObject({ approve: "done", commit: "current" });
    expect(Object.values(stepStates("committed").steps).every((s) => s === "done")).toBe(true);
    expect(stepStates("rolled_back").terminal).toBe("rolled_back");
    expect(stepStates("discarded").terminal).toBe("discarded");
    expect(stepStates(null).steps.upload).toBe("current");
  });
});

describe("role actions", () => {
  it("staff validate and discard only; admin also approves, commits, rolls back", () => {
    expect(actionsFor("staff", "validated")).toEqual({ validate: true, discard: true, approve: false, commit: false, rollback: false });
    expect(actionsFor("admin", "validated")).toMatchObject({ approve: true, commit: false });
    expect(actionsFor("admin", "approved")).toMatchObject({ commit: true, approve: false, discard: false });
    expect(actionsFor("admin", "committed")).toMatchObject({ rollback: true });
    expect(actionsFor("staff", "committed").rollback).toBe(false);
    expect(actionsFor("student", "uploaded")).toMatchObject({ validate: false, discard: false });
    expect(actionsFor("admin", "discarded")).toMatchObject({ validate: false, rollback: false });
  });
});

describe("mapping", () => {
  const headers = ["Code", "Course name", "Pct"];
  it("prefers the saved mapping and drops headers not in the file", () => {
    expect(initialMapping({ headers, mapping: { student_code: "Code", course: "Gone" }, suggestedMapping: { course: "Course name" } })).toEqual({ student_code: "Code" });
    expect(initialMapping({ headers, mapping: null, suggestedMapping: { student_code: "Code", course: "Course name", percent_complete: "Pct" } })).toMatchObject({ percent_complete: "Pct" });
  });
  it("reports missing required fields and cleans blanks", () => {
    expect(missingRequired({ student_code: "Code" })).toEqual(["course"]);
    expect(missingRequired({ student_code: "a", course: "b" })).toEqual([]);
    expect(cleanMapping({ student_code: " Code ", course: "", task: undefined })).toEqual({ student_code: "Code" });
  });
});

describe("file pre-check", () => {
  it("rejects wrong type, empty and oversized files", () => {
    expect(fileProblem({ name: "a.pdf", size: 10 })).toBe("unsupported_format");
    expect(fileProblem({ name: "a.CSV", size: 0 })).toBe("empty");
    expect(fileProblem({ name: "a.xlsx", size: 6 * 1024 * 1024 })).toBe("too_large");
    expect(fileProblem({ name: "a.csv", size: 100 })).toBeNull();
  });
  it("maps server reasons to keys", () => {
    expect(uploadReasonKey("no_header")).toBe("imp.reject.no_header");
    expect(uploadReasonKey("weird")).toBe("imp.reject.generic");
    for (const r of ["too_large", "empty", "unsupported_format", "unreadable", "no_header", "too_many_rows"]) expect(s30ImportsEn).toHaveProperty(uploadReasonKey(r));
  });
});

describe("rows", () => {
  const rows = [
    { outcome: "valid", diff: "new" }, { outcome: "warning", diff: "changed" }, { outcome: "invalid", diff: null }, { outcome: "valid", diff: "unchanged" }, { outcome: "warning", diff: "duplicate_in_file" },
  ] as const;
  it("filters by outcome and difference", () => {
    expect(filterRows(rows, "all")).toHaveLength(5);
    expect(filterRows(rows, "needs_attention")).toHaveLength(3);
    expect(filterRows(rows, "valid")).toHaveLength(2);
    expect(filterRows(rows, "changed")).toHaveLength(1);
    expect(filterRows(rows, "duplicate_in_file")).toHaveLength(1);
  });
  it("paginates 50 per page and clamps", () => {
    const many = Array.from({ length: 120 }, (_, i) => i);
    expect(paginate(many, 1)).toMatchObject({ pages: 3, from: 1, to: 50 });
    expect(paginate(many, 3)).toMatchObject({ from: 101, to: 120 });
    expect(paginate(many, 99).page).toBe(3);
    expect(paginate([], 1)).toMatchObject({ pages: 1, from: 0, to: 0 });
  });
  it("orders issues errors first", () => {
    const out = sortIssues([{ code: "no_measure", field: null, severity: "info" }, { code: "bad_date", field: "reported_on", severity: "error" }, { code: "future_date", field: null, severity: "warning" }]);
    expect(out.map((i) => i.severity)).toEqual(["error", "warning", "info"]);
  });
});

describe("formatting and validation", () => {
  it("shortens hashes and sizes", () => {
    const h = "a".repeat(64);
    expect(shortHash(h)).toBe("aaaaaaaa…aaaaaa");
    expect(shortHash("abc")).toBe("abc");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
  });
  it("requires a rollback reason of at least 3 characters", () => {
    expect(rollbackReasonValid("  ab ")).toBe(false);
    expect(rollbackReasonValid("typo")).toBe(true);
  });
});

describe("s30 imports i18n", () => {
  it("has every FR key, differing from EN, with typographic apostrophes", () => {
    const allowed = new Set(["Total", "Format", "Actions"]);
    for (const k of Object.keys(s30ImportsEn) as (keyof typeof s30ImportsEn)[]) {
      expect(s30ImportsFr[k], k).toBeTruthy();
      if (!allowed.has(s30ImportsEn[k])) expect(s30ImportsFr[k], k).not.toBe(s30ImportsEn[k]);
      expect(s30ImportsFr[k], k).not.toContain("'");
      expect(s30ImportsEn[k], k).not.toContain("'");
    }
  });
  it("covers every status, source kind, field and issue code", () => {
    for (const s of IMPORT_STATUSES) expect(s30ImportsEn).toHaveProperty(`imp.status.${s}`);
    for (const s of IMPORT_SOURCE_KINDS) { expect(s30ImportsEn).toHaveProperty(`imp.source.${s}.label`); expect(s30ImportsEn).toHaveProperty(`imp.source.${s}.desc`); }
    for (const f of IMPORT_FIELDS) expect(s30ImportsEn).toHaveProperty(`imp.map.field.${f}`);
    for (const c of IMPORT_ISSUE_CODES) expect(s30ImportsEn).toHaveProperty(`imp.issue.${c}`);
  });
});
