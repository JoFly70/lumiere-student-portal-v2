# S06 lint baseline

Status: **temporary baseline**. ESLint was adopted in S06 (see S04 review notes, section 1). This document records the debt found on the first working run so it can be paid down deliberately.

## Tooling

- Pinned devDependencies: `eslint` 9.39.5, `@eslint/js` 9.39.5, `typescript-eslint` 8.72.1, `eslint-plugin-react-hooks` 5.2.0, `eslint-plugin-react-refresh` 0.4.26, `globals` 15.15.0.
- Scripts: `npm run lint` (`eslint .`), `npm run lint:changed` (changed `.ts`/`.tsx` files vs `HEAD`).
- `eslint.config.js`: ignores `dist`, `node_modules`, `coverage`, `attached_assets`. Browser globals plus React rules for `client/` and `src/`; node globals for `server/`, `scripts/`, `tests/`, `shared/`, `lib/` and root `*.ts`. Only `.ts`/`.tsx` files are linted.

## Policy

Genuine-bug rules (react-hooks/rules-of-hooks, no-undef, parse errors, etc.) are errors. Purely stylistic or debt rules were downgraded to `warn` in `eslint.config.js` (`baselineDebtRules`) so `npm run lint` exits 0. Promote them back to `error` as the debt is cleared.

## First-run result

Initial run (errors under the stock config): 931 errors, 17 warnings across 289 files. No rules-of-hooks, no-undef or parse errors were found. After the fixes below and the downgrade: **0 errors, 939 warnings**.

| Rule | Count |
| --- | --- |
| @typescript-eslint/no-explicit-any | 599 |
| @typescript-eslint/no-unused-vars | 258 |
| no-empty | 38 |
| react-refresh/only-export-components | 17 |
| prefer-const | 9 |
| @typescript-eslint/no-require-imports | 9 |
| no-useless-escape | 3 |
| no-case-declarations | 3 |
| no-control-regex | 2 |
| @typescript-eslint/no-namespace | 1 |

Top files (warnings): tests/knowledge-service.test.ts 127, tests/student-academic-service.test.ts 65, tests/phase2a-student-record-db.test.ts 51, server/routes/admin.ts 40, tests/phase1db-service-integration.test.ts 39, tests/phase2d-student-academic-http-e2e.test.ts 35, tests/phase1dc-http-e2e.test.ts 34, tests/integration.test.ts 33, server/seed-supabase.ts 30, tests/s03-student-records.test.ts 24, server/routes/tickets.ts 21. Roughly two thirds of the debt is in `tests/`.

## Fixes made in S06

- `client/src/components/profile-avatar-upload.tsx`: removed unused `User` and `Button` imports.
- `tailwind.config.ts`: targeted `eslint-disable-next-line` for an intentional `require()`. (Similar `any` suppressions in S04/S05-owned academic files were deliberately not applied, to avoid conflicts with S05; they surface as baseline warnings.)
- `tests/pre-replit-security-e2e.test.ts`: `eslint-disable-next-line no-unsafe-finally` on the deliberate restore-failure throw.

## Deliberately left (S04 presentation code, out of scope)

- `client/src/components/student-progress/flight-deck-view.tsx`: unused `countRequirementsByTone`.
- `client/src/components/student-progress/roadmap-view.tsx`: unused `attentionOwnerLabel`, `safeInternalHref`.
- `client/src/components/student-progress/parts.tsx`: one `react-refresh/only-export-components` warning.
- Academic history, degree planning, Excel import and roadmap authoring code were not touched.

## S07 integration

Measured on the S05 + S06 integrated tree (merge 903b0c7, lint fixes 64903c3, plus S07 audit work): `npx eslint .` exits 0 with **0 errors, 981 warnings across 361 linted files** (S06 measured 0 errors, 939 warnings across 289 files).

Delta of +42 warnings:

| Source | Warnings |
| --- | --- |
| 76 `.ts`/`.tsx` files added or changed by S05 (mostly not present when S06 measured): `no-explicit-any` 31, `no-unused-vars` 12, `react-refresh/only-export-components` 3 | +46 |
| All other files (S05 edits to files that already carried S06 baseline warnings) | -4 |
| Net | +42 |

Rule totals now: `no-explicit-any` 634 (S06: 599), `no-unused-vars` 262 (258), `no-empty` 38, `react-refresh/only-export-components` 20 (17), `prefer-const` 9, `no-require-imports` 9, others unchanged. The 289 -> 361 file count is the S05 server, shared, client and test files.

The two S05-introduced errors (an irregular-whitespace character and a `@ts-ignore` directive) were fixed at source in 64903c3, with no rule changes. The S07 files added here (`server/routes/roadmap-audit.ts`, `tests/s07-*.test.ts`) add no warnings.

Policy is unchanged: no repo-wide warning refactor. Baseline-debt rules stay at `warn`, errors must stay at 0, and new code should not add warnings.
