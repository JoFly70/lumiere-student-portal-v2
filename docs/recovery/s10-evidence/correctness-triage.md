# S10 correctness triage of the independent design review

Source: `docs/recovery/s10-evidence/student-ui/independent-review-s10-final.md`. Branch `s10-sonnet7-correctness`, base `77a253b` (+ merge of `c638ff5`).
Classes: **P** Confirmed product defect, **F** Inconsistent synthetic fixture / renderer artifact, **T** Misleading presentation or terminology, **D** Design weakness (recorded for the visual pass, not changed), **X** False positive.
Screen numbers refer to `docs/recovery/s10-evidence/screens/` (s10) and `docs/recovery/s09-evidence/screens/` (s09).

## Automated-check caveats

| Finding | Class | Evidence | Fix | Test |
|---|---|---|---|---|
| `toast.changedControl` all zeros, so overlap check proved nothing | F | The native `<select>` has a 0x0 rect; the metric measured it | Fixed by orchestrator in c638ff5 (measures the visible wrapper); now a real rect is recorded | `chrome-metrics.json` |
| Inline staff "Documents" link 17px tall | D | Staff workspace link styling | Recorded for the staff visual pass | - |

## (a) Student experience

| Finding | Class | Evidence | Fix | Test |
|---|---|---|---|---|
| Documents tab bar cool grey, generic tiles, "Pending Review" Title Case | D | `documents.tsx` styling | Recorded | - |
| Documents stat tiles wrap 2+1+full at 390 | D | layout | Recorded | - |
| Flight Deck dense at 1440; Flight Deck 5150px / Roadmap 5587px at 390 | D | page heights in `chrome-metrics.json` | Recorded | - |
| Same idea encoded three ways; tracker labels ~9px and wrapped at 390 | D | roadmap tracker | Recorded | - |
| "63 of 120 credits" three times; Flight Deck vs Roadmap overlap; Documents files below fold | D | page composition | Recorded | - |
| Flight Deck prior credentials (AAS Medical Assisting, Riverbend 2019 + PM certificate) vs Profile (Associate in Business Administration, Collège Ahuntsic 2017) | F | Production derives Profile "prior credentials" from the canonical academic sources (`loadPriorCredentials`); the Profile fixture was hand-typed with different data | Profile now built by the real read model from the SAME sources as the roadmap (`priorCredentialsFromSources`, `tests/helpers/canonical-synthetic-student.ts`) | `s10-canonical-student-consistency` "prior education is the same..." |
| "courses" (Flight Deck) vs "items" (Roadmap) for one phase | T | Different noun per page | Recorded (no copy change without product owner) | - |
| Toast says "you reported Challenge 3 done" while control still reads "Started / Overdue" | F | Renderer progress stub returned the stale view; real contract returns the post-write view (owner-confirmed, c638ff5). `chrome-metrics.json` `toastRowAgrees` now shows select value `graded` with the toast | Stub fixed by orchestrator; not edited here | `chrome-metrics.json` |
| "Verified" chip black filled on Flight Deck vs gold outline on Documents/Profile | D | styling | Recorded | - |
| "Received" vs "With your advisor" unexplained | T | `open` -> Received, `in_progress` -> With your advisor are different states | One documented translation table (`SUPPORT_STATUS_LABEL`, spec section "S10 addendum"); wording unchanged | `s10-correctness-regressions` "status vocabulary" |
| Support and Documents accept different file types | D | `accept` lists differ | Recorded | - |
| Dialog content below sticky Cancel/Send footer (s09 07/08/09, s10 25) | P | Footer was `sticky bottom-0 -mb-6` over a single scrolling dialog; content scrolled under/peeking beside it | Dialog is now header / body (only scroll region) / footer, footer a flex sibling (`profile-ui.tsx` `DialogBody`, both dialogs). The clipped sliver at the body edge in a screenshot is ordinary scroll clipping above a bounded footer | `s10-correctness-regressions` "dialogs" |

## (b) Staff experience

| Finding | Class | Evidence | Fix | Test |
|---|---|---|---|---|
| Support desk and workspace generic grey/blue, no brand | D | visual | Out of scope (later visual pass) | - |
| Workspace seam "END OF PROFILE & IDENTITY"; 768 "IN_PROGRESS" spills tile; "Fingerprint" clipped | P (spill) / D (seam) | The tile printed the raw enum without wrapping; fingerprint line was always printed | Tile shows "In progress" with `break-words`; fingerprint shown only when valid, truncated | regressions "no raw system values" |
| KPI tiles bare numbers; no queue visualisation / age cue | D | visual | Recorded (tiles now show pressed state) | - |
| Red "Overdue 2" traceable to no ticket | F | `STAFF_STATS` was hard-coded while the 5 fixtures had none overdue | Stats computed from the tickets with the shared `isOverdue`; one demo ticket is genuinely overdue and carries the `overdue-flag` pill | regressions "overdue indicator", "every tile equals its list" |
| Workspace has no progress visual | D | visual | Recorded | - |
| Raw enums on screen: `waiting_on_student`, `in_progress`, `IN_PROGRESS`, `hs_transcript`, `id_gov` | P | Production code printed `{ticket.status}`, `{document.doc_type}`, `value(report,"status")` | `staffStatusLabel`, `docTypeLabel`/`docStatusLabel` (`client/src/lib/document-type-labels.ts`, shared with the student Documents page), `workspaceToken`; `id_gov` -> "Government-issued ID" | regressions "maps enum tokens" + source guard |
| ISO timestamps `2026-10-25T09:00:00.000Z` | P | `displayDate` returned `toISOString()` | `formatWorkspaceDateTime` -> "Oct 25, 2026 · 9:00" in the viewer's zone (zone-aware, tested for UTC and Toronto) | regressions "formats ISO timestamps" |
| "Uploaded Not provided" | P + F | Page read `uploaded_at`; the fixture rows only had `created_at`. The page printed a placeholder instead of omitting | Reads `uploaded_at ?? created_at`; line omitted when absent; fixture rows now carry `uploaded_at` | source guard |
| "Version Not provided" / "Current program: Not provided" / "No canonical credit records" for a student with 63 credits | F + T | Workspace fixture was an empty stub (`program: null`, no snapshot, no credits). Page printed "Not provided" | Workspace payload now derived from the canonical program, sources and credits; page shows "No program assigned" / omits version / omits empty lifecycle fields (actionable errors are kept) | consistency "degree assignment and verified credits agree" |
| "Fingerprint unavailable" and placement disabled with vague "Refresh workspace" | F + T | Fixture had no snapshot (correct to disable controls then); the copy was jargon | Fixture has a snapshot; the notice now reads "Placement changes are paused: this student has no current academic snapshot yet..." | `admin-student-workspace-presentation` |
| Tabs above a page that stacks every section; tabs do not change content | T | They are in-page anchor links (Roadmap a route link) | Labeled "Jump to"; real tab switching recorded as D | - |
| "Needs a decision (2)" directly above "Needs attention 0 items" | T | Two different queues: profile/identity decisions vs canonical academic-report items | Academic card renamed "Academic report review" with a pointer to the decisions above; singular "1 item" | `admin-student-workspace-presentation` |
| No "Students" nav yet "Back to Students" | D | Link goes to `/admin?tab=students`; sidebar has Admin Dashboard | Recorded | - |
| Sidebar "Student Portal" on desk vs "Admin Portal" on workspace | P | `app-sidebar` returned "Student Portal" for every non-admin, so staff/coach saw it | Staff and coach get "Staff Portal" | regressions "shell label"; `phase5f` guard updated |
| Card "Assigned: Camille Moreau" vs dropdown "Unassigned" | F (+ hardening) | Fixture detail had `assignee` but no `assigned_to` (optional in the contract); dropdown read only `assigned_to` | Fixtures bind id; dropdown falls back to `assignee.id` (`assigneeSelectValue`) | regressions "assignee" |
| "Needs response" selected but all 5 tickets (incl. Resolved) listed | F | Renderer ignored query parameters; client/server filters were already right (`s08-support-routes` filter test) | Renderer models the queue with the shared rules (`tests/helpers/support-queue-sim.ts`) | regressions "Needs response lists only awaiting staff" |
| KPI "Unassigned 2" vs 1 shown | F + P | Hard-coded stat; AND the "Unassigned" chip queried `view=active` (includes waiting-on-student) while the tile counts awaiting-staff only | Chip query is now `view=active&awaiting=staff&assignedTo=unassigned` = the tile population; tiles are filters with a pressed state | regressions + `s08-support-routes` "every stats tile equals the list" |
| Ages "1 day" for tickets opened 12 days / 2 months ago | F + T | Resolved fixture inherited a stale `awaiting_since`; the row showed an unlabeled age | `staffRowAge`: "Waiting 2 days" / "Asked 1 day ago" / "Resolved 6 days ago"; fixtures' `awaiting_since` consistent; renderer clock fixed to the fixture date | regressions "row age is honest" |
| One ticket "New" (desk) / "open" (workspace) / "Received" (student) | P (raw `open`) + T | Workspace printed the enum; desk and student words differ by design | One table in `shared/support-contract.ts`, documented in `docs/s08/S08-support-api-spec.md` | regressions "documented translation table matches the code" |
| Pending-correction card, 44px targets | X | Reviewer praise | - | - |
| Placement control disabled by missing fingerprint | X (as behaviour) | Disabling without a valid snapshot is the intended safety rule | Wording only (above) | - |
| "Awaiting decision ↑" pill as scroll affordance; 218px permanent sidebar at 768 | D | visual | Recorded | - |

## (c) Student Profile

| Finding | Class | Evidence | Fix | Test |
|---|---|---|---|---|
| Header lopsided at 390; chips wrap to 3 rows; glance card at y~600 | D | visual | Recorded | - |
| Icons decorative; no completeness visual; dashed vs solid pills subtle | D | visual | Recorded | - |
| Eligibility/Account collapsed to thin rows | D | visual | Recorded | - |
| Glance: "Nothing for you to do" while a guardian consent upload is requested | P | `buildStudentProfileView` classified a pending guardian as `pending_review` (Lumière's court) while the contact card told the student to upload a consent | Pending/declined authority with no consent on file is `action_required`; once a consent is on file it is Lumière's review. Four groups now: Needs your attention / Waiting on Lumière / Waiting on an outside institution (foreign credential evaluation) / Completed. Rejected/resubmit-requested documents were already actions. A merely listed contact never produces authority | `s09-profile-security` "student's action until a consent is on file", `s09-student-profile-views` "four groups" |
| s09 01 omits residency resubmission and Jordan Lake's consent | F | `RICH_PROFILE.readiness` was hand-typed and inconsistent with its own documents/contacts | Readiness rewritten to what the read model derives; guard test asserts nothing student-actionable is omitted | `s09-student-profile-views` "RICH fixture's readiness agrees..." |
| Contact card says "Lumière is waiting for a signed consent" even after a consent was uploaded | P | Card text ignored readiness | Card says "Lumière is reviewing the consent you sent" when readiness is `pending_review` | views "pending authority card" |
| Staff panel shows Amy / WhatsApp / pending last-name correction / +1 514 phones; student profile shows None / Email / none / +1 555 010 0000 | F | Two hand-built fixtures for one student | ONE canonical student row -> `buildStudentProfileView` for both viewers; pending correction visible to the student. Screen 25 uses the "before the request was sent" variant because the Request button is hidden while a correction is pending | consistency "identity", "phones and preferred channel", "pending identity correction" |
| "Academic records does not apply" | T | Verb chosen by count, label is a plural noun | Reworded: "Not in force until Lumière verifies authority: Academic records, ..." | `s09-student-profile-views` |
| "Fix" button label vague | T | `readinessAction` default | "Upload new file" / "Upload signed consent" (to Documents), "Review" otherwise | views |

## Fixture architecture (owner item 4)

`tests/helpers/canonical-synthetic-student.ts` holds ONE student record, documents, guardian rows and corrections. Profile (student and staff), documents API, `/me`, degree progress, staff workspace and ticket assignees are derived from it and from the existing roadmap fixture via the real read model (`server/services/student-profile-read-model.ts`, extracted unchanged from the service so the renderer can import it without a database). `tests/s10-canonical-student-consistency.test.ts` asserts agreement of identity, preferred name, contact, academic background, degree assignment, verified credits, tickets/advisor, corrections, guardians and document statuses.

## Not done / left open

- Real tab switching in the staff workspace and the whole staff visual pass (D).
- Roadmap/Flight Deck mobile length, repeated credits, tracker labels (D).
- "courses" vs "items" wording (T) needs a product decision.
- The renderer's `/api/student/roadmap/progress` stub was not edited here (orchestrator fixed it in c638ff5).
