# S32-A — Regression Results

| Area checked | How | Result |
|---|---|---|
| Whole codebase | Full Vitest suite (252 files passed, 8 env-gated skips; 4,043 tests), `tsc`, production build | No failures. 5 existing test files updated for wording only (see Test Evidence §3). |
| Student-role permissions | Assistant degree loading uses `getStudentByUserId(session user)`; no new routes; `HighSchoolOnly` and the route guards untouched; elective change reuses the existing endpoint | Unchanged. The independent review confirmed there is no cross-student read. |
| Academic integrity: credit tiers | `completedSummary` (accepted only), `degree-record.ts` (earned = canonical applied), `requirementShortfalls` (canonical remaining only), the pace pill (calculation unchanged) | No provider-reported or self-reported credit counted as earned. Tests assert the tiers. |
| High-school representations | Existing `s27-cockpit-model`, `s11`/`s13` HS stacks (real Postgres), `s25-hs-i18n`, roadmap-log tests | Pass |
| Degree representations | `degree-journey-model`, `s27-degree-cockpit`, `student-degree-progress-*`, `s05` roadmap views | Pass (s05: wording only) |
| Assistant | `s20-assistant-*`, `s21-ui-assistant-conversations`, `s25-assistant-confidentiality`, `s26-owner-assistant`, `s27-assistant-context`, `s27-program-guide` | Pass. Owner AI unaffected (KB audience defaults to `all`). Budget reservation, model pin and rate limits untouched. Conversation history, citations, attachments, escalation and the "not live AI" label are preserved. |
| Live path still works | Probe and review-fix tests | A general question with live enabled makes 1 provider call and returns `mode: live` |
| Documents and Billing endpoints | F10 types checked against the server `docTypeEnum`; proof link → `/documents?tab=financial` (supported); Support `?topic=billing` whitelisted | Reach working endpoints and tabs |
| Staff elective parser | The staff code reads the subject prefix and the "Current course / Preferred alternate / Reason" lines | Unchanged; the bilingual status line is appended after a blank line. Tested. |
| Links | Independent review: `?tab=` and `?topic=` whitelisted; no `dangerouslySetInnerHTML` or `window.open` added; every `_blank` link has `rel="noopener noreferrer"` | OK |
| Language selection | Stored choice wins; invite `?lang=` still applies; detection not persisted | OK |
| French « 1er » | Only French, only day 1, only day-bearing styles | OK; no other test changed |
| Visual (126 + 45 renders) | Overflow, errors, unstubbed calls, English leaks, before vs after | 0 overflow / 0 errors at 390, 768 and 1440 in light and dark |
| Themes | `s19-themes-parity`, `s19-brand`; no hand edit of `themes.css`; no raw hex in components (`theme-color` meta only, from the existing Lumière palette) | Pass |
| Secrets and private data | Diff grep by the independent reviewer | No names, keys, real emails or school name |

## Regressions found during S32-A and fixed before hand-off

| Found by | Issue | Fix |
|---|---|---|
| Independent review | Earlier record answers in conversation history were sent to the provider as history | `providerSafeHistory` (`7771fb3`) plus an end-to-end test |
| Independent review | In live mode, broad record intents answered general questions ("What is a credit hour?") with a record dump | Only personal questions are preempted (`isPersonalQuestion`); tested |
| Lead | A date inside a stored record answer made every later question refuse | The PII check now runs on the provider-safe history only |
| Full suite (lead) | `s10-student-ux-pass` asserted the old "applied" wording | Updated to the F07 wording |
| Visual review | Document type names were English on French screens | `studentDocTypeLabel` (`dc00f6a`) |
| Visual review | New billing and Library action links were 15 px high | 44 px tap targets |

## Known residuals (not regressions)

- **F27:** the orb can still pass over content while scrolling, because the owner rule keeps it bottom-left. The last element now scrolls clear of it.
- **F14:** when stops are very close, the remaining drawn label can sit near the arc markers. The overlapping text is gone.
- **Staff-entered values stay as entered**, in the language staff typed: receipt method labels ("Bank transfer"), instalment labels ("Deposit"), course titles and requirement titles. They are data, not interface strings.
- **The legacy unrouted views** (`flight-deck-view.tsx`, `roadmap-view.tsx` and their sections) remain English. They are not rendered by any page and are marked `@deprecated`.
