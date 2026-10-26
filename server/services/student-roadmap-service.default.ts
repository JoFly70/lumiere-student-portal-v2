/**
 * Production wiring of the student roadmap service: real Postgres via
 * server/lib/db.ts, the real validation module and the canonical S04 degree
 * progress loader.
 */
import { db } from "../lib/db";
import { roadmapRepository, type Tx } from "../repositories/student-roadmap-repo";
import { createStudentRoadmapService } from "./student-roadmap-service";
import { diffRoadmapContent, validateRoadmapContent } from "@shared/student-roadmap-validation";
import { loadStudentDegreeProgressView } from "../routes/student-degree-progress";

export const defaultStudentRoadmapService = createStudentRoadmapService({
  repo: roadmapRepository,
  transaction: (fn) => db.transaction((tx) => fn(tx as unknown as Tx)),
  readTx: db,
  loadDegreeProgress: (studentId) => loadStudentDegreeProgressView(studentId),
  validate: validateRoadmapContent,
  diff: diffRoadmapContent,
  now: () => new Date(),
});
