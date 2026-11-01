# Lumière Student Portal — Engineering Handoff (S30)

Read `docs/HANDOFF-S28.md` first: its ground rules, architecture, release process and owner preferences still apply.
This file records what S30 added and how it was released. When this file and the code disagree, the code wins.

## 1. Status at handoff

| Thing | Value |
|---|---|
| Live release | `31c3a1faac157a46ba2b22cce81bd4e2cc52de12` (`/health` → `release`), release marker commit `fd6e4cd` |
| Live URL | https://lumiere-student-portal-v-2.replit.app |
| Release branch (runner follows only this) | `claude/s26-owner-and-first-student-finish`, marker `release/S26_RELEASE_SHA` |
| S30 development branch | `claude/s30-ai-academic-integrations` (equal to the release head at handoff) |
| Integration lead for the S28/S29/S30 release | the S26 "themes" session, which merged and published every phase |
| Custom domain `lumiereportal.app` | still blocked (Replit ticket #585578): it serves an older landing page; not changed |

S30 shipped in three phases, each merged by the integration lead at a pinned SHA:

| Phase | Feature | S30 SHA pinned | Integrated as |
|---|---|---|---|
| A | Academic Calendar | `ea0fe60` | `ad00d7a` |
| B | Academic Data Import Center (+ security fixes `e4bbf07`) | `ae77759` | `dad0a4a` |
| C | Fleet AI Copilot extension (on S29's copilot, flag-off) | `f5627be` | `31c3a1f` |

**Ownership boundary (owner decision).** S29 owns the operational layer: events, exceptions/Needs Attention,
notification outbox and bell, Concierge, scheduler, diagnostics, Operations pages and the Fleet copilot core
(`server/services/s29/*`, `shared/s29-contract.ts`). S30 owns the calendar, the import center and the Fleet
extensions. S30 reaches S29 only through two ports (below). An earlier S30 operational layer was removed before
integration and exists only in branch history (`e66a1e9`); do not revive it.

## 2. Phase A — Academic Calendar

- **Read model, no copies:** `server/services/s30/calendar.ts` derives items live from agreement deadlines (language
  test, proof of prior schooling), Lumière checkpoints, orientation sessions, the published high-school plan (task due
  dates, planned course end, target completion) and degree-roadmap milestones, plus staff-scheduled `calendar_events`
  (advisor meetings, support sessions, checkpoints, deadlines). Changing a milestone changes the calendar on the next
  read; nothing is scheduled twice (unique index on scheduled kind + start per student).
- **Views:** `/admin/calendar` (admin + staff: all students, student filter, demo toggle, schedule / reschedule /
  cancel; orientation sessions use the admin-only S27 endpoint) and `/calendar` (student: own items only, staff-only
  events hidden). Month / week / agenda (agenda by default on phones). EN/FR module `client/src/i18n/modules/s30-calendar.ts`.
- **Time zones:** timed items are UTC instants shown in the viewer's zone; all-day items are dates and are never shifted.
- **iCalendar:** `.ics` download (staff and student) and revocable subscription feeds `/calendar/feed/<token>.ics`
  (256-bit token, only its SHA-256 stored, max 5 per user, owner role re-checked on every fetch, rate-limited).
  Privacy "minimal" (kinds + student code for staff) or "detailed". Integration hardening: feeds refuse archived
  accounts and are revoked on archive; detailed staff feeds are admin-only.
- **Reminders:** `server/services/s30/calendar-reminders.ts` decides what is due (deadlines 3 days before and on the
  day; appointments within 24 h; course milestones 2 days before, student only). Delivery is S29's: the calendar port
  (`calendar-port.ts`) is wired to S29's outbox by `server/services/s29/calendar-bridge.ts`, and S29's scheduler runs
  `dispatchCalendarReminders` every 15 minutes. Dedupe keys make re-runs harmless.
- **Tables:** `calendar_events`, `calendar_subscriptions` — `supabase/migrations/20261107100000_s30_academic_calendar.sql`,
  applied by `scripts/release/s30/apply-s30.sh` (runner step `schema_s30`).

## 3. Phase B — Academic Data Import Center

- **Workflow** (`/admin/imports`; `server/routes/s30-imports.ts`, `server/services/s30/imports/*`): upload → detect
  (by content) → map (EN/FR header suggestions, reusable saved mappings) → preview → validate → review differences
  (new / changed / unchanged / duplicate in file, previous → new) → approve (admin) → commit (admin) → audit;
  draft discard; rollback with a reason (admin, newest-first only).
- **Formats:** CSV (UTF-8; comma, semicolon or tab) and XLSX. PDFs and scans are refused with an explanation.
- **Academic integrity:** commits write only `academic_reported_records` with tier `provider_reported` or
  `institution_reported` (a database CHECK makes `verified` impossible). Completions and school-reported scores are
  flagged `needs_review`; credits in a file are informational. No official result, credit award or verified document
  is ever created; credit still goes only through the existing evidence-review flow. Staff see the reported-records
  panel on the student file (Roadmap / Plan tabs) and on the high-school / roadmap pages; admins mark records reviewed.
- **Safety:** students matched by student code only; formula-like cells refused; 5 MB / 2000 rows; XLSX parts are
  really inflated under a hard cap (10 MB per part, 25 MB total; integration additionally rebuilds a clean zip from the
  verified parts and requires local/central headers to match) and the workbook is streamed with a row cap; CSV over
  the cap is refused, never truncated; upload rate limit 10/min/user; commits and rollbacks serialised with an
  advisory lock; raw cells keep only mapped columns after validation and are cleared on commit / rollback / discard;
  the file itself is never stored (SHA-256 kept for provenance).
- **S29 integration:** `imports-port.ts` → `imports-bridge.ts` (S29 outbox, active admins only, templates
  `import.committed`, `import.review_required`, `import.rolled_back`); S29's attention rules read the import store
  (`import_verification` items, imported activity counts as progress). Wired once in `server/index.ts`.
- **Tables:** `academic_import_mappings`, `academic_import_batches`, `academic_import_rows`,
  `academic_reported_records` — `20261107110000_s30_academic_imports.sql`, applied by `apply-s30-imports.sh`.

## 4. Phase C — Fleet AI Copilot (extension of S29's copilot)

- S29's copilot (`server/services/s29/fleet.ts`, `POST /api/admin/s29/fleet/ask`, admin only, UI
  `client/src/components/s29/core/fleet-copilot.tsx`) is **off by default**: set `S29_FLEET_COPILOT=on` and
  `VITE_S29_FLEET_COPILOT=on` in production secrets to enable it (owner decision).
- S30 added the intents `deadlines_soon` (S30 calendar, ±14 days, planned dates labelled as such) and `behind_pace`
  (Control Center pace vs the plan's target date, overdue planned milestones; student-reported provenance) through
  `server/services/s30/fleet-context.ts`, two EN/FR preset questions, and Unicode-aware EN/FR intent rules (`\b` did
  not match before accented letters such as "échéance").
- **Privacy:** answers are deterministic from records with `[A#]` references and links; drafts are never sent. No
  student record is sent to the training-enabled Contributor model; the calendar/pace answers never call a provider
  (tests spy on outbound fetch). S29's aggregate-only AI narrative stays opt-in.

## 5. Settings and data

- **New secrets:** none required by S30. Optional: the S29 Fleet flags above.
- **Email:** reminders and notifications are delivered by S29's outbox; email needs `EMAIL_ENABLED=true`, `EMAIL_FROM`
  and `RESEND_API_KEY` (in-app notifications work without them; S29 diagnostics show the state).
- **Migrations (order):** S29 `20261106100000_s29_student_intelligence.sql` → S30 `20261107100000_s30_academic_calendar.sql`
  → S30 `20261107110000_s30_academic_imports.sql`. All additive and idempotent, RLS on, client privileges revoked;
  each has a guarded runner step (backup, row preservation, post-verify). Bootstrap manifest steps `10e`–`10g`.

## 6. Tests and evidence

- S30 suites: `tests/s30-units`, `s30-calendar-ui`, `s30-calendar-http` (real Postgres), `s30-imports-units`,
  `s30-imports-http` (real Postgres), `s30-imports-ui`, `s30-phase-b-fixes-units`, `s30-phase-b-fixes-http`
  (real Postgres), `s30-phase-c-units`, `s30-phase-c-http` (real Postgres). Last full suite on the S30 branch before
  integration: 3882 passed, 0 failed; the integration lead re-ran the gates for each phase.
- Visual harnesses (synthetic data, mocked API): `npx tsx scripts/s30/render-calendar-screens.ts <outDir>` (36 shots)
  and `npx tsx scripts/s30/render-import-screens.ts <outDir>` (14 shots): 390/768/1440, light/dark, EN/FR, 0 overflow.
- Independent security reviews: Phase A and Phase B/C were reviewed by the integration lead; findings were fixed
  (Phase B in `e4bbf07`, the rest during integration — see §2–§4).

## 7. Open items (genuine)

1. Custom domain `lumiereportal.app` still attached elsewhere (ticket #585578); when released, connect it, validate
   HTTPS, and update APP_URL and the Supabase auth redirect URLs, then verify login and password reset.
2. Fleet copilot is off: decide whether to enable it (and whether to allow the aggregate-only AI narrative).
3. Production email (`EMAIL_ENABLED` / `EMAIL_FROM` / `RESEND_API_KEY`) if reminders should also go by email.
4. Older Control Center queue titles and details are English-only server text (pre-S30 gap; FR UIs show kind labels).
5. No live provider integrations exist (by design: none were verified); imports are file-based.
