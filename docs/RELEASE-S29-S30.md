# Combined release record: S29 + S30 + premium themes

Integration lead: the themes session. Released in three phases on 2026-11-01, each through the guarded release runner,
published once and verified live. See also `docs/HANDOFF-S30.md` (S30 detail) and `docs/HANDOFF-S28.md`.

| Phase | Release SHA | Contents | Schema (runner step) | Live acceptance |
|---|---|---|---|---|
| A | `ad00d7a` | S29 Needs Attention, Concierge (off by default), Notification Center (outbox, inbox, preferences), scheduler, Diagnostics; S30 Academic Calendar (month/week/agenda, reminders, iCalendar export, revocable feeds); 8 themes | `schema_s29` (6 tables), `schema_s30` (2 tables) | 60/61 required; the miss was a stale diagnostics count, fixed in B |
| B | `dad0a4a` | S30 Academic Data Import Center (upload, map, review, approve, commit, rollback; reported records only) | `schema_s30_imports` (4 tables) | 61/61 required |
| C | `31c3a1f` | Fleet copilot extended with deadline and pace answers (deterministic, flag off); import notifications to active admins; import items in Needs Attention; reported-records panel for staff | none | 61/61 required |

The one optional failure in every run, `browser.student.subjects-tab`, is an outdated check (see the S28 handoff).

## Gates per phase

- `tsc --noEmit` clean and the full Vitest suite green immediately before each marker move.
- One independent security review per phase. Fixed before release:
  - A: calendar feeds refused for archived accounts and revoked on archive; detailed staff feeds admin-only; Concierge
    ships off; support notifications resolve the student from the ticket reporter; same-site notification links.
  - B: newest-first rollback enforced; raw import cells pruned to mapped columns and cleared after commit, rollback
    and discard; XLSX parts inflated under a hard budget, local and central zip headers must agree, and the reader
    only sees a zip rebuilt from verified parts; CSV row cap counts non-empty rows.
  - C: no provider call on calendar or pace answers; import notifications only to active admins.
- One visual pass per phase at 390, 768 and 1440 px, light and dark (plus French spot checks); defects fixed before the
  marker moved.

## Production settings

- In use: `EMAIL_ENABLED`, `EMAIL_FROM`, `RESEND_API_KEY`, `APP_URL`.
- Optional, not set:
  - `S29_CRON_SECRET` (24+ characters) enables `POST /api/ops/scheduler/tick` with header `X-S29-Cron-Secret`.
    Jobs also run in-process while the site has traffic.
  - `REDIS_URL` makes `/ready` green.
- Flags, off by default:
  - `S29_FLEET_COPILOT` (server) and `VITE_S29_FLEET_COPILOT` (build) turn on the Fleet copilot.
  - `S29_SCHEDULER=off` is the emergency stop.

## Owner decisions still open

- Switch the Concierge on after reviewing the Needs Attention queue (no student reminder emails until then).
- Whether to enable the Fleet copilot.
- Needs Attention items other than imports link to the admin-only student file; staff are redirected.
