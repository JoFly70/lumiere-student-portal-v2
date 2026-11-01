# S32 — Integration Report (S32-A Student + S32-B Staff)

| Item | Value |
|---|---|
| Integration branch | `claude/s32-b-staff-experience-repairs` (S32-B is the designated integration lead) |
| S32-B start | `3b63f53b6d500e1ac9b98ed1f8a8fe88d0bd22e9` |
| S32-A integrated | `4ebb887bd51cd2bbf35631843f82111eba8257b2`, merged in `95dd004`. That commit was S32-A's published head, carrying its reconciliation of 34/34, gates green and its handoff. |
| Combined candidate | The head of this branch, given in the session's final report. This file is committed in that SHA, so it cannot contain it. |
| Release base | `claude/s26-owner-and-first-student-finish` @ `8d0d4da` (live `31c3a1f`). It is an ancestor of the candidate, so the release is a fast-forward. |

## 1. Sequence followed

1. S32-B staff repairs completed with targeted tests and pushed (`141d6ad`).
2. Confirmed that S32-A had finished:
   - reconciliation 34/34;
   - `tsc` clean;
   - full suite of 4,043 tests, 0 failures, on S32-A's branch;
   - build passing;
   - an independent review.
3. Merged S32-A's head, resolving conflicts deliberately (§2).
4. Applied S32-A's shared handoff items: the S29 templates patch and its regression test, and the code-preserving sign-up error.
5. Kept the audit documents and reconciliations from both sessions:
   - `docs/s31/student-audit`, `docs/s31/staff-audit`;
   - `docs/s32/student-repairs`, `docs/s32/staff-repairs`.
6. Combined gates: tsc, full suite, build, lint on changed files, i18n parity (`S32-B-TEST-EVIDENCE.md`).
7. Independent security and academic/financial integrity review of the **combined** diff. No Critical, High or Medium findings; the 8 Lows were fixed.
8. Integrated workflow checks:
   - staff role crawl (103/103);
   - full-app role-boundary test;
   - real-Postgres enrollment and audit tests;
   - S32-A's student tests inside the combined suite.
9. Responsive EN/FR visual verification of the staff screens: 50 renders, 0 overflow, 0 errors, plus review by eye. Student screens rely on S32-A's matrix (171 renders, 0 overflow), and the re-render command is in §4.
10. The release is prepared with the S26 marker procedure (`S32-RELEASE-READINESS.md`).

## 2. Conflicts and how they were resolved

| File | Conflict | Resolution |
|---|---|---|
| `client/src/i18n/en.ts`, `fr.ts` | Both sessions registered new modules at the same place | Kept all of them: S32-B `s32-staff-*` and S32-A `s32-assistant`, `s32-degree`, `s32-hs`, `s32-services`. Parity passes. |
| `client/src/components/auth/login-view.tsx` | Both fixed sign-up errors (SA-18 = F19) | One implementation. S32-A's `signUpErrorInfo` (with sign-in and reset links) is fed by S32-B's code-preserving `auth.tsx`. `PASSWORD_TOO_SHORT` was added. The invitation message uses the exact-email recovery wording SA-18 asked for. S32-B's duplicate helper was removed. |
| `client/src/components/app-sidebar.tsx`, `ui/*` | S32-A translated student and shared a11y labels; S32-B translated the staff branch | Merged automatically; both intents kept |
| `tests/s19-login.test.ts`, `phase5f-production-truth-routing.test.ts` | Both adjusted assertions | Merged automatically; the combined assertions pass |

No completed S32-A fix was overwritten. Of S32-A's shared ownership files, S32-B changed only what the S32-A handoff asked for.

## 3. Shared items from the S32-A handoff

| Handoff item | Status |
|---|---|
| §2.1: S29 templates patch (F20, F30) | Applied in `95dd004`. `tests/s32a-shared-s29-templates.test.ts` added and passing. |
| §2.2: keep the sign-up error code (F19 hardening) | Done. `lib/auth.tsx` throws `authErrorFromResponse` (`2ba1708`). |
| §2.3: F01 hosted assistant policy check | A post-release observation: read `GET /api/assistant/status` as a DEMO student. No configuration was changed by S32. On this code, no student record reaches the provider in either mode. Recorded as a post-release item in `S32-RELEASE-READINESS.md`. |
| §4: owner content still missing ("how to pay" text, upper-level degree rule data) | The truthful fallbacks stay. Nothing was invented. |

## 4. Reproducing the integrated checks

```bash
npx tsc --noEmit -p .
```
```bash
npx vitest run
```
```bash
npm run build
```
```bash
npx tsx scripts/s32/staff-crawl.ts /tmp/s32-staff all
```
```bash
npx tsx docs/s32/student-repairs/harness/s32-render.ts matrix /tmp/s32-student
```
