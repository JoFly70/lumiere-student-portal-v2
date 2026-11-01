# S31-A — Student Journey Matrix

## How these journeys were measured

- **Click counts** are the minimum taps or clicks from the starting point to completion, counting navigation, opening, choosing and submitting. Typing in a field counts as one step.
- **"Desktop / phone"**: on phones (390px), pages outside the bottom bar (Tableau de bord, Études secondaires or Votre feuille de route, Documents, Assistance, Plus) need one extra tap through « Plus » (LS: `journeys.json` → `J1-moreMenu`).
- **Times:**
  - Only live public-page load times were measured: 2.0–3.0 s to network-idle for the login, invite, reset and 404 pages at every width (LV, `live-results.json`).
  - The wrong-credential error was shown within the 5-second observation window. It was not timed more precisely.
  - No other time figures are claimed. Signed-in task times could not be measured live (see Evidence gaps).
- **Labels:** LV, LS, CI and CA as defined in `STUDENT-FINDINGS-REGISTER.md`.

## High-school student (native French)

| # | Task | Start | Steps (desktop / phone) | Completed? | Obstacles and confusion | Simpler alternative | Change justified? | Evidence |
|---|---|---|---|---|---|---|---|---|
| H1 | New student receives access, understands what to do first | Invitation email → `/login?invite=…&lang=fr` | About 12 actions to an account: invite tab prefilled, name, password, create, verify email, sign in. Then 0 clicks to the first task card. | Yes | French is honoured via `?lang=fr` (LV). Server sign-up errors arrive in English (F19). The designed welcome banner is never shown (F12). The 4 top cards (next task, document deadline, support window, language test) do say what is next, but two are half English (F08). | Mount the existing welcome banner; translate the deadline cards. | **Yes, small** (F08, F12, F19) | LV `live-login-invite-fr`, LS `hs-flight-deck-fr-1440.png`, CI |
| H2 | Find the next assigned academic task | Dashboard | 0 / 0 | Yes | The same task appears up to 3 times (card, "À suivre", "7 prochains jours"). Repetition is mild and arguably reassuring. | — | **NO CHANGE** | LS |
| H3 | Log progress on a task | Dashboard or Études secondaires | 3 / 3 (Noter → choose → save) | Yes | Good guidance below 65 %, and a conflict message when someone else changed the plan. | — | **NO CHANGE** | S27 harness `log-flow`, CI |
| H4 | Mandatory courses vs electives | Études secondaires | 1 / 1 | Yes | The credits card shows electives as « Cours optionnels 0/5 ». French uses three words for electives (CA). | — | Copy only (F24) | LS |
| H5 | Change an elective | Dashboard | 4–6 / 5–7: Études secondaires → « Plus de détails » → Mes matières → « Demander un changement » → reason → send | Yes, but hidden | The default page has **0** change controls; the details view has 6 (LS executed). The assistant says to use a button "on the course card" that isn't there. The ticket text is English. | Show the existing action on elective rows. | **Yes** (F11) | LS `journeys.json` J3, `j-hs-details-fr-1440.png` |
| H6 | Course deadlines and milestones | Dashboard / Calendar | 0 (dashboard) / 1–2 (Calendrier) | Yes | Calendar lists course milestones, deadlines and meetings, with agenda view on phones. | — | **NO CHANGE** | LS calendar renders |
| H7 | Falling behind | Dashboard | 0 | Partly | The pace pill counts confirmed credits only, so a student waiting on grades can see "behind" (F15). The guidance is text, with no next action. | Wording when pending results would cover the gap. | **Yes, small** (F15) | CI |
| H8 | Submit a document | Documents | 3–4 / 3–4 (tab → Téléverser → file) | Yes | Uploading from « Tous » files the document as a high-school transcript (F10). | Ask the type on « Tous ». | **Yes** (F10) | CI |
| H9 | Understand why a document was rejected | Notification or Documents | 1 / 1 | Yes on Documents; **No** in Library | Documents shows « Motif : … » with a replace button (LS true). Library shows "action required" with no reason (LS false). | Read the right field. | **Yes** (F09) | LS `journeys.json` J5 |
| H10 | Question about an assignment | Anywhere | Support: 5–6 (Assistance → Nouvelle demande → topic → subject → message → send). WhatsApp: 1–2. Assistant: 1–2. | Yes | Three routes is acceptable. Course cards have no "ask about this" (CA). | — | **NO CHANGE** (optional later) | CA, LS |
| H11 | Receives a reminder | Bell | 1 → item → 1 to target | Yes | Inbox and preferences work. Two notification texts point to the wrong place (F20). The unread badge has low contrast (F21). | Copy fixes. | **Yes, small** | LS, CA |
| H12 | Needs an appointment | Dashboard | Orientation: 4–5 / 5–6 via « Au-delà du diplôme ». Advisor meeting: Support ticket only. | Partly | Students look in Calendar. The button says « Réserver » but sends a request. | Rename the button; add a request link on Calendar. | **Yes, small** (F18) | CA, LS |
| H13 | Understand a billing obligation | Dashboard / Facturation | Read: 1 / 2. How to pay: not answered → Support (+5–6). | Read yes; pay **no** | No payment instructions. The proof link appears only when evidence is already awaiting. On a phone, the next or overdue instalment is not on the first screen of Facturation. | One "how to pay" block plus an always-visible proof link. | **Yes** (F05) | CI, LS `hs-billing-fr-390.png` |
| H14 | Forgot password | Login | About 5 (Mot de passe oublié → email → Envoyer → email link → new password) | Yes, UI verified up to the send step | The UI is clear and translated (LV). The reset email's language comes from Supabase templates (UV). | — | **NO CHANGE** | LV `forgot-fr-text.txt` |
| H15 | Contact Lumière | Signed in / signed out | Signed in: 1 (Assistance or WhatsApp in the sidebar). Signed out: **no route**. | Signed in yes / out **no** | The login page's "contact your advisor" line has no link. | Link to the existing WhatsApp contact. | **Yes, XS** (F22) | LV |
| H16 | Change language / theme | Header | Desktop 1 / phone 2 (avatar menu) | Yes | French-locale first visits default to English (F23). | Detect `fr` on first visit. | **Optional** (owner call) | LV, LS |
| H17 | After graduation | Dashboard | « Au-delà du diplôme » 1 / 2. Transcript request: about 3 via the details view. | Yes | No "graduated" state on the dashboard (F31). | Reuse the existing banner. | **Low** | CA |

## Bachelor's student

| # | Task | Start | Steps | Completed? | Obstacles and confusion | Change justified? | Evidence |
|---|---|---|---|---|---|---|---|
| B1 | First login and orientation | Dashboard | 0 | Yes | Same dashboard pattern as high school. No welcome (F12). The flight-path labels can overlap (F14). | Small (F12, F14) | LS `ba-flight-deck-fr-1440.png` |
| B2 | Credits earned vs planned vs open | Dashboard | 0 | Yes, with confusion | One number has two names on one screen (« Appliqués » / « Déjà acquis »). The knowledge base uses a third vocabulary (F07). | **Yes** (F07) | LS, CI |
| B3 | Transfer credits vs verified credit | Votre feuille de route | 1 | Partly | « Autres crédits à votre dossier 36,5 » is clear. The **Completed** header adds the student's own "finished at provider" credits (F04). | **Yes** (F04) | CI |
| B4 | Remaining requirements and graduation planning | Dashboard → credits card / Roadmap | 0–1 | Partly | "Still open" ignores the residency gap. No upper-level rule. "Cible de diplomation" is a plan milestone, not an estimate (F17). | Yes, small (F17) | CA, LS |
| B5 | Sophia / Study.com representation | Roadmap | 1 | Yes | Shown as « Sophia Learning 27 crédits · 12 déjà commencés » under « En cours ou prévus », which is correct. No prompt to send the provider certificate after finishing (F26). | Yes, XS (F26) | LS, CA |
| B6 | Ask the assistant "how many credits do I still need?" | Dashboard Ask card | 1 | **No (wrong kind of answer)** | No degree record exists, so the answer is a generic glossary (F03). "Où en sont mes crédits ?" gets a privacy refusal (F02). | **Yes** (F02, F03) | CI executed |
| B7 | Documents / Support / Calendar | Sidebar | Same as H8–H12 | Yes | High-school wording on the degree dashboard: « Bilan de préparation au diplôme », « Clôture : relevé de notes et diplôme » (F16). The "All" tab files as a high-school transcript (F10). The calendar has milestones only. | Yes, small | LS, CA |
| B8 | Beyond the Bachelor's | Sidebar | 1 / 2 | Yes | The title is correctly « Au-delà du baccalauréat » (LS). The intake year is computed from today (F17). | Small | LS, CA |

## Assistant question probe (CI, executed against the real server functions with synthetic records)

| Question | Privacy guard | Local intent → record used | Result for the student |
|---|---|---|---|
| How many credits do I still need? / Combien de crédits me faut-il encore ? | ok | Credits / Graduation | HS: record answer. Degree: glossary (F03). |
| What's most urgent? / Qu'est-ce qui est le plus urgent ? | ok | none | Generic knowledge-base answer (F13) |
| Am I on track? / Suis-je dans les temps ? | ok | none | Generic knowledge-base answer (F13) |
| Which documents do I owe? / Quels documents dois-je fournir ? | ok | Documents | Record answer |
| Where are my credits? / Où en sont mes crédits ? | **blocked (self_id)** | (Credits) | Privacy warning (F02) |
| What is my balance? | **blocked (self_id)** | (Billing) | Privacy warning (F02) |
| How much do I owe? | ok | **Documents** (wrong) | Wrong topic (F13) |
| Combien je dois payer ? | ok | Billing | Record answer |
| When is my next exam? | ok | Next tasks | Record answer |
| Quand est mon prochain examen ? | ok | **none** | Generic answer (F13) |
| Explique-moi ma feuille de route | **blocked (self_id)** | none | Privacy warning (F02) |
| Can you explain photosynthesis? / Pythagore | ok | none | Knowledge base or live model, depending on F01 |

## Effort summary (where change is justified)

| Journey | Today | After the smallest fix |
|---|---|---|
| Change an elective (H5) | 4–6 clicks, hidden | About 2 clicks, visible |
| Pay or prove payment (H13) | Support ticket (+5–6 steps, staff reply) | 0 extra (instructions on the page), 1–2 clicks to the proof upload |
| Rejection reason in Library (H9) | Not available | Visible |
| Contact while signed out (H15) | Impossible in the portal | 1 tap |
| Personal credit question to the assistant (B6) | Refusal or glossary | Deterministic record answer |
