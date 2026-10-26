/**
 * Writes the de-identified S07 scenario workbooks (EPH master+execution v1/v2,
 * RUT master+execution). Run:  npx tsx scripts/s07/build-s07-workbooks.ts
 * Output: tests/fixtures/s07/workbooks/*.xlsx
 */
import fs from "node:fs";
import path from "node:path";
import { buildAllS07 } from "../../tests/fixtures/s07/builders";

const outDir = path.resolve(import.meta.dirname, "..", "..", "tests", "fixtures", "s07", "workbooks");
fs.mkdirSync(outDir, { recursive: true });
for (const f of await buildAllS07()) {
  fs.writeFileSync(path.join(outDir, f.fileName), f.buffer);
  console.log(`wrote ${f.fileName} (${f.buffer.length} bytes)`);
}
