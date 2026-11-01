# S31-A — Student Audit: Owner Summary

**Result: PASS WITH GAPS.** The full student experience was audited. Live testing was limited to the public pages, because no synthetic student login is available outside the production workspace.

## In one paragraph

The Student Portal is in good shape. It is calm, honest, bilingual, works well on phones and needs **no redesign**. Students see their next task without clicking, logging progress takes 3 clicks, and document rejections are explained. The problems are small and local:
- **The Lumière assistant answers worse than the screen it sits on.** It refuses "Où en sont mes crédits ?" as a privacy risk. It has no bachelor's data. Two of its three suggested questions get a generic answer.
- **Two journeys stop one step short:** paying or proving a payment, and changing an elective.
- **Credit wording slips in two places on the bachelor's side.**
- **A few first-screen texts appear in English for French students.**

About 13 small fixes (roughly 3–4 working days, one release) would remove most of the friction found.

## How confident is this

| Evidence | What it covers |
|---|---|
| Live-verified | Login, invitation, forgot-password, verification and 404 pages on the published site: 3 screen sizes, light/dark, EN/FR. One wrong-password attempt using a non-existent test address. Nothing was submitted that sends email or creates accounts. |
| Locally simulated | Every signed-in student page for a high-school and a bachelor's persona, run in a real browser on the real app code with synthetic data (3 sizes, FR/EN, light/dark). **Not live data.** |
| Code-verified | Every High finding was re-checked by the lead in code; assistant routing was executed on synthetic input. |
| Not verified | Live signed-in pages, live AI answers, the language of the reset/verification emails (Supabase templates). |

## Ten most important findings

| # | Finding | Severity | ID |
|---|---|---|---|
| 1 | **Is live AI on for students?** `.replit` enables it for students (an S26 "owner-approved" policy); the S28 handoff says students are local-only. If on, students' own records (ticket subjects, billing amounts, document names) go to a provider tier that may train on inputs. Could not be checked live. | High | F01 |
| 2 | The assistant answers "Où en sont mes crédits ?", "What is my balance?" and « Explique-moi ma feuille de route » with a **privacy warning**, even though a safe local answer exists. | High | F02 |
| 3 | The assistant has **no bachelor's data**, yet the bachelor's dashboard invites « Combien de crédits me faut-il encore ? ». | High | F03 |
| 4 | The bachelor's Roadmap **"Completed · N credits" header counts courses the student only reported as finished** at Sophia/Study.com, not credit the university accepted. | High | F04 |
| 5 | **Billing never says how to pay**, and the "send proof of payment" link only appears after a proof is already being reviewed. The overdue reminder points students to an action that isn't there. | High | F05 |
| 6 | "Your plan is not ready yet" and "could not load" screens are **English only**. This is what a pre-enrollment student, including the first real student, sees first. | High | F06 |
| 7 | The French dashboard's top cards and the profile checklist show **English text built on the server** ("Proof of previous schooling — 90 days after activation", "Add a phone number"). | Medium | F08 |
| 8 | **Changing an elective is hidden** behind "Plus de détails" (4–6 clicks), and the assistant points to a button that doesn't exist on the main page. | Medium | F11 |
| 9 | **Library never shows why a document was rejected** (Documents does). Uploads from the "All" tab are filed as a high-school transcript, even for bachelor's students. | Medium | F09, F10 |
| 10 | The same credits are called « Appliqués » and « Déjà acquis » on one bachelor's screen, and the assistant uses a third vocabulary. | Medium | F07 |

## Three highest-value improvements

1. **Fix the assistant without adding AI** (F02, F03, F13, plus the F01 decision). Answer personal questions from the student's own record before the privacy refusal, add the bachelor's credit record, and make the three suggested questions work. All of it is deterministic and local, with no new data leaving the server, and it helps every student. About 1–2 days.
2. **Close the payment journey** (F05). One owner-approved "how to pay" paragraph, an always-visible "send proof of payment" link, and the next/overdue amount at the top of Billing. This directly reduces Support tickets. About half a day plus your wording.
3. **French and credit wording sweep** (F04, F06, F07, F08). Translate the first-screen states and deadline cards, count only university-accepted credit as "Completed", and use one vocabulary (Acquis / Prévus / Encore ouverts). About 1 day.

## Explicitly NOT recommended

- **No new AI tutor.** The assistant's failures are routing and missing data, not missing teaching ability. Minors, academic integrity and the provider's training tier make it costly. Revisit only for adult bachelor's students after the fixes above.
- **No native app, no offline mode, no service worker, no web push.** The mobile web experience is good. Two zero-risk meta tags only.
- **No dashboard redesign, new navigation or onboarding tour.** Mount the welcome banner that already exists.
- **No real-time appointment scheduling.** Rename « Réserver » to « Demander ce créneau » and add a request link on Calendar.
- **No online payments yet.** Clear instructions solve the observed confusion first.

## Decisions needed from you

1. **Student live AI:** confirm whether students (including minors) should get live AI answers today (F01). An engineer can then check the live setting in one minute.
2. **"How to pay" wording:** the payment methods and instructions to show on Billing (F05).
3. **Default language:** should a French browser open the portal in French when there is no invitation link (F23)?

## What changed

Only audit documents and synthetic or public screenshots were added under `docs/s31/student-audit/`. No application code, data, configuration, migration or deployment was touched.

## Next concrete step

Open an **S31-B "student fixes"** implementation session scoped to the ★ items in `STUDENT-EXPERIENCE-ROADMAP.md`. Before it starts, ask one admin to run the live check for F01. Ship under the existing release gates.
