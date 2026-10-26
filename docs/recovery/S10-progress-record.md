# S10 — Integrated student experience, original-workbook validation, security hardening and hosted-pilot readiness: closeout record

**Branch:** `claude/s10-integrated-hosted-pilot`. **Closeout code baseline:** `980c9da13d39a5ce1b5b5e841c7bffe2765c2d51` (this record is committed on top of it, documentation only).
Not merged to `main`. Nothing deployed. No production data, production Supabase or Replit app was modified. No hosted database was used. Only synthetic or de-identified data is committed.

**Closed by owner decision:** the final focused correctness pass (fixing the findings of the S10 acceptance review) was stopped at the owner's request before it committed; none of its changes are on this branch. Its target findings are listed in §13 as open.

## Classification (these are not interchangeable)

| Level | Status |
|---|---|
| Development-complete | **Yes**, for S07 + S08 + S09 + S10 scope, except the open items in §13 |
| Local integration-tested | **Yes**: real disposable PostgreSQL 16, production `registerRoutes`, local-JWT RBAC; support on an in-memory Supabase fake |
| Hosted pilot-ready | **No**: no designated non-production Supabase project; 192 hosted-gated tests not executed |
| Production-ready | **No**: see §14 |

## 1. Final branch and SHA

`claude/s10-integrated-hosted-pilot` @ `980c9da13d39a5ce1b5b5e841c7bffe2765c2d51` (code). Started from S07 `72f89c989ca3b3bb8622adeac95d837e2ca7b6da`.

## 2. S07 / S08 / S09 integration status

| Module | SHA merged | Merge commit | Status |
|---|---|---|---|
| S07 Academic Journey | `72f89c9` (branch base) | — | Preserved; baseline reproduced exactly (1815 passed / 192 skipped) |
| S08 Support Center | `af89190` | `a3d417e` | Integrated; no conflicts; 2 ESLint errors S08 brought (pre-S06 lint gate) fixed |
| S09 Student Profile | `f743137` | `77d2480` | Integrated after its gate: final SHA, `docs/recovery/S09-progress-record.md`, migration and shared-file review. One conflict (`profile-avatar-upload.tsx`, S06 import cleanup vs S09 rewrite → S09 kept). One ESLint error fixed |

S09 was **not** merged while it was in progress (checked at `9d2b5cd` and `4bac088`); it was merged only after the owner declared it closed at `f743137`.

## 3. Capabilities preserved

Roadmap import/review/publish with immutable versions and stale-publish 409; student progress separate from academic authority; canonical credit tables unchanged by student or staff profile/support activity (md5/digest checks in the journeys); Redis recovery and fail-closed rate limiting; authentication and RBAC; audit; S08 ticket ownership, private internal notes, attachment path pinning; S09 field-ownership matrix, identity-correction workflow, masked government ID, photo security; student design tokens.

## 4. New fixes and improvements (S10)

**Support reliability (`server/routes/tickets.ts`)**
- Opening-message defect fixed: if the first comment fails, the ticket is rolled back and the API returns `503 SUPPORT_CREATE_INCOMPLETE` (`mayHaveSaved` true only if rollback also failed); never a false 201.
- Idempotent retry via `idempotencyKey` (scoped to the reporter); duplicate replays return the complete ticket; a concurrent same-key create returns `409 SUPPORT_CREATE_IN_PROGRESS` with the optional unique index.
- One documented status-label table (`SUPPORT_STATUS_LABEL`, `shared/support-contract.ts`; `docs/s08/S08-support-api-spec.md`).
- Staff triage order in the product (`orderStaffQueue`): open overdue → longest waiting → resolved.
- "Ask for help" on roadmap items → `/support?item=<key>`, verified server-side against the student's *current* published roadmap (foreign and superseded keys rejected).

**Audit:** S07 and S08 enum migrations verified compatible on the full chain; every emittable event type insertable; audit write failures counted (`getAuditFailureStats`). S09 profile audits go through `writeAuditLog` as `admin.bulk_operation` with the real action in metadata (not filterable by event type; recorded, not changed).

**Profile (S09 follow-up):** verified guardian/representative contacts drop to `pending_verification` when staff change name, type or add any scope (narrowing keeps verification); revoked stays revoked until staff re-verify; fixed an S09 path where a student edit reset a revoked contact. Attention panel now has four groups (action required / waiting on Lumière / waiting on an outside institution / completed); requested guardian consent and resubmissions now appear.

**Importer (real workbooks):** see §6.

**Schema:** `20261028200000_s10_support_schema_repair.sql` (creates `ticket_attachments` / `ticket_status_history` if missing, RLS on, no client grants; fixes the legacy `migrations/010` trigger that wrote `'system'` into an FK and broke every status update).

**Test reliability:** intermittent S05 HTTP e2e 409 root-caused (test built the workbook twice; the zip embeds build time) and fixed.

## 5. Support security correction evidence

`tests/s08-support-routes.test.ts` (rollback, rollback failure, retry, cross-student key, concurrent duplicate, missing tables → 503/404 without leaks), `tests/s10-support-client.test.ts`, `tests/s10-consolidated-journey.test.ts` S1–S9 (other student 404 on read/comment/patch/upload; internal notes and their attachments never reach students; foreign/traversal/bucket attachment paths 400; stale/foreign/invented context keys 400). Record: `docs/recovery/s10-evidence/sonnet1-support-record.md`.

## 6. Actual workbook import results (original bytes processed)

Inputs obtained byte-exactly through the owner's Google Drive connector (size = Drive size, zip CRC clean); kept in private scratch, never committed. Details: `docs/recovery/s10-evidence/workbooks/import-results.md`.

| File / pair | Before S10 fixes (S07 importer) | After S10 fixes |
|---|---|---|
| EPH validated-locked master | Unreadable (`x:` XML prefix) | Read via fallback reader |
| EPH execution (9 visible sheets, 42 weeks) | 1 of 9 sheets read; 0 courses, 0 tasks | 23 items, 134 tasks, 14 milestones (execution-only) |
| EPH final master | 36 items incl. 13 total/footer rows; 309 "planned" credits instead of 69 | 23 items |
| **EPH locked master + execution (correct pair)** | n/a (master unreadable) | **26 items (23 plan courses, 69 credits; 3 "do not take" kept as dropped, 0 credits), 137 tasks, 42-week schedule 2026-09-14 → 2027-07-04, 16 milestones, 18 reported-history entries (17 courses + 51-credit claim), never credit; 0 blocking** |
| EPH final master + execution | 0 execution data merged, 0 unmatched flagged (schedule silently lost) | 23 items; 13 execution courses not in that master flagged `COMPANION_ROW_UNMATCHED`, not added |
| RUT execution final-v2-1 | 0 items (18 courses, 195 challenges, 69 milestones, 9 assignments dropped) | 18 items, 54 credits, 195 challenge + 69 milestone tasks, 9 dated assignments, 13 weeks |
| RUT orientation v3-1 | Unreadable | 18 items |
| RUT orientation + final-v2-1 | — | 18 items, 277 tasks |

EPH execution belongs with the validated-locked master; the "final" master is a different plan. RUT has no byte-exact degree master (two smaller files were not obtained byte-exactly), so RUT imports execution-only with that stated in the draft.

## 7. Academic reconciliation

Independent reader (no shared code with the importer). EPH locked+execution: 23/23 plan courses, 0 missing, 0 spurious; 17 completed ledger rows (51 credits) → reported history only; 23/23 tracker courses; 3/3 conditional courses flagged; 42/42 weeks; 16 milestones (14 dated). RUT: 18/18 courses, exact challenge/milestone counts, 9/9 dated assignments. Unresolved by design (blank or undecided in the source): TECEP exam dates, 16 TESU-residency date placeholders, CSM BUS-2100 posting, finance placement watch, ACC-4110 April offering, capstone unlock gate, unnamed physics replacement, the 51 credits (reported, unverified). Revision check on the originals: a renumbered course becomes removed (progress flagged) and its replacement added with no inherited progress; unchanged items keep progress. Staff reading load, real EPH import: 42 flat items → 10 groups (acknowledgement unchanged server-side). Reports: `reconciliation-EPH.md`, `reconciliation-RUT.md`, `revision-check.md`, `staff-review-usability.md`.

## 8. Database migration status

Order (filename): … `20261026100000_s05_student_roadmap` → `20261026110000_s07_roadmap_audit_event_types` → `20261026200000_s09_student_profile` → `20261027100000_s08_support_audit_events` → `20261028100000_s10_support_idempotency_index` (optional) → `20261028200000_s10_support_schema_repair`.
Verified on disposable local PostgreSQL 16: full chain applies in order and is idempotent; S09 `to_regclass` guards correct with and without `student_contacts`; production-lineage approximation lacks the ticket tables and the repair creates them. **Applied to no hosted database.** Three legacy migrations are not re-runnable (`20251217230356_011…`, `20260914200029_…integrity_fix`, `20260916100000_phase5e_restore_profiles`). Drift: `docs/recovery/s10-evidence/security/schema-drift-report.md`.

## 9. Hosted security acceptance matrix

**Not executed.** No designated non-production Supabase project or credentials were available. The Neon credential in the environment was not designated and was not used. 192 hosted-gated tests (8 suites) remain skipped. Blocker: 7 of 8 suites hard-code project ref `rheronevecsffaejteoj`, which repository docs describe both as the development database and as the production auth-verifier target — the owner must decide which environment they may touch. Ordered steps and a 21-row matrix (all rows NOT EXECUTED, with local coverage): `docs/recovery/s10-evidence/security/hosted-acceptance-checklist.md`.

## 10. Replit production-exposure review

The Replit workspace (`lumiere-student-portal-v2`) still contains the pre-S08 attachment logic: an authenticated student can register any `documents`-bucket path on their own ticket and receive a 1-hour service-role signed URL. Mitigating: real student documents are in `student-documents`; a path must be known; the insert fails if the live DB lacks `ticket_attachments`. **Not verified:** that the published deployment runs the workspace code, route reachability (sandbox egress denied all requests), whether `documents` exists or is public. Severity HIGH if exploitable. Hotfix candidate (not deployed; owner approval required): `docs/recovery/s10-evidence/security/legacy-attachment-hotfix.patch`; checks for the owner: `URGENT-legacy-attachment-exposure.md`.

## 11. Student / staff journeys (local)

- `tests/s10-consolidated-journey.test.ts`: academic A1–A7 (import, history separate, warnings need acknowledgement, admin-only publish, named next task, progress = fresh GET for Flight Deck and Roadmap, revision keeps progress, replacement starts empty, canonical credits unchanged) + support S1–S9.
- `tests/s10-consolidated-profile-journey.test.ts` P01–P08: profile + roadmap + support together on one app; identity correction approved by staff; roadmap/degree-progress/tickets/credits unaffected; protected fields 403; other student blocked; guardian inert. Note: tickets keep the reporter name from creation time (no leak; doesn't follow a legal-name correction).
- `tests/s10-contact-authority-http.test.ts`: guardian authority boundaries (18).
- Staff UI interaction (Playwright, real UI, stubbed API): 35/35 (`screens/staff-interaction-results.json`).
Evidence JSON: `docs/recovery/s10-evidence/journey/`.

## 12. Accessibility and visual review

- Canonical screens: 49 PNGs in `docs/recovery/s10-evidence/screens/` (student + staff, 390/768/1024/1440, light/dark) — axe **0** violations, horizontal overflow **0**. S09 screens: axe 0, layout audit clean at 1440/1024/768/390. Keyboard: `staff-keyboard-pass.md`, `docs/recovery/s09-evidence/keyboard-pass.md`. Before/after: `screens/before/`, `before-s09-fixes/`, `before-staff-pass/`.
- Screenshot stub corrected (owner-authorized) to the real progress contract; toast and row now agree (screen 22).
- **Independent reviews (actual scores; fresh reviewers, no prior verdicts):**

| Review | Student B / G / O / C / U | Staff B / G / O / C / U |
|---|---|---|
| S07 (Flight Deck + Roadmap only) | 7 / 7 / 8 / 7 / 8 | — |
| S10 pre-S09 (`independent-review-s10-scored.md`) | 6 / 7 / 6 / 5 / 6 | — |
| S10 after S09 (`independent-review-s10-final.md`) | 8 / 7 / 6 / 6 / 7 (Profile: 8 / 6 / 7 / 7 / 7) | 4 / 3 / 4 / 3 / 5 |
| **S10 acceptance (`independent-review-s10-acceptance.md`)** | **8 / 8 / 7 / 7 / 8 (≈7.6)** | **7 / 6 / 6 / 5 / 6 (≈6.0)** |

**The 9/10 target is not met on either side.**

## 13. Test / typecheck / lint / build (at `980c9da`)

`npx tsc --noEmit`: clean. `npx vitest run`: **104 files passed, 8 skipped; 2172 tests passed, 192 skipped** (hosted-gated, unchanged since S04). `npx eslint .`: **0 errors**, 1185 warnings (documented debt). `npm run build`: succeeds.

## 14. Remaining issues by severity

**Critical / production blockers**
1. Possible live cross-student attachment exposure on the Replit deployment (§10) — owner verification and hotfix decision.
2. Hosted security acceptance not executed (§9); hosted-suite project-ref ambiguity.
3. Migrations (S05–S10, incl. audit enums) applied to no hosted DB; S03 security SQL (`account_invitations`, `current_user_is_active()`, privilege revokes) lives only in a "not a production migration" script — production state unknown.
4. No staff caseload scoping: no authoritative staff↔student assignment exists; any staff user can prepare any student's draft (`security/caseload-scoping.md`).

**High (open from the S10 acceptance review; the stopped final pass targeted these)**
5. Document/transcript status contradicts across screens ("verified" / "under review" / "pending review"; "4 documents tracked" vs 3; certificate "waiting" vs "received").
6. Staff workspace "Verified" badge beside "No verification recorded".
7. Workspace Documents "Review" CTA leads to a read-only list (no verify/reject in the workspace).
8. Staff workspace Overview shows engineering language (hashes, "Composed", "Canonical view…", ISO dates) and not the student's actual degree progress.
9. Student credit arithmetic not reconciled on screen (60+6 vs 63; 63+9+27 ≠ 120).

**Medium**
10. RUT degree master not obtained byte-exactly (no degree structure/prior history for RUT).
11. Import review panel (`admin-student-roadmap.tsx`) never rendered in a browser/axe run.
12. Support list date unlabelled on the student side vs "Opened" on staff; fixture facts (MKT300 note), workspace title uses preferred name; same persona shown with different roles in fixtures; workspace tabs scroll off at 390; assignee truncation at 1024; admin "Revenue $0" tile without billing.
13. Profile audits not filterable by event type; tickets keep creation-time reporter name.
14. Roadmap at 390 still ~5.4k px; Admin Programs/Knowledge only token-themed.

**Low:** 1185 ESLint warnings; three legacy migrations not re-runnable; email-change flow and org-wide identity-correction inbox not built (S09).

## 15. Exact blockers to a real student pilot

1. Owner decision on the Replit attachment exposure (verify, apply hotfix or take offline).
2. A designated non-production Supabase project + credentials; resolve the hard-coded project ref; apply the migration chain there and run the hosted checklist and the 192 hosted-gated tests.
3. Staff authorization basis for student records (caseload model or an explicit owner decision that all staff may act on all students for the pilot).
4. Fix the High items 5–9 (factual contradictions staff and students would act on).
5. Obtain the RUT degree master byte-exactly if RUT is a pilot student.

## 16. Recommended next milestone

**S11 — Hosted staging acceptance and pilot hardening:** in a designated staging Supabase project apply the verified migration chain, close the hosted security matrix and run the hosted suites; resolve the Replit exposure; decide caseload scoping; complete the stopped final pass (items 5–9, then a fresh independent review against 9/10); run one supervised staff import of the real EPH pair in staging.

## Evidence index

`docs/recovery/s10-evidence/`: `correctness-triage.md`, `profile-integration-record.md`, `student-ux-pass.md`, `staff-portal-pass.md`, `staff-keyboard-pass.md`, `sonnet1-support-record.md`, `journey/`, `screens/`, `student-ui/` (four independent reviews), `security/` (URGENT exposure note + hotfix patch, hosted checklist, schema drift, caseload scoping), `workbooks/` (import results, reconciliations, revision check, staff review usability).
