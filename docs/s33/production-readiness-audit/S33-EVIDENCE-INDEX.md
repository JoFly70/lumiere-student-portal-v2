# S33 — Evidence Index

## Audited revision

| Item | Value |
|---|---|
| Repository | `JoFly70/lumiere-student-portal-v2` |
| Audit branch | `claude/s33-independent-production-readiness-audit` (starting commit `fbdc30b2a77c2c3c8a5645bf9a0033e621557065`, verified) |
| Production source | `claude/s32-b-staff-experience-repairs` at `699a4bb`. The release marker `release/S26_RELEASE_SHA` points to `fbdc30b`. S32.1 is live as `4ccd8ae` (per the S32 release log). |
| Differences `fbdc30b` → `699a4bb` | `client/src/components/support/staff-support-desk.tsx`, `client/src/hooks/use-tickets.ts` (desk refresh 60 s → queue 2 min / counters 5 min / open ticket on focus), `tests/s32b-support-ui.test.ts`, release notes, release marker. These were reviewed in S33. They do not affect any S33 finding, and they reduce the request pressure behind S33-02. |
| `main` branch | `e9919e9` has no common history with the S-series branches. It is the older Lumière OS line and not the production source. |
| Branches or markers modified by S33 | None. Only `docs/s33/` was added on the audit branch. |

## Existing evidence consulted

- `docs/s32/staff-repairs/S32-COMBINED-FINDINGS-MATRIX.md`, `S32-B-FINDINGS-RECONCILIATION.md`, `S32-RELEASE-READINESS.md` (on both `fbdc30b` and `699a4bb`)
- `docs/s32/student-repairs/S32-A-*` reports; `docs/s31/*` registers (titles and status only)
- `docs/recovery/s25-security-readiness.md`, `S25-production-release-record.md` (email-verification guard)
- `release/README.md`, `scripts/s26/production-acceptance.ts` (rate budget)

## Tests executed in S33

**Environment.** `npm ci` failed in this container: the lockfile resolves 165 packages from `package-firewall.replit.internal`, which returned 405 here. Dependencies were installed in a scratch copy with the lockfile URLs rewritten to `registry.npmjs.org`. The `node_modules` folder is git-ignored, and the repository lockfile is unchanged.

| Command | Result |
|---|---|
| `node_modules/.bin/tsc --noEmit` (TypeScript 5.6.3) | **exit 0** |
| `npx vitest run` on 10 files: `s03-invitations-account-status`, `s13-account-linkage`, `s32b-enrollment-http`, `s32b-links`, `rbac`, `s25-assistant-confidentiality`, `s32a-assistant-records`, `s32a-assistant-review-fixes`, `auth-rate-limit-wiring`, `s32b-support-ui` | **10 files, 164 tests passed, 0 failed** (5.0 s) |

- An earlier `npx tsc` run that used a fetched TypeScript 6 failed on missing types and deprecated options. That was an environment artefact of running before the install, not a code result.
- The full 4,227-test suite was **not** re-run, as the brief instructs. S33 makes no claim about it.

## Reproductions

**R1 and R2** — `evidence/s33-assistant-repro.mts`, output in `evidence/s33-assistant-repro.output.txt`.
- **How it was run:** `NODE_ENV=test npx tsx --tsconfig tsconfig.json docs/s33/production-readiness-audit/evidence/s33-assistant-repro.mts`.
- **What it calls:** the real `composeWithPrivateContext`, `buildProviderMessages` and `answerMessage`, with synthetic data. There are no network calls.
- **R1 (S33-01):** `provider body contains private appendix: true`.
- **R2 (S33-04):** in local mode, « Qu'est-ce qu'un crédit ? » and "What is a credit hour?" both return `grounded=record` with the student's credit line.

## Screenshots inspected (none generated)

- `docs/s32/staff-repairs/evidence/file-staff-overview-390-lumiere-dark-en.png`: staff Student File at 390 px. No overflow; the actions are reachable.
- `docs/s32/student-repairs/evidence/after/first-hs-flight-deck-fr-390-light.png`: French HS Flight Deck at 390 px. Fully French. Shows « Bonsoir, Amy. » above « Bienvenue chez Lumière, Noa ! » (S33-10).

## Key source references

| Finding | Files |
|---|---|
| S33-01 | `server/services/assistant-conversations/reply.ts:64-78`; `server/services/assistant-conversations/service.ts:91-101`; `store.ts:306-312`; `server/services/academic-assistant/service.ts:152-178`; `server/routes/assistant-conversations.ts:142` |
| S33-02 | `server/config/production.ts:120-140`; `server/index.ts:219-242`; `server/routes.ts:146, 541, 568`; `server/middleware/rate-limit.ts:15-37`; `client/src/lib/queryClient.ts:5-9`; `client/src/lib/auth.tsx:204-270`; `client/src/lib/s29-ops-queries.ts:47` |
| S33-03 | `docs/s32/staff-repairs/S32-RELEASE-READINESS.md` §5 (branch `699a4bb`) |
| S33-04 | `server/services/academic-assistant/service.ts:253-254`; `student-record.ts:199-241` |
| S33-05 | `server/services/high-school-service.ts:590-628`; `server/services/s29/rules.ts:55-74` |
| S33-06 | `server/routes.ts:1041-1079, 1209, 1242-1310`; `server/services/assignment-service.ts` |
| S33-07 | `server/lib/logger.ts`; `server/index.ts` (the only `captureException` sites) |
| S33-08 | `server/services/academic-assistant/student-record.ts:155, 161, 180` |
| S33-09 | `docs/release/s14/RUNBOOK.md` (the only restore procedure) |
| S33-10 | `server/routes/student-welcome.ts:151`; `client/src/pages/high-school-flight-deck.tsx:130` |

## Method and independence

- **Who did what.** The lead reviewer covered enrollment, linking, Student File, Control Center, graduation and the cross-workflow checks. Two Sonnet specialists covered student experience and AI, and operations, security, billing and documents. They worked read-only and wrote no files.
- **How specialist claims were handled.** The lead reviewer independently re-checked every specialist P1 claim.
  - Confirmed: S33-01 (reproduced) and S33-02.
  - Downgraded: `/api/assignments` (a legacy table that no current screen reads), and the local-mode record answers (a deliberate S32 design choice, with no privacy effect).
  - Merged into S33-02: the 429 messaging and the shared login/refresh bucket, which have the same root cause.

## Environment limitations and unverified hosted behaviour

- No access to the production site, production database, Supabase dashboard, Resend or the AI provider.
- No live authenticated browser sessions and no new screenshots.
- Unverified items U1–U9 are listed in `S33-FINDINGS-REGISTER.md`.
- Nothing in this audit is a hosted acceptance result.

## Integrity statement

- **No changes outside the audit docs.** S33 changed no application source, configuration, deployment setting, release marker, production branch, DNS or production data. The only additions are files under `docs/s33/production-readiness-audit/`.
- **Audit script stays out of the test suite.** The audit script sits outside `tests/`, so the normal test suite does not pick it up.
