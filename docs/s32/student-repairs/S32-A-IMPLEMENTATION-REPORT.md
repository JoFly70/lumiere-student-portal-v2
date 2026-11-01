# S32-A — Student Experience Repairs: Implementation Report

**Scope:** all 34 S31-A findings (6 High, 20 Medium, 8 Low), repaired in place on the existing architecture.
- No new product, page, navigation item, AI system, payment processor, PWA or service worker.
- Per-finding detail is in `S32-A-FINDINGS-RECONCILIATION.md`.

## How the work was organised

The lead (Opus) split the work into four Sonnet workers with exclusive file ownership in one working tree:

| Stream | Files owned | Findings |
|---|---|---|
| Assistant | `server/services/academic-assistant/*`, `server/data/academic-assistant/knowledge.ts`, `server/services/assistant-conversations/reply.ts`, `server/routes/academic-assistant.ts` | F01, F02, F03, F07 (KB), F11 (copy), F13, F24 (assistant), F25, F34 |
| Degree and course page | `components/degree-journey/*`, `flight-instrument.tsx`, `roadmap-log.tsx`, `beyond*`, `high-school/*`, `elective-change.ts`, `student-calendar.tsx` | F04, F07 (roadmap), F11, F14, F17 (Beyond), F18, F26, F31 |
| Flight Deck | `flight-deck.tsx`, `degree-flight-deck.tsx`, `deck-parts.tsx`, `cockpit-model.ts`, `degree-cockpit-model.ts`, `dates.ts`, `student-progress/states.tsx` + unpublished views | F06, F07 (deck), F08 (deck), F12, F15, F16, F17 (deck), F28, F31 (deck) |
| Services and accessibility | `billing-view.tsx`, `documents.tsx`, `library.tsx`, profile, login view, `i18n/index.ts`, `ui/*` sr labels, `client/index.html`, CSS | F05, F08 (profile), F09, F10, F19, F20/F30 (patch), F21, F22, F23, F24, F27, F29, F32 |

To avoid edit collisions, each stream got its own new i18n module (`client/src/i18n/modules/s32-{assistant,degree,hs,services}.ts`, spread into `en.ts`/`fr.ts`). Existing key values were changed only with small, targeted edits.

The lead did the rest:
- integration and F33;
- the cross-stream follow-ups (the Library uploader, the evidence tab links, and the unpublished-plan translation);
- an independent code review by a fifth agent, plus the fixes it led to;
- the visual review and its fixes;
- the full suite, the build and these documents.

## Principal changes

### A. Academic Assistant (existing assistant, same model pin, same budget and rate limits)

**Record-first, deterministic answers.**
- `answerFromRecord` runs before the privacy refusal when the only PII flags are the over-inclusive self-reference patterns (F02).
- It also runs before any provider call for questions about the student themself (F13).
- Real PII (email, phone, IDs, dates) still refuses as before.

**Privacy position, enforced in code (F01).**
- `PROVIDER_RECORD_LABELS` is an empty set, applied inside `buildProviderMessages`: no student record is ever sent to the provider.
- `providerSafeHistory` removes earlier record answers, and the question that produced each, from the history sent to the provider (found by the independent review).
- The provider receives only the typed question, PII-checked history and public reference notes.
- `.replit` (`SPARK_ASSISTANT_STUDENT_POLICY=minor_safe_v1`) is unchanged; it belongs to S32-B. Whatever its hosted value, live mode now carries no personal data.

**Degree data (F03).**
- New `degree-record.ts` builds "Degree credits" (Earned / Planned / Still open), "Degree requirements" (residency first) and degree "Next tasks".
- They come from the student's own published roadmap and canonical degree progress, loaded with the session user's own student id only.
- A test asserts the figures equal the Flight Deck's `degreeFigures`.

**Intents (F13).**
- Accent-folded matching.
- New intents: urgent, track, graduation and roadmap. "owe" now routes to Billing and « examen » to next tasks.
- A billing question with no billing on file gets a truthful line.
- All six dashboard chips get relevant record answers in EN and FR, for HS and degree.

**Knowledge base by program (F25).**
- An audience tag (`hs` | `degree` | `all`), plus 4 anonymised degree entries with no invented numbers.
- The owner AI is unaffected (default `all`).

**Grounding (F34).** Record answers return `grounded: 'record'` and `recordRefs`, links to the student-visible pages. They are stored as `privateRefs` and shown as "From your records".

**Language (F24).** Record text is composed in the student's language. « Assistance » replaces « Soutien ».

### B. Academic credit and progress

- **F04:** the degree Roadmap "Completed" header counts only `officially_accepted` credit, plus "· N waiting for the university". `isCourseDone` and the academic rules are untouched.
- **F07:** one vocabulary everywhere — Earned / Planned / Still open, « Acquis / Prévus / Encore ouverts ». It covers the deck, roadmap, unpublished views and assistant.
- **F15:** the pace pill reads "On pace once pending results arrive" only when confirmed + awaiting ≥ expected. The pace calculation and the credit tiers are unchanged.
- **F16:** program-aware checkpoint labels; "university" on the degree deck.
- **F17:** the requirement shortfall beside "Still open", from canonical requirement data only. Beyond the Bachelor's uses the plan's graduation milestone.
- **F14:** flight-path labels that cannot be placed without colliding are not drawn; their names stay in the legend, tooltip and aria label.
- No credit record, official result or projection formula was modified.

### C. Billing (F05)

- Next or overdue instalment line first in the hero.
- An always-visible "Send proof of payment" link to `/documents?tab=financial`.
- A truthful "How to pay" block. **No payment instructions exist in the repository**, so nothing about banks, cards, addresses or methods was invented. The block says the Lumière team provides the instructions and links to Assistance (`?topic=billing`, preselecting the billing topic) and the official WhatsApp contact.
- The distinction between "submitted evidence" and a confirmed payment is preserved.
- Owner-approved text can later go into `s27.bill.howText` (EN/FR).

### D. Documents and Library

- **F09:** Library reads `review_message` and links to "Replace it in Documents".
- **F10:**
  - The All tab asks for the type and defaults to "other".
  - The Academic tab files `hs_transcript` only for high-school students.
  - The Library uploader follows the same rule.
  - Every offered type is accepted by the server enum.
- Documents supports `?tab=` (all, academic, financial, identity, foreign_credentials, transfer_credits, chat).
- Student-facing document type names are translated.

### E. High-school course journey

- **F11:** the existing elective-change control (same dialog, endpoint, approval and roadmap versioning) appears on elective rows of the default course page. The assistant copy now names that place. The ticket status line is bilingual; the subject prefix parsed by staff code is unchanged. `?view=details` is kept.
- **F12:** the existing `WelcomeBanner` shows on both published decks.
- **F31:** the existing graduation banner and transcript request appear on the deck and the default course page when the diploma is conferred.

### F. English and French

**Translated:**
- **F06:** the first-login and not-ready screens, the error state (with the raw error text removed) and the unpublished-plan views.
- **F08:** deadline cards and profile readiness rendered from keys.
- **F19:** sign-up error codes.
- **F29:** screen-reader labels.
- **F28:** plurals, the doubled period and « 1er ».
- **F24:** one term each — Assistance, Études secondaires, courriel.

**F23:** browser-language detection only applies when nothing is stored and there is no `?lang=`. It is never persisted.

### G. Mobile and visual

- **F27:** orb clearance at phone widths. The orb stays bottom-left.
- **F21:** badge contrast token swap.
- **F32:** `viewport-fit=cover` and light/dark `theme-color`.
- New action links are 44 px tap targets.
- **F22:** WhatsApp link on the login page.

### H. Dead code (F33)

- Removed 5 unreferenced files.
- 3 unrouted files that existing tests still import are marked `@deprecated` with a "do not fix student UI here" header.
- The routed `/high-school/flight-deck?view=credits` URL is kept.

## Data, privacy and safety

- No migration, no server data-shape change, no production access, no secret, and no live call.
- Only one server student-data path changed: `loadOwnStudentRecord` now also reads the student's own roadmap and degree progress. The id comes from the session user.
- Test fixtures are synthetic (`*.invalid`, `*.example`, DEMO-style names). The independent review grepped the diff for names, emails and keys: nothing found.
