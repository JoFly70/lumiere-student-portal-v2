# Evidence register entry: international equivalency of the Italian *Master universitario di primo livello*

| | |
|---|---|
| **Register id** | `S12-EQ-001` |
| **Received** | 26 Oct 2026. Owner's *Academic Intelligence Addendum*: ENEB / Unimarconi international credential equivalency |
| **Governance status** | **working** (not confirmed). Submit through the Knowledge API under normal promotion governance; see `knowledge-submission-package.json`. |
| **Applies to** | Foreign credential-evaluation expectations for the Unimarconi first-level master's reached through ENEB |
| **Does not apply to** | ENEB transfer credit, examinations, recognition, cohort rules or graduation. None of these change because of this finding (addendum point 6). |

## Findings, as recorded

These are the owner's statements. They have **not** been independently re-verified in this session. Primary sources still have to be retrieved and attached before any claim is promoted.

| # | Claim (working) | Basis reported | Confidence (0–100) | What would confirm it |
|---|---|---|---|---|
| 1 | An Italian *Master universitario di primo livello* must **not automatically** be classified as below master's level for international credential evaluation. | Owner research synthesis | 60 | Claims 2 and 3 confirmed from primary sources |
| 2 | Nuffic's Italian qualification guidance normally compares this qualification to a Dutch **professional (HBO) master's**, and sometimes to a **research-university (WO) master's**, depending on the programme. | Nuffic official guidance (reported) | 60 | Retrieve and archive Nuffic's current Italy country-module page for this qualification (official_web, primary) |
| 3 | **Positive WES U.S. degree-equivalency-tool results** have been reported for the general Italian *Master universitario* category. | Reported tool results | 40 | Captured tool output with date. It stays **preliminary** and is not an evaluation report. |
| 4 | **No completed, authenticated WES U.S. report** exists yet for an actual graduate awarded the first-level Unimarconi master's through ENEB. | Owner research | 80 | Superseded once such a report is obtained and verified |
| 5 | Absence of Italian doctoral-access rights **does not establish** absence of master's-level equivalency abroad. | Owner academic conclusion | 60 | Evaluator statements, or claim 2 primary source |

## Required treatment and where S12 implements it

The capability is in `shared/graduate-program-contract.ts` §"Foreign credential evaluations" and the `graduate_credential_evaluations` table.

1. **Equivalency is a credible possibility, not a guarantee.** Students see a fixed framing (`EVALUATION_FRAMING`). The portal never promises or computes an equivalency.
2. **Italian status and foreign outcomes are kept apart.**
   - Italian classification lives on the offering (`qualificationClassification` plus its own verification).
   - Evaluations are separate rows that never write to it.
3. **Each evaluation is tracked with its full context:**
   - evaluator;
   - destination country;
   - exact qualification evaluated;
   - intended use;
   - report date and reference;
   - the evaluator's actual conclusion, as a coarse level plus its exact wording;
   - verification status.
4. **Preliminary is never official.**
   - `evaluationType` takes one of three values: `preliminary_tool`, `completed_report` or `advisory_statement`.
   - Only a *completed report* that Lumière has verified is shown as an official outcome.
5. **WES Canada and WES U.S. stay separate.** They are distinct evaluators, each tied to its country (`EVALUATOR_FIXED_COUNTRY`). A mismatch is refused.
6. **Academic rules are unaffected.** Evaluations are not read by the guards, the credit layers or the cohort rules, and S12 tests assert this.
7. **Priority action (open):** obtain an authenticated WES U.S. evaluation for an actual graduate awarded the first-level Unimarconi master's through ENEB.
   - Record it as `completed_report` / `wes_us` / `US` and verify it against the report.
   - Then supersede claim 4 and re-assess claim 1.
   - This needs a real, consenting graduate. S12 does **not** identify or invent one.
