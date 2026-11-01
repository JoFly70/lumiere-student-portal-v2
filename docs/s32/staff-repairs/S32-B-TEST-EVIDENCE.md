# S32-B — Test Evidence

All of this evidence is **local and synthetic**: vitest, a real local Postgres 16, and Playwright with stubbed APIs. None of it was observed on production. Production evidence comes only from the S26 runner's hosted acceptance (see `S32-RELEASE-READINESS.md`).

## 1. Gates on the combined candidate

| Gate | Command | Result | Commit |
|---|---|---|---|
| Type check | `npx tsc --noEmit -p .` | clean | `141d6ad`, re-run on `5d4e45e` and the final head |
| Full suite | `npx vitest run` | **4,227 passed, 0 failed**, 192 skipped (8 env-gated files, the same set S32-A reports) | `141d6ad` (also `5242981`: 4,227 / 0) |
| Production build | `npm run build` | passes (client and server bundles) | `141d6ad` |
| Lint (changed files) | `npx eslint <changed>` | 0 errors in S32 code. 2 pre-existing `rules-of-hooks` errors in `admin-view-as-student.tsx`, outside S32 scope. Warnings only otherwise. | `71f4cab` |
| i18n parity | `tests/s19-i18n-parity`, `s18-i18n` | pass. Every new FR value differs from its EN value. | final |

A first full run at `db59142`, before the source-pinned tests were updated, had 10 failures. Every one asserted the pre-S32 behaviour: old landing redirect, old menu literals, old hash links, untranslated portal label. All were updated deliberately in `71f4cab` / `95dd004`.

## 2. New S32-B tests

| File | Kind | Count | Proves |
|---|---|---|---|
| `tests/s32b-links.test.ts` | UT | 69 | The route manifest equals `App.tsx`. Every server-built href (Control Center, S29, Owner AI, high-school and profile links, search) exists. Staff never bounce to support; coach always lands on support. Return path is safe and role-checked. |
| `tests/s32b-staff-boundaries-http.test.ts` | APP (real `registerRoutes` + PG) | 4 | Staff and coach are refused 17 admin-only operations by the role guard, with a valid CSRF token so the 403 is the role guard. Staff Student File reads return no 403. Coaches cannot read records. |
| `tests/s32b-enrollment-http.test.ts` | PG | 5 | invite → invited → ready_to_link (never auto-linked) → linked. Lapsed and mismatch states. The audited email correction works. Unsafe corrections are refused. Staff and coach get 403. |
| `tests/s32b-audit-http.test.ts` | PG | 6 | The FK rejection is reproduced. Document, guardian, create, activation, link/unlink and placement events are in that student's feed. 5 of 6 fail with the fix reverted. |
| `tests/s32b-admin-users-http.test.ts` | HTTP | 13 | Correct old role. 409 for SELF_DEMOTION and LAST_ADMIN. Archive needs a reason. Paging and search. Audit-log filters. |
| `tests/s32b-admin-ui.test.ts` | UT | 14 | Audit viewer and add-student in EN and FR. Duplicate email → link. |
| `tests/s32b-ops-units.test.ts` | UT + PG | 7 | Hidden meeting → no student reminder. No staff in-app rows. Concierge off → suppressed, change notice kept. One reminder per deadline. Import-awaiting-approval item. |
| `tests/s32b-support-http.test.ts` / `-ui` | HTTP / UT | 7 / 10 | Staff `studentId` filter and coach scoping. Search by email, name, number and code. Injection inert. `student_id` not sent to coaches. Status history. Polling. FR desk. |
| `tests/s32-billing-evidence-http.test.ts` / `-staff-ui` | PG / UT | 2 / n | No duplicate document. Cross-student document refused. Ranked start list. "Show all" history with names. |
| `tests/s32b-staff-units.test.ts` | UT | 12 | Next step (SA-08). Enrollment derivation. Sign-up errors EN/FR. Password policy. Agreement-driven gates. Return path. |
| `tests/s32b-cc-menu.test.ts` | UT | 6 | One needs-you count; a dismissal moves it. Menus per role are translated and reachable. |
| `tests/s32b-ws-i18n.test.ts`, `s32b-dir-i18n.test.ts` | UT | 6 / 10 | Workspace, directory, Owner AI and high-school screens are French in FR and unchanged in EN. |

## 3. Role-aware browser crawl (BR)

Command:

```bash
npx tsx scripts/s32/staff-crawl.ts <outDir> crawl
```

The client is real (vite). Every `/api` response is built by the real server rule functions (`buildControlCenter`, `buildAttention`) from synthetic data.

**Result: 103 of 103 checks pass.** Details are in `evidence/crawl.json`.

- **Admin, staff and coach:** each of the 30 link families (every Control Center and Needs Attention kind, search, calendar, Owner AI citations, high-school and roadmap back links, directory, imports, email-delivery filter) lands on a real page with no NotFound and no access notice.
- **Staff:** no non-support link lands on `/support`.
- **Coach:** every link lands on `/support`.
- **Admin-only pages:** workspace, Owner AI, Administration and Diagnostics never render for staff or coach.
- **Click-through:** the first Needs Attention "Open" goes to the item's page, not back to the Control Center.
- **Ring anchor:** the "needs you" ring links to an element that exists.
- **Return path:** a signed-out deep link is remembered for after sign-in.

## 4. Visual verification (LS)

Command:

```bash
npx tsx scripts/s32/staff-crawl.ts <outDir> shots
```

- **Coverage:** 10 screens × 5 variants:
  - 1440 light EN
  - 1440 light FR
  - 768 dark FR
  - 390 dark EN
  - 390 light FR
- **Screens:** Control Center (admin and staff), Student File (staff: overview, documents, sessions), the admin lead's enrollment card, the Advanced Workspace, the directory, the staff support desk filtered to a student, and the coach support desk.
- **Result:** 50 renders, **0 horizontal overflow, 0 page errors** (`evidence/shots.json`). Twelve representative PNGs are in `evidence/`.

The lead also reviewed the renders by eye. That review found three polish defects, fixed in `5d4e45e`:
- an English status pill on the French File;
- a truncated French sidebar label;
- « élève » vs « étudiant ».

The committed PNGs predate that commit, so the status pill there still reads "Pre-enrollment".

## 5. Independent security and integrity review

A separate read-only reviewer covered `3b63f53..HEAD` (S32-A + S32-B):
- Critical, High and Medium: none.
- Low: eight items, all addressed in `141d6ad`; see `S32-B-REGRESSION-RESULTS.md` §3.
- The reviewer re-ran 7 S32-B test files (112 tests), all passing.
