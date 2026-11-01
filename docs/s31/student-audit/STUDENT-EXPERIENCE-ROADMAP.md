# S31-A — Student Experience Roadmap

Ordered by value ÷ effort within each group. Every item references a finding in `STUDENT-FINDINGS-REGISTER.md`.
**Nothing here adds a new page, menu item or product.**
Suggested batching: one "S31-B student fixes" release containing the FIX items marked ★, under the existing release gates.

## KEEP (working well — protect from redesign)

| Item | Why |
|---|---|
| Dashboard-first Flight Deck (HS and degree) | Answers "what next?" in 0 clicks; one shared design for both programs. |
| Log-first course page and the 3-click progress log | Fast, with guidance and conflict recovery. |
| « D'où viennent vos 120 crédits » source bar | The clearest earned / planned / open explanation in the product. Use its vocabulary everywhere (F07). |
| Documents rejection reason + replace button | Correct, safe (never leaks staff notes). |
| Support ticket + official WhatsApp + guide | Three clear routes. Do not merge them. |
| Calendar (agenda on phones, iCal feed) | Complete for the student need. |
| Notification inbox + preferences | Works. Fix copy only. |
| Login / invite / reset pages | Premium and clear at every width. |
| Built-in guide labelling ("not live AI") | Honest. Keep it whatever the live decision is. |
| Truthful empty states (Beyond, plan not ready) | No invented content. Translate them (F06). |
| Bottom bar on phones (4 destinations + Plus) | Right size, right items. |

## FIX (small, evidence-backed)

| ★ | Fix | Finding | Effort | Population |
|---|---|---|---|---|
| ★ | **Decide and document the student live-AI policy**: check `/api/assistant/status` as a DEMO student and align `.replit` and the handoff. If live stays on, drop ticket subjects and billing from the live prompt. | F01 | XS–S | All |
| ★ | Assistant: run the local record answer before the privacy refusal (keep blocking provider egress) | F02 | XS | All |
| ★ | Assistant: add a degree-credits record using the deck's wording | F03 | S | Degree |
| ★ | Assistant: intents for "urgent" and "on track"; "owe money" → Billing; « prochain examen » | F13 | XS | All |
| ★ | Completed header counts only university-accepted credit (+ "N waiting") | F04 | XS | Degree |
| ★ | Billing: owner-approved "how to pay" block, an always-visible "send proof of payment" link, and the next/overdue line at the top | F05 | S | HS + billed degree |
| ★ | Translate `PlanNotReady` / `ProgressError`; stop appending raw error text | F06 | XS | All |
| ★ | Translate agreement deadline cards and profile readiness labels from their `key` | F08 | XS–S | All |
| ★ | Library reads `review_message` | F09 | XS | All |
| ★ | Documents "All" tab asks the type (or files as `other`) | F10 | XS | All |
| ★ | Show the existing "Request a change" on elective rows of the default course page; correct the assistant copy; translate the ticket text | F11 | S | HS |
| ★ | Mount the existing WelcomeBanner on the dashboard | F12 | XS | All |
| ★ | Login "contact your advisor" → link to the official WhatsApp | F22 | XS | All |
| | Map sign-up error codes to EN/FR; add a sign-in/reset link on duplicate email | F19 | XS | All |
| | Pace pill: "On pace once pending results arrive" instead of "Behind" | F15 | XS | HS |
| | Program-aware checkpoint labels; "school" → "university" on the degree dashboard | F16 | S | Degree |
| | Fix 2 notification targets; French participle agreement | F20, F30 | XS | All |
| | Badge contrast token swap | F21 | XS | All |
| | Knowledge-base audience tag + 3–4 degree entries | F25 | S | Degree |
| | "Finished at provider" → link to upload the certificate | F26 | XS | Degree |
| | Mark record-fact answers as grounded | F34 | XS | All |
| | Flight-path label fallback (drop the colliding name; the legend keeps it) | F14 | S | All |
| | Orb clearance on phones | F27 | XS | All |
| | French formatting: double period, plurals, « 1er » | F28 | XS | FR |
| | Screen-reader strings in shared components; avatar label | F29 | XS | FR |
| | Graduation: residency/requirement shortfall beside "Still open"; Beyond uses the graduation-milestone year | F17 | S–M | Degree |
| | `theme-color` + `viewport-fit=cover` meta | F32 | XS | All (phones) |

## SIMPLIFY

| Item | Finding | Notes |
|---|---|---|
| One credit vocabulary: **Acquis / Prévus / Encore ouverts** (Earned / Planned / Still open) across the dashboard, roadmap and assistant knowledge base | F07 | Copy only. Removes « Appliqués » and the knowledge base's Official/Reported wording from student views. |
| One French term each: **Assistance**, **Études secondaires**, **courriel** | F24 | Copy only. |
| Rename « Réserver » → « Demander ce créneau »; add "Request an appointment" on Calendar, pointing to the existing request | F18 | No scheduling system. |
| Once elective change, graduation and transcript request live on the default course page, retire the `?view=details` page | F11, F31 | Removes a second, older view of the same data. Do it after F11, not before. |

## REMOVE

| Item | Why |
|---|---|
| Dead student code: `components/high-school/student-home.tsx`, `pages/dashboard.tsx`, `dashboard-old.tsx`, `support-old.tsx`, `student-progress/roadmap-view.tsx`, `flight-deck-view.tsx`, `flight-deck-charts.tsx`, `public/index.html`, root `index.html` | No importers (CA, F33). They already caused one orphaned feature (F12). Remove in a separate cleanup commit with the full test suite. |
| `/high-school/flight-deck?view=credits` legacy cockpit | Only reachable through dead code. Remove after the WelcomeBanner moves (F12). |

## CONSIDER BUILDING (only after the FIX batch, and only with a trigger)

| Idea | Trigger that would justify it |
|---|---|
| Web app manifest + 192/512 icons ("Add to Home Screen") | The owner wants an app icon on Android/iOS home screens. Harmless; no service worker. |
| French as the default language when the browser is French | Owner confirms the default should follow the browser (F23). |
| Live AI for **adult degree students only**, behind its own flag | After F01 is decided and F02/F03/F13 ship, if logged unanswered questions show a need. |
| Read-only "Lumière has seen a provider result" line for S30 imports | If students ask Support why imported Sophia/Study.com results don't show. |
| "Ask about this" on course cards (prefilled Support topic) | If Support tickets show students struggle to say which course they mean. |

## NO BUILD

| Proposal | Why not |
|---|---|
| New AI tutor / practice-question generator (strategy C) | The current failures are routing and data, not pedagogy. Minors, academic integrity and a training-enabled provider tier make it costly to do safely. |
| Native mobile apps | The mobile web experience is good; no capability gap was found that needs native. |
| Service worker, offline mode, offline student records | No verified requirement; privacy risk. |
| Web push notifications | The inbox and email outbox already cover reminders. iOS needs an install. It adds permissions UX and support load. |
| Real-time appointment scheduling | One-person staff and fixed orientation sessions. The rename plus a Calendar link closes the gap. |
| New onboarding tour | The existing WelcomeBanner plus the dashboard cards are enough (F12). |
| Dashboard redesign or new navigation | Structure is sound; the problems are local. |
| Online payments now | A larger project (handoff §6 C). F05's instructions solve the observed confusion first. |
