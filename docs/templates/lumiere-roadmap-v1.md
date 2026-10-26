# Lumière roadmap workbook (`lumiere-roadmap-v1`)

Staff prepare roadmaps in Excel and upload them in **Admin > Student > Roadmap**. Flow: Upload > Convert > Review exceptions > Preview > Publish. An import only ever creates a **draft**. Nothing is published automatically, a published plan is never overwritten silently, and student progress is never erased.

Start from `lumiere-roadmap-v1.xlsx` (same folder). Regenerate it with `npx tsx scripts/s05/build-roadmap-template.ts`.

## Sheets

| Sheet | Required | Notes |
| --- | --- | --- |
| `Plan` (alias `Roadmap`; otherwise the first sheet) | yes | One row per item. Row 1 = headers. |
| `Objectives` | no | Key, Title, Kind (Primary/Secondary/Parallel/Prerequisite), Institution, Credential, Status, Note. The first primary objective is the assigned degree. Without it, one primary objective is created. |
| `Milestones` | no | Key, Title, Kind, Target Date, Objective, After (comma list of Plan Keys or codes). |
| `About` | no | Label/Value pairs: Plan Title, Summary, Primary Degree, Institution. |

Rows whose first cell starts with `#` are comments. Rows with neither Title nor Code are skipped.

## Plan columns (case, spaces and punctuation are ignored)

| Column | Aliases | Meaning |
| --- | --- | --- |
| **Phase** (required) | Stage, Term, Block | Phase title. Phases are ordered by first appearance. |
| Objective | Degree, Goal, Track | Objective title or key. Blank = the primary objective. |
| Seq | Order, #, Sequence | Integer order. Default = row order. |
| Plan Key | Key, ID | Stable identity. Progress is attached to it. Strongly recommended. |
| Code | Course Code, Course #, Course Number | |
| **Title** (required) | Course, Course Title, Course Name, Item | |
| Provider | Source, Platform | e.g. Sophia, Study.com |
| Institution | Credit To, School | Who will grant the credit. Informational only. |
| Credits | Credit, Cr, Credit Hours, SH | Planned credit value. Informational only. |
| Start / End | Start Date, Planned Start / End Date, Target, Target End, Due | Excel date, `YYYY-MM-DD`, `M/D/YYYY`, `Mon YYYY` (1st of the month). |
| Depends On | Prereq, Prerequisites | Comma list of Plan Keys or codes. |
| Status | Plan Status | Planned, Hold, Alternative, Dropped. |
| Hold Reason | | Required when Status is Hold. |
| Approval | | Required / Pending / Approved; anything else = not required. |
| Alternative For | Alternative Of | Plan Key or code of the item this replaces. |
| Challenges, Milestones, Touchstones, Papers, Quizzes, Exams, Assignments | | Whole numbers. `Challenges = 3` creates `challenge-1`..`challenge-3`. |
| Tasks | | List separated by `;`, e.g. `Touchstone 1; Final Exam`. |
| Kind | Type | Course, Exam, Application, Task. Default Course. |
| Student Note | Notes, Note | Shown to the student. |
| Staff Note | Internal Note | Never shown to the student. |
| Condition | | Free text. Always becomes a warning. |

Unknown columns are ignored and listed as information.

## What you will see in the review

* **Blocking** (must be fixed in the draft editor or the workbook): unknown template, missing Phase/Title column, duplicate keys, unknown phase/objective/dependency, dependency cycle, missing primary objective, hold without reason, invalid package.
* **Warning** (must be acknowledged before publishing): unreadable dates/credits/task counts, rows without a Title, objectives or phases created from rows, a `Condition`, duplicate generated keys, anything the AI was unsure about, ignored credit claims, a primary objective that changed, progress that exists on something being removed.
* **Information**: generated item keys, unmapped columns, skipped blank/header rows.

Re-importing a revised workbook creates a new draft compared with the published plan: added, removed and changed items are listed (date-only changes are marked harmless). Progress on a removed item is kept in history and is **not** transferred to a replacement item.

## AI-produced packages

ChatGPT, Claude or a script may produce a JSON package. Paste it in the "AI package" box. It goes through the same validation. Uncertain items become warnings; credit/acceptance claims and approvals are ignored and flagged. Nothing an AI writes is a verified institutional decision.

```json
{
  "format": "lumiere-roadmap-package/1",
  "generator": { "name": "ChatGPT", "model": "gpt-5", "preparedAt": "2026-01-05" },
  "content": {
    "contentVersion": "roadmap-content/1",
    "title": "Roadmap for Jane Doe",
    "objectives": [{ "key": "bs-biology", "title": "BS Biology", "kind": "primary", "linkedToProgramAssignment": true }],
    "phases": [{ "key": "foundation", "title": "Foundation", "sequence": 1 }],
    "items": [{
      "key": "bio-101", "phaseKey": "foundation", "objectiveKey": "bs-biology", "sequence": 1,
      "code": "BIO 101", "title": "Introduction to Biology", "credits": "3",
      "plannedStart": "2026-01-12", "plannedEnd": "2026-02-20",
      "tasks": [{ "key": "challenge-1", "kind": "challenge", "title": "Challenge 1", "sequence": 1 }]
    }]
  },
  "itemAnnotations": [{ "itemKey": "bio-101", "confidence": "medium", "needsReview": true, "rationale": "Course name matched loosely" }],
  "creditClaims": []
}
```
