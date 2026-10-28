# S22b: three first-student operational fixes

## Scope

- Admin-only Lead activation uses the existing guarded status endpoint, including
  the student workspace's no-academic-assignment state.
- Staff/admin upload on behalf uses the existing private signed-upload and
  document-registration APIs. Uploads remain pending review and student-visible.
  The admin workspace stays admin-only; staff use Reviews & results in the
  already-authorized high-school workspace.
- Roadmap publication validates the immutable diploma contract's core allocation
  and minimum elective coverage. Standard plans require 16 core plus at least
  five elective credits. Enrollment exceptions and incomplete draft saving remain
  supported; no school-approved course titles are invented.

## Previously completed hosted staging evidence

The isolated staging Replit completed a synthetic browser/API smoke on
2026-10-28. Admin activation, staff private upload, student document visibility,
login/session reload, role isolation, incomplete-publication rejection, and
incomplete draft saving passed. No complete plan was submitted for publication.

The run cleaned up its four synthetic authentication users, one student, one
invitation, and two uploaded objects. Append-only synthetic audit entries remain.
The execution JSON and screenshots are retained in that staging Replit rather
than included as generated artifacts in this source commit.

Unrelated/global list requests were deliberately blocked in the browser smoke;
the evidence does not claim unrestricted dashboard-data verification.

## Reproduce offline checks

The selective candidate based on the latest upstream S22b branch was checked
again during synchronization: TypeScript PASS, production build PASS, and all
236 tests across the ten suites below PASS, with no skipped tests. Runtime
database variables and Supabase credentials were removed from the validation
child processes. Database suites used only their disposable local PostgreSQL
harness. The build emitted a non-failing bundle-size warning.

Run with runtime database variables and credentials removed from the child
process. The database-backed suites below must use their disposable local
PostgreSQL harness, never a managed or hosted database. Set S05_PG_BIN_DIR to the
directory containing locally installed PostgreSQL binaries, if required.

```sh
npm run check
npm run build
npx vitest run \
  tests/s11-hs-projection.test.ts \
  tests/s11-hs-service-db.test.ts \
  tests/s11-hs-http-e2e.test.ts \
  tests/s11-hs-staff-ui.test.ts \
  tests/s13-security-hs.test.ts \
  tests/s17-security-documents.test.ts \
  tests/phase5a1-admin-student-workspace.test.ts \
  tests/phase5d-documents-support.test.ts \
  tests/s22-roadmap-publication.test.ts \
  tests/s22-student-operations-ui.test.ts --maxWorkers=1
```

This selective synchronization excludes local Replit configuration, startup
settings, credential values, agent memory, generated bundles, and screenshots.
Independent upstream branch documentation is preserved.

## Next release gate

Obtain confirmed awarding-school elective offerings totaling at least five
credits before preparing a real student's publishable standard diploma plan.
These changes do not authorize deployment, production access, or publication.
