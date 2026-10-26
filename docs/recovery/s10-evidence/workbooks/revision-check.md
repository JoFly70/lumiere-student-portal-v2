# S10 revised-workbook check (originals, scratch revisions)

Method (`scripts/s10/revise-xlsx.py`, `scripts/s10/diff-revision.ts`): the byte-exact originals were copied to the session scratchpad (never into the repository) and revised by regex-substituting text inside the package (a course renumbered, a date moved). Base and revised workbooks were each converted by the real importer and compared with the existing draft diff (`diffRoadmapContent`, the function the draft service evaluates), with **simulated student progress on every base item and every task** (worst case). Output below is counts and public course keys only.

## EPH (validated-locked master + execution workbook)

Revision: course "Accounting 303" renumbered "Accounting 304" in master and execution (master: 2 text replacements; execution: 15); Study.com Business 103 finish target moved from Oct 4 to Oct 11, 2026 (the same text also sits in the week-3 date label, so the Government lane window moved too: this is the crude substitution, not a separate edit).

| Result | Value |
|---|---|
| base / revised items | 26 / 26 (23 plan courses + 3 `dropped` Do-not-take rows) |
| revised draft blocking findings | 0 |
| unchanged items (progress preserved, not touched by the diff) | 23 |
| changed on the **same** item key | `business-103` (finish date), `u-s-government-american-government` (week-3 window) — progress stays on the same key |
| removed | `accounting-303`, **progress flagged** (`PROGRESS_ON_REMOVED_ITEM`, warning, needs acknowledgement) |
| added | `accounting-304`; new key, collides with no base key, inherits no progress (progress is keyed by itemKey) |

## RUT (execution-final-v2-1 alone)

Revision: "Criminal Justice 305" / "CJ 305" renumbered 306 (9 text replacements); Psych 310 final moved Sep 15 -> Sep 16.

| Result | Value |
|---|---|
| base / revised items | 18 / 18 |
| revised draft blocking findings | 0 |
| unchanged items | 16 |
| changed on the same key | `psychology-310` (final date) |
| removed | `criminal-justice-305`, progress flagged (`PROGRESS_ON_REMOVED_ITEM`, warning) |
| added | `criminal-justice-306`, no base-key collision, no inherited progress |

## What this shows and what it does not

* Progress on unchanged items is preserved: they never enter `added`/`removed`; a moved date is a change on the **same** key.
* A swapped course (new code or title -> new key) leaves as `removed` with its progress flagged and returns as `added` with none. Completion cannot transfer to the replacement because progress is keyed by item key.
* **Limit (by design, unchanged by S10):** a course re-titled in place whose code or title slug is unchanged keeps its key, so progress stays on it; the diff reports it as `changed` (staff-visible) but cannot know it is a different course. The `Plan Key` column is the existing way to pin identities. Not exercised with the originals.
* The HTTP-level draft/publish version of this check on synthetic data is `tests/s07-import-http.test.ts` (existing) and the synthetic revision tests in `tests/s10-original-layouts.test.ts`.
