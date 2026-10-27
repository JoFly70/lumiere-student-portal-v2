# S19 closeout: premium visual excellence, flagship login, ClientDesk theme parity, academic cockpit

Branch `claude/s19-premium-visual-excellence`, base `e63b83a` (S18). Development only: not deployed, not merged,
no production database, credentials or student records used. All screenshots are LOCAL UI SIMULATIONS
(vite + Playwright, `/api` stubbed with synthetic fixtures, external hosts blocked).

Result: **PASS WITH GAPS** (gaps below; the owner's original screenshot ZIP was not available to this session).

## Delivered (one Opus lead, five Sonnet agents, exclusive file ownership)

| Stream | Result |
|---|---|
| A: themes + crest | `scripts/s19/gen-portal-themes.py` holds ClientDesk's nine palettes verbatim and generates `client/src/styles/themes.css` (role map, `--check`, `--audit`). Default Lumière Desk now maps from ClientDesk too. Independently spot-checked: canvas, panel, panel-3, text, muted, gold, gold-ink, rail bg/active, red, green, line equal ClientDesk in all 9 packs. Real crest (alpha crop, aspect 0.973, webp 96/192/480, favicon, navy apple-touch icon) via `@/components/brand/lumiere-brand` (`LumiereCrest`, `LumiereWordmark`, `BRAND`); Cormorant Garamond `font-display`. Keyboard theme picker. `docs/recovery/s19/theme-parity.md`. |
| B: login | Full replacement of login, reset-password, verify-email: navy/gold editorial brand panel with crest, architectural SVG line-work, themed form side, EN/FR switch, mobile band + overlapping card. Sign-in, invitation-only signup, `?invite=` prefill, role redirects, ids, autocomplete, request bodies unchanged. Invented `support@lumiere.edu` removed. |
| C: cockpit | High-school Flight Deck recomposed as a one-page cockpit: greeting/standing/next item strip, official-credit arc (totals from projection config), core/elective coverage, next milestone, top 3 actions, pulse row (documents, support, payments via existing hooks with honest "not set up"/"unavailable"), subject areas + drawer, in-progress, awaiting confirmation, provenance footer. Mobile: hero, actions, status first; secondary sections collapsed. University deck untouched. |
| D: French + Support | Support Center, Documents, shared errors/dialogs localised; Intl dates/sizes/currency; French spacing applied centrally; EN/FR key-parity test. Support structure preserved (4 counters, search/filter, expanding cards, detail modal + metadata panel, attachments). Reply idempotency: `Idempotency-Key` header, replay returns the existing comment with no insert/audit/notification, 23505 race re-selects, safe fallback before the migration. |
| E: staff ops | `/admin/students/:studentId/billing` (admin + staff): agreed price, discounts (remove = void), schedule replace + per-installment edit, record payment, evidence review (confirm/reject), receipt void with required reason; voids never delete, excluded from totals, audited; one evidence item backs at most one receipt (concurrent confirm: one 200, one 409). Integer-cent string parsing. Document review dialog mounted in the student workspace with separate student-facing reason and internal note. |
| Opus | i18n module seams, route wiring, High School Flight Deck nav entry for mixed-program students (S18 gap), calmer login line-work, French/English plural-safe cockpit copy, subject-drawer date formatting, reviews, commits. |

## Migrations: release order (apply all before deploying this code)

1. `20261030100000_s18_billing_ledger.sql`
2. `20261030100100_s18_billing_audit_event_types.sql`
3. `20261030110000_s18_document_student_message.sql`
4. `20261031100000_s19_ticket_comment_idempotency.sql`
5. `20261031110000_s19_billing_corrections.sql`

Verified by `npx tsx scripts/s19/verify-s18-migrations.ts` on a disposable local Postgres 16 (created and removed by the
script): 18/18 checks pass, every file applied twice, legacy rows survive, RLS intact. Re-run independently by Opus: pass.
Details: `docs/recovery/s19/migration-verification.md`. Nothing applied to any hosted database.

## Verification

- Baseline before S19 (`0af1cc9`, full suite, isolated worktree): 131 files passed, 8 skipped, 0 failed.
- Final targeted run (s17/s18/s19 + login routing, navigation, recovery, support routes/client): 26 files, 359 tests, all pass.
- `tsc --noEmit`: 0 errors. ESLint on all S19-changed files: 0 errors (warnings are existing `any` usage).
- `npm run build`: passes; production bundle contains no prototype/"synthetic data" strings.

## Gaps

- Owner's original Support/Billing screenshot ZIP was not attached: no side-by-side against the originals. Support was
  compared with `support-old.tsx` and S18 evidence; Billing structure unchanged. Owner visual acceptance still required.
- Screenshots render a serif fallback: Google Fonts is blocked in the render sandbox (Cormorant loads in production).
- Pre-existing, preserved: `verify-email` shows success client-side after any hash token; `/resend-verification` link has no route.
- French: server-originated text (next-action messages, API errors), course/subject data, the staff Support desk, staff
  billing UI and most Profile sections remain English. Native-speaker review still pending.
- Staff-role users reach staff billing by URL only; the student workspace (which links to it) is admin-only on the server.
- Voiding a receipt created from evidence leaves that evidence "confirmed"; the student must upload new proof.
- Cockpit rendered in Lumière Desk, Monaco Navy and Lumière Dark only; other packs covered by token use and the contrast audit.
- `client/index.html` still loads the third-party Chatbase "Lumiere AI Advisor" widget (pre-existing). It is a live
  external AI chat unrelated to the planned Spark 1.3 assistant; the owner should decide whether it stays before launch,
  given student-data handling. The cockpit keeps a hidden, non-interactive `data-slot="academic-assistant"`.
- Old S17/S18 instrument components (`components/os/academic-instruments.tsx`, `credit-gauge.tsx`, `subject-sheet.tsx`) are now unused.

## Evidence

`docs/recovery/s19-evidence/screens/`: `login-*` (8), `cockpit-*` (8), `support-*` (5), `theme-*` (4), `brand-*` (2),
`staff-billing-*` (2).

## Next milestone

Owner visual acceptance on this branch (with the original screenshot ZIP), then a hosted staging rehearsal: apply the five
migrations in order to a non-production project, deploy this branch there, and run the first-student journey with a test
account (login, cockpit, document upload/review, support reply, billing setup and payment confirmation). Then production
release on owner approval. After launch: the Spark 1.3 assistant behind a server-side provider route (no key in the
client), English/French, general guidance only, mounted in the reserved cockpit slot.
