/**
 * Writes every synthetic S05 scenario workbook (and the AI package JSON) so
 * humans can open them. Run:  npx tsx scripts/s05/build-scenario-workbooks.ts
 * Output: tests/fixtures/s05/workbooks/*.xlsx and tests/fixtures/s05/ai-package-scenario-s.json
 */
import fs from "node:fs";
import path from "node:path";
import { aiPackageScenarioS, s05Scenarios } from "../../tests/fixtures/s05";

const outDir = path.resolve(import.meta.dirname, "..", "..", "tests", "fixtures", "s05", "workbooks");
fs.mkdirSync(outDir, { recursive: true });

for (const scenario of s05Scenarios) {
  const entries = [
    { fileName: scenario.workbook.fileName, build: scenario.workbook.build },
    ...scenario.revisions.map((r) => ({ fileName: r.fileName, build: r.build })),
  ];
  for (const entry of entries) {
    const buf = await entry.build();
    fs.writeFileSync(path.join(outDir, entry.fileName), buf);
    console.log(`${scenario.id}: wrote ${entry.fileName} (${buf.length} bytes)`);
  }
}

const pkgPath = path.resolve(outDir, "..", "ai-package-scenario-s.json");
fs.writeFileSync(pkgPath, JSON.stringify(aiPackageScenarioS, null, 2) + "\n");
console.log(`S: wrote ${path.basename(pkgPath)}`);
