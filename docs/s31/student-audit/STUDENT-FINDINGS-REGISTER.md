# S31-A — Student Findings Register

Audit baseline: `8d0d4dabae97fed0602ae07aab1cc24ff7d5126a` (live `/health` → release `31c3a1f…`, checked 2026-11-01).
Audit only: nothing in the application was changed.

## How to read this register

**Evidence labels**

| Label | Meaning |
|---|---|
| **LV** | Live-verified on https://lumiere-student-portal-v-2.replit.app in a real browser (public, signed-out pages only). |
| **LS** | Locally simulated: the real client code ran in Chromium (vite + Playwright), with every `/api` call stubbed from synthetic repo fixtures. These show real UI behaviour on synthetic data. **They are not live.** |
| **CI** | Code-inspected and re-checked by the S31-A lead. Where marked "executed", the real server functions were run on synthetic input. |
| **CA** | Code-inspected by a delegated reviewer and not independently re-checked by the lead. |
| **UV** | Unverified: needs live student access. |

**Severity**

| Severity | Meaning |
|---|---|
| **High** | Blocks or misleads a core student task, or creates a privacy or academic-integrity risk. |
| **Medium** | Real friction or confusion with a workaround. |
| **Low** | Polish. |

The register stays under 40 findings on purpose. Items that were checked and are fine are listed in the "Checked — NO CHANGE" section at the end, not as findings.

**Effort scale:** XS is under 1 hour, S is under half a day, M is 1–2 days.

---

## High

### F01 — Live AI for students: documented policy and configured policy disagree
- **Screen / journey:** Academic Assistant (all students).
- **Severity:** High (privacy and policy; minors).
- **Evidence (CI):**
  - `.replit:27-29` sets `SPARK_ASSISTANT_ENABLED="true"`, `SPARK_ASSISTANT_LIVE_ROLES="admin"` and `SPARK_ASSISTANT_STUDENT_POLICY="minor_safe_v1"` under `[userenv.production]`.
  - `server/services/academic-assistant/service.ts:93` makes students live when that policy is set.
  - The code comment (`config.ts:43-46`) calls it "owner-approved" (S26).
  - `docs/HANDOFF-S28.md` §2 says students get a "built-in guide … not live AI — by policy", and lists live AI for students as a pending decision (§6 B10).
  - In live mode, `buildProviderMessages` (`service.ts:159`) sends the student's own records to the training-enabled Contributor model: ticket subjects, billing amounts and document names. `detectPii` runs on the typed message and history only, never on those records (`service.ts:183`).
- **Hosted value:** UV. I could not sign in as a student, so I could not read `GET /api/assistant/status`.
- **Consequence:** If the policy is active, minors' and adults' records reach a model that may train on its inputs. That contradicts what the handoff tells future engineers and the owner. If it is not active, the `.replit` file is misleading.
- **Smallest effective fix:** The owner confirms the intended policy in one sentence. An engineer then reads `/api/assistant/status` as a DEMO student and aligns the handoff and `.replit` with the answer. If live stays on, drop ticket subjects and billing lines from the live prompt.
- **Alternatives:** Turn student live mode off until the adult/minor policy is decided. Or limit live mode to degree-only (adult) students.
- **Expected benefit:** One documented, true privacy position.
- **Risk:** None for the check. Turning live off changes answer quality for students; the local guide remains.
- **Effort:** XS (decision and check), S (prompt minimisation).
- **Confidence:** High on the code and config. Unknown on the hosted value.
- **Verification:** Read `/api/assistant/status` as a DEMO student on live. Check that the `mode` field matches the documented policy.

### F02 — The assistant refuses the most natural personal questions with a privacy warning
- **Screen / journey:** Assistant (orb and Flight Deck "Ask" card), HS and degree.
- **Severity:** High. This is the assistant's core purpose, and French phrasing is hit hardest.
- **Evidence (CI, executed):** I ran the real `detectPii` and `answerFromRecord` on synthetic records. These questions are flagged `self_id` and answered with the privacy notice, even though a matching local record answer existed and nothing would leave the server:
  - « Où en sont mes crédits ? »
  - "Where are my credits?"
  - "What is my balance?"
  - « Explique-moi ma feuille de route »

  The cause is ordering: the PII check returns at `service.ts:183-184` before the local `facts()` path at `:190-193`. The `self_id` pattern is in `pii.ts:16`.
- **Consequence:** A student who asks about "my credits" is told not to share personal details. That is confusing and erodes trust.
- **Smallest effective fix:** When the only flags are `self_id` or `my_data`, try the local record answer first and keep blocking the provider call.
- **Alternatives:** Narrow the regex. This is riskier, because the guard is deliberately over-inclusive.
- **Expected benefit:** Personal questions get the deterministic "From your record (system facts, not AI)" answer.
- **Risk:** Low. No new egress.
- **Effort:** XS.
- **Confidence:** High.
- **Verification:** Unit test: `answerMessage("Où en sont mes crédits ?")` returns a record answer and no PII notice.

### F03 — The assistant has no degree data, but the degree Flight Deck promises answers "from your record"
- **Screen / journey:** Bachelor's Flight Deck "Ask Lumière" card and orb.
- **Severity:** High for degree students.
- **Evidence (CI):**
  - `server/services/academic-assistant/student-record.ts:139-171` (`loadOwnStudentRecord`) loads high-school, documents, tickets, billing and journey data. It loads no degree progress or degree roadmap.
  - The card subtitle « des réponses tirées de votre dossier » and the first chip « Combien de crédits me faut-il encore ? » appear on the degree deck (LS, `evidence/ba-flight-deck-fr-1440.png`).
- **Consequence:** The headline question falls through to a generic glossary answer for every bachelor's student.
- **Smallest effective fix:** Add one "Degree credits" record built from the existing `degreeFigures` / `StudentDegreeProgressView`, using the deck's own labels. Map it to the `credits` and `timeline` intents.
- **Alternatives:** Hide the credits chip for degree students. That is weaker.
- **Expected benefit:** The most common degree question is answered correctly with no AI.
- **Risk:** Low, provided F07-tier wording is reused exactly (earned, planned and open are never mixed).
- **Effort:** S.
- **Confidence:** High.
- **Verification:** Unit test on `composeStudentRecords` with the COMPOSED fixture. Ask the chip in local mode and check the answer.

### F04 — The "Completed" header on the degree Roadmap counts credits the university has not accepted
- **Screen / journey:** `/roadmap`, Completed section (bachelor's).
- **Severity:** High. This directly breaks the rule that provider-reported credit never reads as earned.
- **Evidence (CI):**
  - `client/src/components/degree-journey/model.ts:192-194` treats `provider_complete` (the student says "I finished at the provider") as done.
  - `courses.tsx:208-216` sums every done item into the header, e.g. "Completed · 6 courses, 18 credits".
  - The confirmed vs "waiting for the university" split appears only after the collapsed list is expanded (`courses.tsx:226-232`).
- **Consequence:** A student can read Sophia or Study.com work they reported themselves as earned credit, in the largest type on the page.
- **Smallest effective fix:** The header counts only `officially_accepted`, plus a muted "· N waiting for the university".
- **Alternatives:** Rename the section "Finished" and keep the sum. Not recommended.
- **Expected benefit:** Credit tiers are consistent with the Flight Deck credit card, which is already correct.
- **Risk:** Low.
- **Effort:** XS.
- **Confidence:** High.
- **Verification:** Component test with one `provider_complete` item and one `officially_accepted` item.

### F05 — Billing never says how to pay, and the proof-of-payment link is often missing
- **Screen / journey:** `/billing` (HS; degree students with billing).
- **Severity:** High. This is a money journey that dead-ends in Support.
- **Evidence (CI + LS):**
  - `client/src/components/s27/billing-view.tsx` has no payment-method or instructions text (`s27.bill.*` keys checked).
  - "Upload proof of payment in Documents" (`link-upload-proof`) renders only inside `Awaiting`, i.e. only after staff have already logged evidence (`billing-view.tsx:33-43`).
  - The overdue notification says « vous pouvez envoyer la preuve depuis Facturation » (`server/services/s29/templates.ts:146-147`).
  - At 390px the first screen shows "6 750,00 $ US restant à payer" but not what is due next or that an instalment is overdue (LS, `evidence/hs-billing-fr-390.png`). That information is on the Flight Deck card.
- **Consequence:** A student who wants to pay or prove payment must open a Support request, which adds staff work. The notification sends them to a place without the action it names.
- **Smallest effective fix:**
  - One static, owner-approved "How to pay" paragraph (EN/FR).
  - An always-visible "Send proof of payment" link to Documents (Financial tab).
  - The next or overdue instalment line at the top of the hero.
- **Alternatives:** Online payment links. That is a larger project (handoff §6 C) and not needed to close this gap.
- **Expected benefit:** Fewer Support tickets and faster receipts.
- **Risk:** Low. The copy must match the contract.
- **Effort:** S.
- **Confidence:** High.
- **Verification:** Render billing with no awaiting evidence. Check that the instructions and proof link are both visible.

### F06 — The "plan not ready" and "could not load" screens are English-only
- **Screen / journey:** `/flight-deck`, `/roadmap` when the student record or plan is missing, or on load error.
- **Severity:** High in context: this is what a pre-enrollment student, including the first real student, sees first.
- **Evidence (CI):**
  - `client/src/components/student-progress/states.tsx:44,70,73` contains "We could not load your progress", "Almost there" and "Your Lumière plan is not ready yet", with no i18n import.
  - It is used at `pages/flight-deck.tsx:102-114` and `pages/roadmap.tsx:41-45`.
  - `ProgressError` also appends raw English `error.message`.
- **Consequence:** A native-French student's first signed-in screen can be in English.
- **Smallest effective fix:** Move the 6–8 strings to EN/FR keys and drop the raw error message.
- **Alternatives:** None simpler.
- **Expected benefit:** First impression matches the student's language.
- **Risk:** None. The parity tests already exist.
- **Effort:** XS.
- **Confidence:** High.
- **Verification:** `tests/s19-i18n-parity.test.ts`, plus an FR render of `PlanNotReady`.

---

## Medium

### F07 — Credit vocabulary differs between screens (degree)
- **Screen / journey:** Degree Flight Deck, Roadmap, assistant knowledge base.
- **Evidence:**
  - LS: the same 36,5 credits appear as « Appliqués » (tile, gauge "Appliqués par l'université") and « Déjà acquis » on one screen (`evidence/ba-flight-deck-fr-1440.png`).
  - CI/CA: the knowledge base teaches "Official / Reported / Awaiting verification / Planned" (`server/data/academic-assistant/knowledge.ts:97-105`), which no degree screen uses.
  - "Applied" can be read as "applied for".
- **Consequence:** Students are unsure which number is earned, which is the exact distinction the portal must protect.
- **Smallest effective fix:** One glossary across the deck, roadmap and knowledge base: **Earned** (accepted by the university) / **Planned** / **Still open**. In French: « Acquis » / « Prévus » / « Encore ouverts ».
- **Alternatives:** Keep "Applied" and add a tooltip (adds a step).
- **Benefit:** Credit tiers become unambiguous.
- **Risk:** Low.
- **Effort:** S.
- **Confidence:** High.
- **Verification:** Grep the i18n for "Applied" / « Appliqués »; check renders.

### F08 — Server-built English labels on French screens: dashboard deadline cards and the profile readiness checklist
- **Screen / journey:** Flight Deck top cards (HS and degree); Profile readiness checklist.
- **Second instance (CI, LS):** `server/services/student-profile-read-model.ts:137-192` builds readiness labels in English ("Add a phone number", "Add your address", "Identity document verified"). `client/src/components/profile/profile-page-view.tsx:73` renders them as is. The action buttons next to them are translated (`profile-presentation.ts:27-38`). Fix it the same way: render from `item.key`.
- **Evidence:**
  - LS: in French, the cards read "Proof of previous schooling", "90 days after activation", "English proficiency test" (`evidence/hs-flight-deck-fr-1440.png`).
  - CI: `server/services/program-journey/math.ts:94-96` builds `label` and `rule` in English. `client/src/lib/s27/cockpit-model.ts:112,123` renders them as is.
  - The Documents page already uses translated keys `s27.docs.deadline.<key>` for the same deadlines (`documents-lead.tsx:92`).
  - Note: course titles such as "English 3" are course data and correctly stay as named.
- **Consequence:** The most prominent cards are half English for a French student.
- **Smallest effective fix:** Render the label and rule from the deadline `key` through existing or new i18n keys, with the day count as a parameter.
- **Benefit:** Consistent French on the dashboard.
- **Risk:** Low.
- **Effort:** XS–S.
- **Confidence:** High.
- **Verification:** FR render of the deck.

### F09 — Library never shows why a document was rejected
- **Screen / journey:** `/library` (rejected or "resubmit requested" document).
- **Evidence:**
  - LS executed: with the API shape the server really returns (`review_message` set, `student_message` stripped by `server/lib/document-presenter.ts:39-53`), the Documents page shows the reason and Library does not (`journeys.json`: `J5-documents-reasonVisible: true`, `J5-library-reasonVisible: false`).
  - Cause: `client/src/pages/library.tsx:61` reads `student_message`.
- **Consequence:** A student browsing Library sees "action required" with no explanation.
- **Smallest effective fix:** Read `review_message` in Library.
- **Benefit:** The reason appears wherever the document does.
- **Risk:** None.
- **Effort:** XS.
- **Confidence:** High.
- **Verification:** The same LS journey should return true for both pages.

### F10 — Uploading from the Documents "All" tab files the document as a high-school transcript
- **Screen / journey:** `/documents` upload.
- **Evidence (CI):** `client/src/pages/documents.tsx:333-334` maps `activeTab === "all"` to category `academic`, then to `hs_transcript` (`:125-126`). This applies to bachelor's students too.
- **Consequence:** Mis-filed documents mean staff re-classify them, or a requirement looks satisfied or unsatisfied wrongly.
- **Smallest effective fix:** On the "All" tab, ask for the type (one select), or file as `other`.
- **Benefit:** Correct filing.
- **Risk:** Low.
- **Effort:** XS.
- **Confidence:** High.
- **Verification:** Unit test of the mapping.

### F11 — Elective change is not reachable from the default course page
- **Screen / journey:** `/high-school` → change an elective.
- **Evidence:**
  - LS executed: the default page has 0 change controls. "Plus de détails" leads to `/high-school?view=details`, which has 6 « Demander un changement » buttons under "Mes matières". The button count comes from `evidence/journeys.json`; `evidence/j-hs-details-fr-1440.png` shows the details view itself.
  - CI: the assistant's scripted answer tells students to use the button "on the elective's course card" (`student-record.ts`, `LEAD.change`), which does not exist on the default page.
  - The ticket subject and status line are English constants (`client/src/lib/elective-change.ts:5-9`).
- **Consequence:** The request is hidden (about 4–6 clicks through a page the student has no reason to open), and the assistant points to a button that isn't there.
- **Smallest effective fix:** Add the existing "Request a change" action to elective rows in the default `RoadmapLog`. Reuse the existing dialog; build no new flow.
- **Alternatives:** Correct the assistant copy only (smaller, still hidden).
- **Benefit:** About 2 clicks instead of 4–6, and an accurate assistant answer.
- **Risk:** Low.
- **Effort:** S.
- **Confidence:** High.
- **Verification:** LS: change control present on the default page.

### F12 — The first-login welcome is orphaned
- **Screen / journey:** First login (HS and degree).
- **Evidence:**
  - CI: the server-driven `WelcomeBanner` (`client/src/components/cockpit/welcome-banner.tsx`, `GET /api/student/welcome`) is mounted only on `/high-school/flight-deck?view=credits` (`pages/high-school-flight-deck.tsx:112,154`). The only link to that URL is in `components/high-school/student-home.tsx:169`, a component nothing imports.
  - The degree deck mounts it only for unpublished plans.
  - LS: no welcome or "start here" text on the default deck.
- **Mitigation:** The deck itself shows the next task, deadlines and support window as the first four cards, which is a reasonable "what do I do first".
- **Consequence:** The designed welcome (first vs returning, what changed) never reaches students.
- **Smallest effective fix:** Mount the existing `WelcomeBanner` above the deck cards. Build no new onboarding tour.
- **Benefit:** Orientation at zero added clicks.
- **Risk:** Low. It shows once per login and can be dismissed.
- **Effort:** XS.
- **Confidence:** High.
- **Verification:** LS first login shows the banner once.

### F13 — Assistant intents don't cover two of the three suggested questions, and one question is misrouted
- **Screen / journey:** Flight Deck Ask chips, orb.
- **Evidence (CI, executed):**
  - « Qu'est-ce qui est le plus urgent ? », "What's most urgent?", « Suis-je dans les temps ? » and "Am I on track?" match no intent (`student-record.ts:104-115`), so they get the generic knowledge-base answer.
  - "How much do I owe?" routes to **Documents** (the `owe` keyword), not Billing.
  - « Quand est mon prochain examen ? » matches nothing, while "When is my next exam?" does.
- **Consequence:** The suggested questions the portal itself offers get generic answers.
- **Smallest effective fix:**
  - Add `urgent` (next tasks plus deadlines) and `track` (pace) intents.
  - Move "owe … money/pay" to Billing.
  - Add `examen|prochain`.
- **Benefit:** The suggested questions work.
- **Risk:** Low.
- **Effort:** XS.
- **Confidence:** High.
- **Verification:** Table test of the chip strings (scratch probe reproduced in the Journey Matrix).

### F14 — Flight-path milestone labels overlap when stops are close together
- **Screen / journey:** Flight Deck "Votre vol vers…" instrument (degree; HS when phases cluster).
- **Evidence:** LS: "Nursing Prerequisites", "Business Core", "Foundation Courses" and "51,5 CRÉDITS · PRÉVUS" print on top of each other (`evidence/ba-flight-deck-fr-1440.png`). The collision-aware placement (`client/src/components/s27/flight-instrument.tsx:243`) has no fallback when every slot is taken.
- **Consequence:** The centrepiece visual is illegible for some plans. Aesthetic, but on the main screen.
- **Smallest effective fix:** When no slot clears, drop the name and keep it in the existing legend and tooltip.
- **Benefit:** No unreadable text.
- **Risk:** Low.
- **Effort:** S.
- **Confidence:** Medium. Seen with synthetic fixture spacing; real plans may differ.
- **Verification:** LS with the `RICH_MID_JOURNEY` fixture.

### F15 — "Behind plan" ignores work that is awaiting the school's result
- **Screen / journey:** HS Flight Deck pace pill.
- **Evidence (CI):** `shared/high-school-projection.ts:362` compares school-confirmed credits only against the expected milestone. Credits awaiting a result (computed at `:431`) are excluded.
- **Consequence:** A student who submitted everything on time can be shown "behind plan" while the school grades. That is demotivating and can trigger needless Support questions.
- **Smallest effective fix:** Keep the calculation (it is honest). When confirmed plus awaiting would meet the target, show "On pace once pending results arrive" instead of "Behind".
- **Alternatives:** Count awaiting credits. Not recommended, because it blurs the credit tiers.
- **Benefit:** Fewer false alarms.
- **Risk:** Low.
- **Effort:** XS.
- **Confidence:** High.
- **Verification:** Unit test on `computePace` inputs.

### F16 — High-school wording on the bachelor's Flight Deck
- **Screen / journey:** Degree deck "Jalons Lumière", footers and pills.
- **Evidence:**
  - LS: the degree deck shows « Bilan de préparation au diplôme », « Clôture : relevé de notes et diplôme » and the school-access line (`evidence/ba-flight-deck-fr-1440.png`).
  - CA: fixed checkpoint keys in `shared/s27-contract.ts:129-139`; "school" vs "university" in `s27.ts` keys.
- **Consequence:** Mixed terms make it unclear who confirms credit: the school or the university.
- **Smallest effective fix:** A program-aware label variant for the 2 checkpoint labels and for "school" → "university".
- **Benefit:** Clearer authority.
- **Risk:** Low.
- **Effort:** S.
- **Confidence:** High.

### F17 — Degree graduation planning is thin
- **Screen / journey:** Degree deck, Roadmap, Beyond the Bachelor's.
- **Evidence (CA, consistent with HANDOFF-S28 §6 D):**
  - "Still open" credits ignore per-requirement gaps. The demo shows 9 open while residency needs 15.
  - No upper-level rule is shown anywhere.
  - Beyond computes the intake year from today because `finish` is null for degree-only students (`client/src/components/s27/beyond.tsx:46`, `beyond-model.ts:28-31`).
- **Consequence:** "Am I going to finish on time?" cannot be answered from the screens.
- **Smallest effective fix:**
  - Show the requirement shortfall beside "Still open", e.g. "Residency: 15 still needed".
  - Use the graduation-milestone date for Beyond.
- **Alternatives:** A full degree audit engine. Out of scope.
- **Benefit:** Honest remaining-work picture.
- **Risk:** Medium. Requirement data quality matters.
- **Effort:** S–M.
- **Confidence:** Medium.

### F18 — Requesting an appointment is hidden and labelled as a booking
- **Screen / journey:** "I need an appointment".
- **Evidence (CA, partly LS):**
  - Only orientation sessions can be requested, from "Au-delà du diplôme" (mobile: Plus → Au-delà, then pick a slot).
  - The button says « Réserver », but the result is a request.
  - Slots are fixed client-side times, not staff availability (`client/src/lib/s27/beyond-model.ts:78-93`).
  - Advisor meetings cannot be requested.
  - Staff-scheduled meetings do appear on `/calendar` (LS).
- **Consequence:** Students look in Calendar or Support. A "booked" slot can be declined.
- **Smallest effective fix:**
  - Rename the button to « Demander ce créneau » / "Request this time".
  - Add a "Request an appointment" link on `/calendar` that opens the same request (or a Support topic).
- **Alternatives:** Real scheduling (Calendly-style). Not justified at the current cohort size.
- **Benefit:** Findable and honest.
- **Risk:** Low.
- **Effort:** XS–S.
- **Confidence:** Medium.

### F19 — Sign-up errors appear as raw English server text
- **Screen / journey:** Invite → create account (FR).
- **Evidence (CA by two reviewers):** `client/src/lib/auth.tsx:165-172` and `components/auth/login-view.tsx:68-75` show the server message. The codes `INVITATION_INVALID` and `EMAIL_ALREADY_REGISTERED` are not mapped. "Email already registered" offers no sign-in or reset link.
- **Consequence:** A first-time French student's most stressful moment shows English errors.
- **Smallest effective fix:** Map the existing codes to EN/FR messages and add a "Sign in / Reset password" link for the duplicate-email case.
- **Benefit:** Smoother first login.
- **Risk:** None.
- **Effort:** XS.
- **Confidence:** Medium-High.
- **Verification:** LS with stubbed error codes.

### F20 — Notification texts are frozen in their creation language, and some point to the wrong place
- **Screen / journey:** `/notifications`, bell.
- **Evidence:**
  - CA: notifications store rendered text in one language at creation (`server/services/s29/outbox.ts:127`). Orientation-cancelled copy says to rebook "from your Flight Deck", but booking is in Beyond (`templates.ts:85-95`).
  - CI: the overdue-instalment copy points to an action Billing doesn't offer (see F05).
- **Consequence:** Language switching doesn't apply to older notifications, and two notifications send students to the wrong place.
- **Smallest effective fix:** Correct the 2 copy targets. Leave language-at-creation as is (acceptable; the student's language is server-synced).
- **Effort:** XS.
- **Confidence:** Medium.

### F21 — Notification badge contrast is too low
- **Screen / journey:** Header bell (every page).
- **Evidence (CA, computed from theme tokens):** `client/src/components/s29/core/notification-bell.tsx:19` puts `gold-ink` on `gold-fill`, at about 1.2–2.8:1 across the 8 themes. The alternative pair `gold-bright`/`gold-bright-ink` measures 6–12:1.
- **Consequence:** The unread count is hard to read, especially in dark mode.
- **Fix:** Swap the token pair.
- **Effort:** XS.
- **Confidence:** Medium-High.

### F22 — No contact route for a signed-out student
- **Screen / journey:** Login, "Besoin d'aide ?"
- **Evidence (LV):** « Besoin d'aide ? Contactez votre conseiller Lumière. » is plain text with no link (`evidence/live-login-fr-390.png`). The login page's controls are: EN, FR, Connexion, J'ai une invitation, show password, Se connecter, Mot de passe oublié.
- **Consequence:** A student locked out (expired invite, wrong email) has no way to reach Lumière from the portal.
- **Fix:** Make the line a link to the existing official WhatsApp contact (already public in the app).
- **Effort:** XS.
- **Confidence:** High.

### F23 — French-locale browsers get English on the first visit
- **Screen / journey:** First visit without an invite link (bookmark, reset-email link, typed URL).
- **Evidence:**
  - LV: browser contexts with `fr-CA` and `fr-FR` locales both rendered `lang=en` and "Sign in".
  - CI: there is no `navigator.language` detection in `client/src`. Invite links carry `?lang=` and the choice is then remembered (LV: it persisted across pages).
- **Consequence:** Minor, because the EN/FR switch is prominent. It still sends the wrong first signal to French families.
- **Fix:** If nothing is stored, default to French when `navigator.language` starts with `fr`.
- **Effort:** XS.
- **Confidence:** High.
- **Owner call:** Is English the intended default?

### F24 — Three names for Support in French, and three titles for the course page
- **Evidence:**
  - LS + CA: navigation says « Assistance », the page title and Billing link say « Soutien », and some HS copy says « Support ».
  - The course page is "Études secondaires" (nav), « Votre feuille de route » (eyebrow) and « Mon parcours au lycée » (details view).
  - French also mixes « lycée » and « secondaire », and « e-mail » and « courriel ».
- **Consequence:** Small but cumulative uncertainty ("is Soutien the same as Assistance?").
- **Fix:** Pick one term for each concept: Assistance, Études secondaires, courriel. Copy change only.
- **Effort:** XS.
- **Confidence:** High.

### F25 — The assistant's knowledge base is not filtered by program
- **Evidence (CA):** `searchKnowledge` has no audience filter (`server/services/academic-assistant/retrieval.ts:73`). The high-school transfer entry ("maximum of 15 transfer credits", keyword "residency") can answer a degree residency question. No degree residency or upper-level entries exist.
- **Consequence:** A bachelor's student can get high-school numbers that look plausible but are wrong for their program.
- **Fix:** Add an `audience` tag and filter on it, plus 3–4 degree entries.
- **Effort:** S.
- **Confidence:** Medium.

### F26 — No path from "I finished at the provider" to sending evidence
- **Evidence (CA):** The degree log sheet's "finished at the provider" choice gives no prompt or link to upload the Sophia or Study.com certificate. S30 provider-reported imports are staff-only.
- **Consequence:** The student does not know what moves credit from "waiting" to "earned".
- **Fix:** One line plus a link to Documents after that choice.
- **Effort:** XS.
- **Confidence:** Medium-High.

---

## Low

| ID | Screen | Evidence | Fix | Effort | Conf. |
|---|---|---|---|---|---|
| F27 | Phones, all pages | LS: the floating orb (52×52 at x16, y718) covers card text and links above the bottom nav on the deck, billing and roadmap (`evidence/hs-billing-fr-390.png`, `ba-roadmap-fr-390.png`). | Add bottom padding equal to the orb height to the last element, or dock the orb into the bottom bar on phones. Do not remove it (owner rule). | XS | High |
| F28 | FR formatting | LS: « Échéance : mer. 16 déc.. » (double period from abbreviated month plus key `s27.alert.due`); « dans 1 jours » / "in 1 days" (`s27.week.in`, no plural); « depuis le 1 oct. » (should be « 1er »). | Strip the trailing dot; use the existing plural helper. | XS | High |
| F29 | Screen-reader French | LS: the mobile "Plus" sheet exposes "Sidebar / Displays the mobile sidebar." in English. CA: shared `dialog`/`sheet` "Close", toast region and avatar `aria-label="Upload profile photo"` (`profile-avatar-upload.tsx:154`). | Pass translated labels. | XS | High |
| F30 | Notifications FR | CA: masculine participles with « pièce d'identité » (`server/services/s29/templates.ts:60-70`). | Copy fix. | XS | Medium |
| F31 | Graduation (HS) | CA: no "graduated" state on the Flight Deck; transcript request only in the details view. | Show the existing graduation banner on the deck when graduated. | XS | Medium |
| F32 | Mobile/PWA | LV: `/manifest.json` and `/sw.js` return the SPA HTML (no manifest); there is no `theme-color`; the viewport lacks `viewport-fit=cover`, so the existing safe-area CSS has no effect on notched iPhones. | Add `theme-color` and `viewport-fit=cover` only. See Roadmap for the PWA decision. | XS | High |
| F33 | Dead code | CA: `public/index.html`, root `index.html`, `pages/dashboard.tsx`, `dashboard-old.tsx`, `support-old.tsx`, `student-progress/roadmap-view.tsx`, `flight-deck-view.tsx`, `components/high-school/student-home.tsx` have no importers. | Remove in a cleanup pass. This lowers the risk that a future fix lands in dead code, as F12's link did. | S | Medium |
| F34 | Assistant | CA: record-fact answers carry `sources: []`, so the client appends "This answer is not based on a Lumière source" (`client/.../academic-assistant/logic.ts:260-262`). Correct system facts look unreliable. | Treat answers with record links as grounded. | XS | Medium |

---

## Checked — NO CHANGE

These were examined and found sound. Changing them is not recommended.

- **Login, invite tab, reset-password and resend-verification pages:** clean and bilingual, no overflow at 390/768/1440, light and dark. The wrong-credential error is translated and announced via `role=alert` (LV).
- **Unauthenticated deep links:** these redirect to login (LV). The 404 page is translated with a clear way back (LV).
- **Logging progress:** about 3 clicks, with score guidance, conflict handling and optimistic UI (covered by the existing S27 log-flow harness; code re-read).
- **Documents page:** shows the student-facing rejection reason and offers a replacement upload (LS). The staff `admin_notes` field never leaks (`document-presenter.ts`).
- **Support and WhatsApp:** clear and honest, one click from anywhere (LS, CA).
- **Calendar:** agenda on phones, translated item titles, iCalendar feed offered as https plus webcal (LS, CA).
- **Built-in guide labelling:** says plainly « cet assistant n'est pas une IA en direct » when local (LS).
- **Beyond the Diploma / Bachelor's:** truthful empty states, no invented universities (CA, LS).
- **Tap targets:** the bottom nav is 78×60 per item (LS); primary controls are at least 44px. Small hits were inline text links, which WCAG 2.5.8 exempts.
- **Text contrast:** passes in all 8 themes. Status is never shown by colour alone. Vouvoiement is consistent (3,395 FR values checked, CA).
- **Horizontal overflow:** none on any rendered student screen at 390/768/1440 (LS matrix).
- **Native app:** not justified (see Roadmap). No offline storage of student records.
