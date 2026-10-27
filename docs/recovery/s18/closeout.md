# S18 closeout: first-student Flight Deck, Support, Billing, French, document review

Branch `claude/s18-first-student-flight-deck`, base `e032afc` (S17). Not deployed. No production
database, auth or live-record changes. Migrations below are committed, not applied anywhere.

## Delivered

| Workstream | Result |
|---|---|
| A: academic projection | `shared/academic-projection-contract.ts` (`academic-projection/1`), pure `shared/academic-projection.ts` derived from `StudentHighSchoolView` (no second engine), `GET /api/student/academic-projection` (student role, own record, `studentId` params rejected). |
| B: Flight Deck | `/flight-deck` serves the High School Flight Deck to high-school-only students (`FlightDeckRouter`); `/high-school/flight-deck` for mixed students. S17 instruments on real data; verified-only vs including-planned never merged; honest not-configured state; provenance (school, plan version, template). |
| C: Support | `support-old.tsx` presentation restored on the S16 ticket backend through an allow-list adapter (counters, search/filter, inline expansion, detail modal with conversation and Details panel, attachments, create). |
| D: Billing | Portal-owned integer-cent ledger (obligation, discounts, installments, staff-confirmed receipts, evidence awaiting review). `GET /api/student/billing` (read-only, own record), staff/admin routes under `/api/admin/students/:id/billing`. Page: 4 summary cards, payment progress, Overview / Payment history / Upcoming payments. No gateway features. |
| E: French + documents | Dependency-free i18n (`client/src/i18n`), EN/FR toggle in the student header, persisted `lumiere_language`. Documents: `review_message` comes only from new `student_message`; `admin_notes` never reaches students. |

## Migrations (not applied)

- `supabase/migrations/20261030100000_s18_billing_ledger.sql`
- `supabase/migrations/20261030100100_s18_billing_audit_event_types.sql`
- `supabase/migrations/20261030110000_s18_document_student_message.sql` (guarded with `to_regclass`)

Deploy order: apply the document migration before deploying this code; reject / resubmit / verify write
`student_message`. Billing routes need the billing migrations.

## Evidence

`docs/recovery/s18-evidence/screens/` (LOCAL UI SIMULATION: vite + Playwright route interception, synthetic
fixtures). Flight Deck `hs-flight-deck-*` (1440/390, lumiere, dark, monaco, drawer, not-configured),
Support `support-*` (incl. Midnight Slate), Billing `billing-*` (incl. monaco and French at 1440/390).

## Known gaps

- Owner's original Support/Billing screenshots were not available in the runtime; Support follows
  `support-old.tsx`, Billing follows the documented layout. Owner visual comparison still required.
- French: navigation, shell and Billing translated. Flight Deck page body and Support body still English
  (`SUPPORT_TEXT` in `client/src/components/support/original-support-text.ts`; Flight Deck strings in
  `client/src/pages/high-school-flight-deck.tsx` / `components/os/academic-instruments.tsx`). French copy
  not yet reviewed by a native speaker.
- Billing: no staff UI (API only); no receipt correction/void, single-installment edit or discount removal.
- Document review: staff dialog `client/src/components/admin/document-review-dialog.tsx` exists but no staff
  page mounts it yet (no client page called reject/resubmit before S18).
- Support replies have no idempotency key (existing hook); creates do.
- Mixed HS + university students have no nav entry to `/high-school/flight-deck`.
- Academic projection HTTP tests use a stubbed service; the new service method has no direct DB test.
- Reserved `data-slot="academic-assistant"` on the Flight Deck header for the future Spark 1.3 text assistant.
