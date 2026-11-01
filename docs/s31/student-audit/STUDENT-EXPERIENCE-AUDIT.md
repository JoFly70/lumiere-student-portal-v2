# S31-A — Independent Student Experience Audit

**Baseline:** branch `claude/s31-a-student-experience-audit` at `8d0d4da`. Live `/health` reported release `31c3a1f…` on 2026-11-01.
**Scope:** the complete student side of the Lumière Student Portal, for a native-French high-school student and a bachelor's student.
**Method:** live browser testing of public surfaces, a local real-client simulation with synthetic data for signed-in surfaces, and code inspection. Three delegated code reviewers covered high-school journeys, degree journeys plus the assistant, and accessibility/bilingual/mobile. The lead re-checked every High finding.
**Mode:** audit only. No application code, data, configuration or deployment was changed.

Companion documents:
- `STUDENT-FINDINGS-REGISTER.md`: every finding, with IDs F01–F34.
- `STUDENT-JOURNEY-MATRIX.md`: task flows and clicks.
- `STUDENT-EXPERIENCE-ROADMAP.md`: KEEP / FIX / SIMPLIFY / REMOVE / CONSIDER / NO BUILD.
- `STUDENT-AUDIT-SUMMARY.md`: owner summary.

---

## 1. What was and was not possible

| Area | Coverage | Label |
|---|---|---|
| Public pages (login, invite, forgot password, resend verification, 404, signed-out redirects) | 8 pages × 1440/768/390, light + dark on key pages, EN + FR, one wrong-credential attempt with a non-existent `.invalid` address. No sign-up, reset email or invite redemption was submitted. | **LV** |
| Signed-in student screens, HS + bachelor's: Flight Deck, Études secondaires, Roadmap, Beyond, Calendar, Notifications, Library, Documents, Billing, Support, Profile, assistant panel | Real client code in Chromium; every `/api` call stubbed from synthetic repo fixtures (`tests/helpers/*`). 1440/768/390 × FR light, FR dark, EN light. **126 renders: 0 horizontal overflow, 0 page errors, 0 unstubbed calls.** Probes for overflow, tap targets, unnamed controls and English leaks (the 2 "unnamed" Profile links were collapsed rows with text, a false positive). Plus 5 scripted journeys (`evidence/journeys.json`). | **LS** |
| Assistant behaviour | The real `detectPii`, `answerFromRecord` and service ordering, executed on synthetic records. Provider behaviour was not exercised. | **CI** |
| Live signed-in behaviour | **Not possible.** No synthetic student credentials exist in this environment. The DEMO password is written only to a credential file in the production workspace (`scripts/s26/provision-demo-student.ts:78-83`), and View-as-student needs an admin session. Per the brief, no session was forged and no service-role key was used. | **UV** |

**Never presented as live:** everything labelled LS shows real UI code with synthetic data. Live data shapes, real roadmaps, real notification wording and AI provider answers remain unverified.

## 2. Overall verdict

The portal is **well built and largely calm, honest and bilingual**. It has a clear dashboard-first structure, a cautious credit vocabulary on most screens, real empty states, no horizontal overflow at any width tested, adequate tap targets, good text contrast and consistent vouvoiement.

The problems are not structural. They cluster in four places:
1. **The assistant answers worse than the screen it sits on.** A privacy guard pre-empts safe local answers (F02). It has no degree data (F03). Its suggested questions are unsupported (F13). Its live/local policy is ambiguous (F01).
2. **Credit-tier wording leaks in two places**, against the portal's own rule: the "Completed" header (F04) and the « Appliqués » / « Déjà acquis » duplication (F07).
3. **Three journeys stop one step short:** paying or proving payment (F05), changing an elective (F11), and seeing a rejection reason in Library (F09).
4. **French leaks at the edges:** the plan-not-ready and error states (F06), the agreement deadline cards (F08), sign-up errors (F19) and a few screen-reader labels (F29).

**A redesign is not warranted.** The highest-value changes are small, local fixes to existing screens.

## 3. Role-based evaluation

### 3.1 High-school student (native French)

**Strengths**
- **Dashboard:** answers "what next?" at zero clicks. Four cards cover the next task, a document deadline, the support window and the language test; then the radar, the journey and the credits (LS).
- **Progress logging:** 3 clicks, with retake guidance and conflict recovery.
- **Documents:** shows the student-facing reason and a replace button.
- **Support:** a ticket, the official WhatsApp contact and the guide are all within 1 click.
- **Mobile:** the bottom nav is well sized (78×60 per item). Agenda is the default calendar view on phones.

**Weaknesses**
- French gaps on the first screens: the deadline cards (F08), the plan-not-ready state (F06), English-default first visits (F23), and sign-up errors (F19).
- Billing has no "how to pay" (F05).
- Elective change is buried, and the assistant points to a missing button (F11).
- "Behind plan" can be a false alarm (F15).
- The designed welcome is orphaned (F12).
- Support has three French names (F24).

### 3.2 Bachelor's student

**Strengths**
- The same dashboard, correctly retitled « Votre vol vers le baccalauréat » and « Au-delà du baccalauréat ».
- « D'où viennent vos 120 crédits » is the best credit explanation in the product. It shows already earned / in progress or planned (Sophia Learning 27, 12 started) / still open, with the footnote that planned credit counts only once the university confirms it.
- The Roadmap page is clean on phones (LS `ba-roadmap-fr-390.png`).

**Weaknesses**
- The "Completed" header adds self-reported provider credit (F04).
- The same number is called « Appliqués » and « Déjà acquis » (F07).
- High-school checkpoint wording appears on the degree dashboard (F16).
- No graduation estimate, residency shortfall or upper-level rule (F17).
- The assistant cannot answer degree credit questions (F03).
- The knowledge base can return high-school numbers (F25).
- No prompt to send provider evidence after finishing (F26).

## 4. Page-by-page

| Page | Verdict | Key observations | Findings |
|---|---|---|---|
| Login / invite / reset (public) | **KEEP** | Premium and readable at all widths; translated errors announced with `role=alert`; EN/FR toggle prominent. The "contact your advisor" line is not a link. | F22, F23 |
| Flight Deck (HS) | **KEEP + FIX** | Strong "what next". Deadline cards are half English in FR. Pace can false-alarm. The task repeats 3 times (acceptable). | F08, F12, F15 |
| Flight Deck (degree) | **KEEP + FIX** | Same structure. Label collision on the flight path, two credit vocabularies, high-school checkpoint wording. | F07, F14, F16 |
| Études secondaires (log-first roadmap) | **KEEP + FIX** | Fast logging. No elective change on the default view. Three titles for one concept. | F11, F24 |
| Votre feuille de route (degree) | **KEEP + FIX** | Clear credit source bar. The Completed header mixes tiers. | F04, F26 |
| Details view (`?view=details`) | **SIMPLIFY (later)** | Holds functions missing from the default view: elective change, graduation, transcript. Once those move, it can retire. | F11, F31 |
| Au-delà du diplôme / baccalauréat | **KEEP + small FIX** | Truthful. Appointment requests live here and are labelled as booking. The degree intake year is computed from today. It is the longest student page: about 12 viewport heights on a phone (LS). That is acceptable for an occasional "explore" page, so no change unless the appointment request moves (F18). | F17, F18 |
| Calendrier | **KEEP** | Clean month/week/agenda, translated titles, iCal feed. Add a "request an appointment" link only. | F18 |
| Notifications | **KEEP + copy FIX** | Inbox and preferences are good. Two wrong targets; badge contrast. | F20, F21, F30 |
| Bibliothèque | **FIX** | Never shows the rejection reason. Otherwise duplicates Documents with versions. Keep for now. | F09 |
| Documents | **KEEP + FIX** | Reason and replace are good. The "All" tab mis-files. | F10 |
| Facturation | **FIX** | Clear balance and receipts, but no payment instructions, a conditional proof link, and the next or overdue amount is below the fold on phones. | F05 |
| Assistance (Support) + WhatsApp | **KEEP** | Clear. Keep both routes. | F24 (naming) |
| Profil | **KEEP + FIX** | Long: about 5.4 viewport heights on desktop and 11.3 on a phone (LS). It is a rarely visited record page, so the layout is NO CHANGE. The readiness checklist labels are English on the French page, and the avatar control has an English aria-label. | F08, F29 |
| Assistant (orb + Ask card) | **FIX (B)** | See §5. | F01–F03, F13, F25, F34 |
| States: plan not ready / load error | **FIX** | English only. | F06 |

## 5. Academic Assistant evaluation

**What exists (CI):**
- A floating orb on every student page and an "Ask Lumière" card on the dashboard.
- Bilingual conversations with saved history (`/api/assistant/conversations`).
- Attachments, stored to Documents and keyword-indexed (not read by the model).
- Labelled answers: "From your record (system facts, not AI)" for deterministic record answers, and a curated knowledge base with sources.
- A live model path (minor-safe prompt, records cited `[S#]`, monthly budget with fail-closed reservation, provider failures falling back to local with a notice).
- An over-inclusive PII guard.
- Escalation text to Support when an answer is not source-grounded.
- In local mode the panel says plainly « cet assistant n'est pas une IA en direct » (LS).

**What fails:** F01 (policy ambiguity), F02 (refusals), F03 (no degree data), F13 (chips unsupported, misroutes), F25 (no program filter), F34 (correct facts labelled "not based on a source"). Live-mode quality, French fluency of live answers, and budget-exhaustion behaviour in production are **UV**.

**Strategy comparison**

| Strategy | Value | Cost and risk | Verdict |
|---|---|---|---|
| A. Keep unchanged | None | Students keep getting refusals and glossary answers to the questions the UI suggests; degree students get nothing personal. | **Reject** |
| B. Improve the existing assistant: fix ordering (F02), add a degree record (F03), complete the chip intents (F13), program-filter the knowledge base (F25), mark record answers as grounded (F34) | Directly fixes the observed failures. Fully deterministic and local; no new data egress; works whether or not live mode is on. | About 1–2 days. Low risk. | **Recommend** |
| C. New tutoring functionality (practice questions, explanations by subject, tutoring sessions) | Unproven. The data shows the assistant's current failures are retrieval and routing, not missing pedagogy. HS students may be minors. Academic-integrity rules forbid doing graded work. The provider tier may train on inputs. | New policy, prompt, evaluation and support surface. | **Do not build now.** Revisit only for adult degree students, behind its own flag, after B ships and F01 is decided. |

"Better explanations and practice prompts" (part of B as written in the brief) is **not** recommended yet. There is no evidence that students lack explanations, as opposed to lacking correct answers about their own record.

## 6. Mobile and PWA

**Observed:**
- The mobile browser experience is good. No overflow at 390px. The bottom bar holds the 4 most-used destinations, everything else is under « Plus » (one extra tap), and the targets are large.
- Document upload uses a standard file input with no `capture` attribute, so phones offer both camera and files (CA).
- External links use `rel="noopener noreferrer"` (CA).
- The calendar offers https and webcal subscription (CA).
- Two real phone problems: the orb covers text (F27), and the billing first screen hides the amount due (F05).

**PWA assessment:**
- **Launch convenience:** a home-screen bookmark already works (an apple-touch-icon exists, LV). A manifest would add standalone launch and a nicer icon on Android.
- **Authentication:** Supabase sessions persist in localStorage either way; a PWA adds nothing. Standalone mode on iOS isolates storage, which can force a second sign-in. That is a small regression risk.
- **Notifications:** web push would need a service worker, a permissions UX and an iOS home-screen install. The S29 inbox and email outbox already cover reminders.
- **Offline:** no compelling need; must not cache student records.
- **Verdict:** a full PWA is **NO BUILD now**. Do the two zero-risk meta fixes (`theme-color`, `viewport-fit=cover`, F32). A manifest with 192/512 icons is optional and harmless if the owner wants the "Add to Home Screen" icon. **No service worker, no offline data, no native app.**

## 7. Accessibility and bilingual summary

**Strong (CA, LS):**
- Skip link, landmarks and one h1 per page.
- Focus trap in the assistant dialog.
- Profile and auth forms wire `aria-invalid`/`aria-describedby`.
- Reduced motion is respected.
- Text contrast passes in all 8 themes.
- Consistent vouvoiement across 3,395 French strings.

**Gaps:**
- Badge contrast (F21).
- English screen-reader strings in shared components (F29).
- No per-route `document.title` or route-change announcement (CA; Low, kept off the register as polish).
- Field borders at about 2.2–2.7:1, below the 3:1 non-text minimum (CA; Low).
- French inconsistency (F24).
- Locale formatting quirks (F28).

## 8. Adversarial review of proposals

Every recommendation in the roadmap was tested against the brief's questions. Excerpts:
- **Is it observable?** Every High finding is reproduced in code or the browser, or executed. The aesthetic-only items (F14, F27) are Medium/Low and fixed in place.
- **Does it reduce steps?** Yes for F05, F11, F22, F02 and F03. Each fix either adds no new navigation or removes steps; no new menu item is proposed.
- **Can the existing screen be improved instead?** Every fix reuses an existing component: WelcomeBanner, the elective dialog, `review_message`, i18n keys, the WhatsApp contact and the existing glossary.
- **French speakers?** Several fixes exist specifically for French students (F06, F08, F19, F23, F24).
- **Both populations?** F02, F05, F06, F09, F10 and F12 help both. F03, F04, F07, F16 and F17 are degree-only. F11 and F15 are high-school only.
- **What if we do nothing?** The portal still works. The costs are Support tickets for payment and elective questions, eroded trust in the assistant, a credit-tier misreading risk on the degree roadmap, and English first impressions for the first real student.

## 9. Evidence index

Committed screenshots are in `evidence/`. All are synthetic (LS) or public live pages (LV). None contain real student data or credentials. See `evidence/README.md`.
