# S04 — Student-facing canonical academic experience: progress record

**Branch:** `claude/s04-student-canonical-experience`, based on the accepted S03 commit `8f97ae9`. Not merged to `main`. Nothing was deployed, no real data was migrated, no payments were enabled and no student accounts were activated.

## Academic defects corrected
- **P1, deactivated requirements** (`server/repositories/degree-evaluation-snapshot-repo.ts`, `shared/degree-evaluation-snapshot.ts`):
  - The repository now also loads soft-deactivated requirements of the same program version, but only those that a placement or exception references. They form a separate fact collection that is never evaluated.
  - Revoked and superseded bindings to such a requirement are valid. They stay in the facts and the fingerprint for traceability.
  - Active bindings still fail closed, with `PLACEMENT_BOUND_TO_INACTIVE_REQUIREMENT` or `EXCEPTION_BOUND_TO_INACTIVE_REQUIREMENT`. Unknown requirement ids keep their existing codes. Malformed inactive facts fail with `INVALID_INACTIVE_REQUIREMENT_FACT`.
  - Students with no such references get byte-identical facts and an identical fingerprint. A test pins the baseline fingerprint.
  - No credit, decision or verification is changed.
- **P2, Flight Deck readiness caching:** the `/api/students/me` readiness query no longer inherits `staleTime: Infinity`. It is re-checked on mount and on focus, and polled every 60 s while the record is missing.
- **Found in S04, student progress totals:** surplus credits on one requirement could offset a shortfall on another. Each requirement now contributes at most its required amount to the totals.

## Canonical integration
- **Endpoint:** `GET /api/student/degree-progress` (`server/routes/student-degree-progress.ts`).
  - Student role only, and only the student's own record, resolved from the authenticated user. A `studentId` query parameter is rejected.
  - It returns the read-only `StudentDegreeProgressView` (`shared/student-degree-progress-view.ts`), built by the pure projection in `shared/student-degree-progress-projection.ts` from the canonical degree progress report and the student academic record.
  - Amounts use exact decimal arithmetic. Totals are withheld whenever the engine did not produce every amount.
  - Diagnostics, fingerprints and provenance ids are never returned.
- **Client:** Flight Deck and Degree Roadmap consume the endpoint. The legacy `/api/flight-deck` estimates (pace, timeline, cost) are no longer shown.

## Evidence
`docs/recovery/s04-evidence/screens/` holds 10 renders at 1440 px and 390 px, light and dark, covering the composed, conflict (totals withheld), under-review, no-program and degree-complete states.

They were rendered in Chromium from fixtures produced by the real projection, using the real components and app shell, with authentication stubbed and fonts blocked. They are not renders of a running deployment.

## Design review
- **Tooling:** Impeccable, Jury and Awwwards are not available in this environment. The Anthropic frontend-design plugin exists in the catalog but is not enabled.
- **Reviews performed:** three independent reviews by fresh agents using the enabled `design:design-critique` skill, with accessibility checks. Each saw only the rendered screens and the source, never an earlier verdict.
- **Scores:**

| Round | Beauty | Graphics | Organization | Clarity | Usability |
|---|---|---|---|---|---|
| 1 | 7 | 6 | 7 | 7 | 6 |
| 2 | 7 | 6 | 7 | 6 | 7 |
| 3 (final) | 7 | 6 | 7 | 6 | 7 |

The 9/10 target is **not met**. Rounds 1 and 2 were applied in full. The open round-3 findings:
- Overall progress is drawn three times: ring, milestones and status strip.
- The applied-versus-verified reconciliation sits directly under the ring.
- "Needs attention" overlaps with the next step when only staff are acting.
- Requirement rows can show applied above required (e.g. "6.5 of 6") without stating the surplus.
- Non-text contrast of the pale-gold "in progress" tone needs checking against WCAG 1.4.11.
- The mobile Roadmap is long and has no section navigation.
- Brand spelling is inconsistent: "Lumiere" and "Lumière", "University" and "College".
- The app-wide `--primary` colour is blue. This predates S04 and is out of scope.

## Tests
- **Passed:**
  - `tsc --noEmit`.
  - `vitest run`: 54 files and 1299 tests passed; 8 files and 192 tests skipped. The skipped tests are hosted-project-gated suites.
  - `npm run build`.
- **Lint:** not available; see `S04-preproduction-review-notes.md`.
- **NOT TESTED:**
  - The endpoint against a real database or a running server.
  - Real student data.
  - Rendering inside an authenticated deployment.
  - Screen readers.

## Open items carried forward
- The S03 production security acceptance requirements remain **open and NOT TESTED**, all of them.
- `/ready` does not detect a Redis disconnect after startup. This is recorded for pre-production review.
- Each requirement result carries a null unit; the projection treats every requirement with engine-produced amounts as credits. This is confirmed against the current engine, but a non-credit requirement kind would need a contract change.
- Totals are withheld whenever any requirement is CONFLICT or MANUAL_REVIEW. This is conservative by design; product may want partial figures such as verified credits on record shown even then.
