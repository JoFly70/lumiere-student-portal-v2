# S32-A — Test Evidence

Everything below ran in the S32-A cloud container on synthetic fixtures.
- **None of it is production or authenticated verification.** No student credentials exist here; the live site was not contacted.
- **Labels:**
  - **UT:** vitest.
  - **LS:** local browser simulation; the real client in Chromium, every `/api` call stubbed from `tests/helpers/*`.
  - **PR:** the real assistant functions on composed synthetic records.

## 1. Gates

| Gate | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit -p .` | **Pass**, 0 errors, after the last code commit |
| Full Vitest suite | `npx vitest run` | **Pass**: 252 files passed, 8 skipped (260); **4,043 tests passed**, 192 skipped, **0 failed** |
| Production build | `npm run build` (vite + esbuild) | **Pass**. Only the pre-existing chunk-size warning. |
| EN/FR parity | `tests/s18-i18n.test.ts`, `tests/s19-i18n-parity.test.ts` | **Pass**, inside the full suite |
| Shared S29 patch | `patch -p1 --dry-run` on this branch, then applied in a scratch worktree with `s29-templates.regression.test.ts` and the existing S29 tests | Dry run clean; **4 files / 47 tests pass** |

**The 8 skipped files:** `phase1*` / `phase2*` / `pre-replit-security-e2e` integration suites. They refuse to run without an external `DATABASE_URL` (their own safety guard). The skip depends only on the environment (no `DATABASE_URL`), not on this branch; those files were not changed. The local real-Postgres harnesses (`s05`/`s07`/`s11`/`s13`…) did run, using the container's PostgreSQL 16 binaries.

## 2. New S32-A tests (11 files, 150 tests, all passing)

| File | Tests | Covers |
|---|---|---|
| `tests/s32a-assistant-records.test.ts` | 22 | F01 (provider body has no ticket subject, amounts, document type, goal or session times), F02, F11 copy, F13 chip table, F24, F34 |
| `tests/s32a-assistant-degree.test.ts` | 30 | F03 (degree figures equal the deck's `degreeFigures`), F07 KB, F25 audience filter, degree chips |
| `tests/s32a-assistant-review-fixes.test.ts` | 18 | Review fixes: record answers in history never reach the provider (end to end through a fake provider); general questions go live; personal questions stay deterministic with 0 provider calls; a date in history no longer triggers refusals |
| `tests/s32a-degree-roadmap.test.ts` | 16 | F04, F07 roadmap, F11 (elective control, French label, staff parser), F14 `placeLabels`, F17 Beyond year, F18, F26, F31 |
| `tests/s32a-deck-render.test.ts`, `s32a-deck-units.test.ts`, `s32a-deck-unpublished.test.ts` | — | F06, F07 deck, F08, F12, F15, F16, F17 shortfall, F28, F31; FR unpublished deck and roadmap with no English |
| `tests/s32a-services-billing.test.ts` | 7 | F05 |
| `tests/s32a-services-docs.test.ts` | — | F09 (real presenter shape), F10 (every offered type is in the server's `docTypeEnum`) |
| `tests/s32a-services-misc.test.ts` | — | F08 profile, F19, F21, F22, F23, F29, F32 |
| `tests/s32a-lead-integration.test.ts` | 12 | Library uploader (F10 follow-up), evidence tab links (F05/F26), billing without billing (F13), translated document type names |

## 3. Existing assertions updated (wording only; not weakened)

Each change follows a finding that requires the new wording. Every assertion checks the same thing it checked before.

| File | Old → new | Finding |
|---|---|---|
| `tests/phase5f-production-truth-routing.test.ts` | Asserted the English text inside `states.tsx` → asserts the component uses the key and that the key holds the same English text | F06 |
| `tests/s05-student-roadmap-views.test.ts` (4) | "credits applied" / "Applied means…" / "Applied 63" → "earned…" | F07 |
| `tests/s10-student-ux-pass.test.ts` | "63 of 120 credits applied" → "63 of 120 credits earned toward your degree" | F07 |
| `tests/s19-login.test.ts` | « Adresse e-mail » → « Adresse courriel » | F24 |
| `tests/s25-hs-i18n.test.ts` (2) | « Mon parcours au lycée » → « Études secondaires » | F24 |

## 4. Assistant probe (PR)

`docs/s32/student-repairs/harness/assistant-probe.ts` runs the real `answerMessage` in a **live** configuration, with a fake provider and the pinned model and API base. It asks the S31-A probe questions for an HS persona and a degree persona. Output: `evidence/assistant-probe-after.json`.

| Result | S31-A (before) | S32-A (after) |
|---|---|---|
| « Où en sont mes crédits ? », "Where are my credits?", "What is my balance?", « Explique-moi ma feuille de route » | Privacy refusal | Record answer, 0 provider calls |
| "What's most urgent?", "Am I on track?" (EN/FR) | Generic KB | Record answer (next tasks + deadlines; timeline / pace / degree credits) |
| "How much do I owe?" | Routed to Documents | Billing record; degree student without billing gets the truthful line |
| « Quand est mon prochain examen ? » | No intent | Next tasks |
| Degree "How many credits do I still need?" | Glossary | Earned / Planned / Still open from the student's own degree record |
| "Can you explain photosynthesis?" | — | Live (1 call), **no record data in the provider body** |
| "My email is …, what are my credits?" | — | Privacy notice, 0 provider calls (real PII still refuses) |
| **Totals (36 questions)** | — | 32 record answers, 2 provider calls, 0 provider bodies containing record data |

## 5. Visual coverage (LS)

The harness is `docs/s32/student-repairs/harness/s32-render.ts`, adapted from S31-A's `s31-render.ts` with the same fixtures. It ran on the starting SHA (in a separate worktree) and on this branch.

**Matrix:** 11 screens × HS and degree personas × 1440 / 768 / 390 × FR light, FR dark, EN light = **126 renders each**. A re-run of the deck, billing, library and documents screens after the last fixes adds **45 renders**.

| Probe | Before | After |
|---|---|---|
| Horizontal overflow | 0 | 0 |
| Page errors | 0 | 0 |
| Unstubbed API calls | 0 | 0 |
| Heuristic English-leak lines in FR | 6 | 6 in the full matrix. All 6 are a synthetic student-typed reason on Profile (data). The re-run of the changed screens finds 0. |

The text diffs confirm the fixes per screen, for example:
- deadline cards and « déc.. » (F08, F28);
- « Terminés · 1 cours, 3 crédits · 1 en attente de l’université » (F04);
- 6 « Demander un changement » on the default course page (F11);
- the Library reason (F09);
- profile readiness in French (F08);
- « Québec, 2028 » (F17);
- « Demander ce créneau » (F18).

### Before/after screenshots

The images are in `evidence/before/` and `evidence/after/`, under the same names. They are quantized to keep the repo small, and full pages are cropped at 3000 px.

| File | Shows |
|---|---|
| `first-hs-billing-fr-390-light.png`, `hs-billing-fr-390-dark.png` | F05 overdue line first, "How to pay", proof link; F27 last element clears the orb; F28 « 1er oct. » |
| `ba-flight-deck-fr-1440-light.png`, `ba-flight-deck-en-1440-light.png`, `ba-flight-deck-fr-768-light.png` | F14 labels no longer overlap; F07 Acquis / Prévus / Encore ouverts; F16 degree checkpoints; F12 welcome; F17 shortfall |
| `first-hs-flight-deck-fr-1440-light.png`, `first-hs-flight-deck-fr-390-light.png`, `hs-flight-deck-fr-390-dark.png` | F08 French deadline cards; F28; F12; F15 |
| `ba-roadmap-fr-390-light.png` | F04 Completed header; F07 |
| `first-hs-hs-roadmap-fr-1440-light.png` | F24 eyebrow « Études secondaires » (the elective controls are lower on the page; text diff above) |
| `hs-library-fr-390-light.png`, `first-hs-documents-fr-390-light.png` | F09 reason and replace link; F10 type select and mobile upload button |
| `hs-profile-fr-1440-light.png` | F08 readiness in French; F24 |
| `ba-beyond-fr-1440-light.png`, `first-hs-calendar-fr-390-light.png` | F17 intake year; F18 request wording and the Calendar link |

**Matrices:**
- `evidence/render-matrix-before.json`, `render-matrix-after.json`, `render-matrix-after-rerun.json`.
- Per render: overflow, small targets, unnamed controls, English leaks and errors.

## 6. Not verified (and why)

- **Signed-in production pages, the hosted assistant mode (F01 `GET /api/assistant/status`) and live provider answers.** There are no student or DEMO credentials in this environment, and no session was forged.
- **Notification copy in production (F20/F30).** The fix depends on S32-B applying the patch.
- **Reset and verification email language.** These are Supabase templates, outside the student UI.
