# S05 synthetic scenario fixtures

Everything here is **synthetic**. Student labels are invented ("Dalia Scenario-R", ...), institutions are fictitious ("Pathways State University", "Harbor City University", "Riverbend College of Nursing"); only the providers Sophia and Study.com are real names. No real student data, documents or evaluations were used. Scenario shapes are inspired by common advising situations, nothing more.

## Layout

| File | Purpose |
|---|---|
| `builders.ts` | Specs -> workbook (`exceljs`), reference `RoadmapContent`, synthetic canonical `StudentDegreeProgressView`, expectation helpers |
| `scenario-{r,n,m,a,rc,e,s}.ts` | One `ScenarioFixture` each: `workbook`, `revisions[]`, `foundation`, `foundationExpectations`, `integrationNotes` |
| `ai-package-s.ts` | `lumiere-roadmap-package/1` fixture for scenario S + its expectations |
| `index.ts` | `s05Scenarios`, `s05ScenariosById`, re-exports |
| `workbooks/*.xlsx`, `ai-package-scenario-s.json` | Human-openable outputs (`npx tsx scripts/s05/build-scenario-workbooks.ts`) |
| `../../s05-scenario-fixtures.test.ts` | Self-consistency: workbooks open, content is schema-valid, foundation + declared diffs agree |

Usage in a test:

```ts
import { scenarioE } from "./fixtures/s05";
const v1 = await scenarioE.workbook.build();            // Buffer (.xlsx)
const v2 = await scenarioE.revisions[0].build();
scenarioE.workbook.expectations                          // counts, keys, objective kinds, exception codes
scenarioE.revisions[0].diff                              // expected diff shape vs the previous version in the chain
scenarioE.workbook.content                               // reference RoadmapContent (structural)
scenarioE.foundation                                     // StudentDegreeProgressView (composed by the real projection)
```

## How to read the expectations

* `expectations.exceptionCodes`: **exact** count per listed code. Codes not listed may also appear (for example `UNMAPPED_COLUMN` info exceptions, `PHASE_CREATED_FROM_ROW`). `forbiddenSeverities: ["blocking"]` means no blocking exception at all.
* `content` is a **structural reference**: assert item keys, objective/phase keys, `dependsOn`, `planStatus`, `alternativeOf`, dates and task keys. Free-text titles of generated tasks ("Challenge 1"), `approval.required` and credit string formatting (`"3"` vs `"3.00"`) are indicative only; compare credits numerically. Phase key = `slug(phase title)`, phases sequence by first appearance.
* Generated item keys (scenario M) follow the contract: `slug(objectiveKey + "-" + (code || title))`.
* Diff `changed[itemKey]` lists `RoadmapItem` field names (compare order-insensitively). `rescheduleOnlyKeys` are the changed items that must report `rescheduleOnly: true`.
* Dates are written to the workbooks in four mixed formats (Excel date cell, `YYYY-MM-DD`, `M/D/YYYY`, `Mon YYYY` for first-of-month starts), objective cells alternate between title and key, and each scenario uses a different header-alias style.

## Scenarios

### R - completed associate degree + intensive weekly plan
16 Sophia courses in 8 weekly blocks (2 per week, Monday-Sunday dates, 4-6 challenges / 3-4 milestones / 1-2 touchstones each), capstone depends on three earlier courses. Foundation: verified `credential_award` (associate, 60 credits), verified transfer course, pending course; totals required 120, applied 60, verified on record 63, surplus 3. v2: `BUS-230 Business Ethics` replaced by `SOC-101 Introduction to Sociology` in the same slot.

Round 2 should assert: 16 items / 1 primary objective / 8 phases / 3 milestones / no blocking exceptions; tasks `challenge-1..N`, `milestone-1..N`, `touchstone-1..N` (e.g. `r-acct-101` has 11); the associate degree appears under Your Foundation as a credential and never as a roadmap item; surplus 3 shown without a percentage; v2 diff = added `r-soc-101`, removed `r-bus-230` (`hasProgress` true when the student had progress -> `PROGRESS_ON_REMOVED_ITEM`), 15 unchanged, milestones changed; after publishing v2 the old progress sits in `history.retiredProgress` and is NOT transferred to `r-soc-101`.

### N - foreign bachelor's, concurrent master's, subsequent bachelor's
3 objectives (primary, parallel, secondary), 12 items, cross-objective dependencies, institution differs per objective, `credential_evaluation` source (120 reported, 90 awarded). Totals required 120, applied 96, verified 96, surplus 0.

Round 2: objective kinds `{parallel, primary, secondary}` with only the primary linked to the program assignment; parallel-objective items do not affect degree totals; no dependency exceptions; foundation shows the evaluation source and awarded (not reported) credits; Master's admission wording attributes the decision to the other institution.

### M - foreign-credit uncertainty and conditional allocations
10 items with **no Plan Key column** (keys generated), 4 `Condition` rows, 2 holds with reasons, an unmapped `Evaluator Ref` column, a blank row, a `#` comment row and a repeated header row. Foundation `UNDER_REVIEW` (no totals): pending / needs-review foreign credits.

Round 2: 10 `GENERATED_ITEM_KEY` (info), exactly 4 `CONDITIONAL_ALLOCATION` (warning), exactly 1 `ROW_SKIPPED` (the repeated header), `UNMAPPED_COLUMN` for `Evaluator Ref`, zero blocking; publish -> 422 `ROADMAP_NOT_PUBLISHABLE` until the 4 warnings are acknowledged, then OK; acknowledgements survive a re-save of the same draft; student view shows no total or percentage and labels foreign credits preliminary.

### A - degree architecture + controlled provider execution
11 items: architecture tasks (approval approved / pending), calculus chain `a-calc-1 -> a-calc-2 -> a-calc-3 -> a-diffeq` (some links written as course codes), `a-calc-3` and `a-ethics-hold` on hold with reasons, free-text `Tasks` lists ("Touchstone 1; Final Exam" -> 2 tasks). v2 moves dates only (two weeks later) for 7 items.

Round 2: dependencies resolve (no `UNKNOWN_DEPENDENCY` / `DEPENDENCY_CYCLE`); `waitingOn` for `a-calc-2` until `a-calc-1` is provider-complete or accepted; holds remain reportable; v2 diff = 7 changed, every one `rescheduleOnly: true`, fields `plannedEnd`+`plannedStart`, 4 unchanged, no added/removed, progress untouched and still keyed to the same keys.

### Rc - bachelor's completion + nursing admission prerequisites
Objectives `primary` + `prerequisite` (Riverbend College of Nursing), 11 items incl. an exam item and an application item, an `application` milestone (target 2027-07-15), quiz/exam task counts for science courses. Foundation includes one NEEDS_REVIEW record.

Round 2: prerequisite items never inflate the bachelor's counts; milestone `rc-application-milestone` reached only after `rc-application`; application/exam items are not courses (no credits); admission is described as decided by the nursing school; NEEDS_REVIEW credit is preliminary and excluded from totals.

### E - changed objective, Accounting/CPA planning, companion workbook
Chain v1 -> v2 -> v3.
* v1: Business Administration (7 items).
* v2: Accounting (CPA track) becomes primary; `bsba` becomes `secondary` with status `changed` (history). `e-mkt` removed, `e-mgmt` dropped, `e-fin-acct` and `e-bus-law` re-homed (objective change), 7 items added incl. a CPA planning task and a state-board application.
* v3 "companion execution workbook": sheet named `Roadmap`, different aliases (`Block`, `Item`, `Planned Start`, `Target End`, `Goal`), same keys and objectives as v2, only dates refined.

Round 2: v2 diff = added 7, removed `e-mkt` (`PROGRESS_ON_REMOVED_ITEM` with progress), changed `e-fin-acct`/`e-bus-law` (`objectiveKey`, not reschedule-only) and `e-mgmt` (`planStatus` ...), `objectivesAdded [bs-accounting]`, `objectivesChanged [bsba]`, `OBJECTIVE_CHANGED`; progress for kept keys survives; retired progress is not transferred; the student view shows `bsba` as a historical "changed" objective and never takes the program name from the plan. v3 diff = 7 changed, all `rescheduleOnly`, 6 unchanged, no objective exceptions. CPA items make no credit or eligibility claim.

### S - prior credits, conditional evaluations, alternatives
2 objectives (primary + secondary minor), 12 items: two alternatives (`s-math-alt` -> `s-math-120`, `s-cs-101-alt` -> `s-cs-101`), one dropped, two conditional. Foundation totals required 120, applied 66 (general education is capped at 45), verified 75, **surplus 9**; one pending, one needs-review, one rejected record, plus a pending `credential_evaluation` source.

Round 2: 2 `CONDITIONAL_ALLOCATION` warnings; `alternativeOf` resolves; alternatives/dropped have `canReport=false` and are excluded from counts and from the `planned` ladder value; ladder shows verified 75 / applied 66 / surplus 9 with the rejected record as NOT_ACCEPTED.

### AI package (scenario S content) - `ai-package-s.ts`
`lumiere-roadmap-package/1` carrying the scenario S content plus annotations (1 high, 2 medium, 1 low; two `needsReview`, two `conditionalAllocation`) and two `creditClaims`.

Round 2: templateId `ai-package-v1`; 12 items; `AI_LOW_CONFIDENCE` for `s-cs-101-alt`, `s-db-220`, `s-networks-240` (3); `CONDITIONAL_ALLOCATION` for `s-cs-101-alt` and `s-db-220` (2); `AI_CREDIT_CLAIM_IGNORED` x2; no blocking exceptions; the claims change nothing in the draft or the foundation; publishing requires acknowledgement of the warnings. An invalid package (wrong `format`, non-object `content`) must yield `PACKAGE_INVALID` blocking.

## Real-database harness (round 2 integration tests)

`tests/helpers/s05-local-pg.ts` starts a disposable PostgreSQL 16 cluster with the repository's real schema build (see the header of that file). Seed helpers: `seedUser`, `seedStudent`, `seedAcademicRecord` (institution, program, version, active assignment, source, verified credit record with an accepted decision). Use the returned `creditRecordId` as `linkedCreditRecordId` in roadmap items to test "officially accepted" display from the canonical record. Set `DATABASE_URL = pg.url` before importing `server/lib/db.ts`. Tests gate on `PG_BINARIES_AVAILABLE` and skip with `S05_PG_SKIP_MESSAGE` when the binaries are missing.
