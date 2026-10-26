/**
 * S05 evidence: builds StudentRoadmapView JSON files from synthetic scenario
 * workbooks using the REAL converter (convertWorkbook) and the REAL student
 * projection (projectStudentRoadmap), with a small set of synthetic student
 * progress rows. The output feeds render-student-screens.ts via
 * S05_ROADMAP_FIXTURE so the screenshots show what the server would serve.
 *
 *   npx tsx scripts/s05/build-real-projection-views.ts <outDir>
 */
import fs from "node:fs";
import path from "node:path";
import { convertWorkbook } from "../../server/services/roadmap-import";
import { projectStudentRoadmap } from "../../shared/student-roadmap-projection";
import { ITEM_LEVEL_TASK_KEY, type RoadmapContent, type RoadmapProgressRecord } from "../../shared/student-roadmap-contract";
import { s05ScenariosById } from "../../tests/fixtures/s05";

const outDir = path.resolve(process.argv[2] ?? "docs/recovery/s05-evidence/real-projection");
fs.mkdirSync(outDir, { recursive: true });

function progressFor(content: RoadmapContent): RoadmapProgressRecord[] {
  const at = "2026-10-20T12:00:00.000Z";
  const rows: RoadmapProgressRecord[] = [];
  const active = content.items.filter((i) => i.planStatus === "planned");
  // First item complete at the provider, second half-way through its tasks, third just started.
  const [first, second, third] = active;
  if (first) {
    for (const t of first.tasks) rows.push({ itemKey: first.key, taskKey: t.key, status: "graded", revision: 1, updatedAt: at });
    rows.push({ itemKey: first.key, taskKey: ITEM_LEVEL_TASK_KEY, status: "provider_complete", revision: 1, updatedAt: at });
  }
  if (second) {
    second.tasks.forEach((t, i) => {
      if (i < Math.ceil(second.tasks.length / 2)) rows.push({ itemKey: second.key, taskKey: t.key, status: "graded", revision: 1, updatedAt: at });
    });
    if (second.tasks[Math.ceil(second.tasks.length / 2)]) {
      rows.push({ itemKey: second.key, taskKey: second.tasks[Math.ceil(second.tasks.length / 2)].key, status: "submitted", revision: 1, updatedAt: at });
    }
  }
  if (third?.tasks[0]) rows.push({ itemKey: third.key, taskKey: third.tasks[0].key, status: "in_progress", revision: 1, updatedAt: at });
  return rows;
}

for (const id of ["R", "Rc", "S"] as const) {
  const scenario = s05ScenariosById[id];
  const buffer = await scenario.workbook.build();
  const conversion = await convertWorkbook(buffer, { fileName: scenario.workbook.fileName });
  if (!conversion.content) throw new Error(`${id}: conversion produced no content`);
  const blocking = conversion.exceptions.filter((e) => e.severity === "blocking");
  if (blocking.length) throw new Error(`${id}: blocking exceptions ${blocking.map((e) => e.code).join(",")}`);
  const view = projectStudentRoadmap({
    content: conversion.content,
    versionNumber: 1,
    publishedAt: "2026-10-01T09:00:00.000Z",
    preview: false,
    progress: progressFor(conversion.content),
    degreeProgress: scenario.foundation,
    previousVersions: [],
  });
  const file = path.join(outDir, `scenario-${id.toLowerCase()}-view.json`);
  fs.writeFileSync(file, JSON.stringify(view, null, 2));
  console.log(`${id}: ${conversion.content.items.length} items, ${conversion.exceptions.length} exceptions → ${file}`);
}
