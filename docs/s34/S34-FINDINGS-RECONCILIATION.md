# S34 — Findings reconciliation (S33 → S34)

Every finding was re-checked on the S34 baseline `81256aa`, and all ten were still present.

| ID | Sev | S34 status | Evidence | Open operational requirement |
|---|---|---|---|---|
| S33-01 Private appendix reaches the provider | P1 | **FIXED** | Baseline reproduction (`evidence/s34-baseline-repro.output.txt`: `contains private appendix: true`). `tests/s34-assistant-private-history.test.ts`: 13 tests, full outgoing body captured; 7 fail when the fix is reverted. Real-Postgres `s21-conversations-db` window test. | Keep `SPARK_ASSISTANT_STUDENT_POLICY` ≠ `minor_safe_v1` until S34 is live and accepted. |
| S33-02 Rate limits / 429 handling | P1 | **FIXED** | `tests/s34-rate-limit.test.ts` (21), `tests/s34-review-fixes.test.ts`, browser check `evidence/s34-check.json`. | Verify `REDIS_URL` and the real client IP on Replit (U3/U4). |
| S33-03 Live AI provider failure | P1 | **CONFIGURATION (owner)** | Synthetic probe: HTTP 402 `billing_not_configured` from `api.meta.ai` for the pinned model. Not a code defect. | Owner resolves Meta developer billing, then re-runs hosted acceptance. |
| S33-04 General question → own record (local) | P2 | **FIXED** | Baseline reproduction (`grounded=record` for « Qu'est-ce qu'un crédit ? »). `tests/s34-assistant-local-general.test.ts`, EN and FR. | — |
| S33-05 Transcript request has no alert | P2 | **FIXED** | `tests/s34-transcript-alert.test.ts` (5), `tests/s34-transcript-alert-db.test.ts` (real Postgres). | — |
| S33-06 Legacy student-writable endpoints | P2 | **FIXED** | `tests/s34-legacy-endpoints.test.ts` (13). Consumer check: no routed page imports the legacy dialogs. | — |
| S33-07 Caught errors not in Sentry | P2 | **FIXED** | `tests/s34-monitoring.test.ts` (6), `tests/s34-review-fixes.test.ts` (no 4xx or duplicate reports, e-mails masked). | Sentry DSN presence in production not verified. |
| S33-08 French assistant formatting | P2 | **FIXED** | `tests/s34-french-record-format.test.ts`. Two existing assertions updated to the readable date format. | English billing due date still ISO (cosmetic). |
| S33-09 Backup / restore runbook | P2 | **FIXED (documentation)**; verification is **OWNER** | `docs/s34/S34-BACKUP-RESTORE-RUNBOOK.md`. | Owner records backup and PITR status (10-minute checklist in the runbook). |
| S33-10 Preferred name vs legal name | P2 | **FIXED** | `tests/s34-preferred-name.test.ts`. | — |

**Totals:** 8 fixed in code, 1 fixed as documentation (it still needs owner verification), 1 configuration item for the owner (S33-03), 0 already fixed before S34, 0 deferred.

**Excluded as instructed:** the S33 deferred and no-change items D1–D12.

## Independent review (S34)

A fresh reviewer read the full diff. It found no blockers and confirmed that no path sends private data to the provider. Two should-fix items and one nit were found and fixed:
1. A rate-limit store error was answered as 401 "expired session". It is now 503 and still fails closed.
2. Sentry reported duplicates and 4xx noise, and did not mask e-mails. Fixed.
3. Nit: the transcript item's age was reset by other graduation edits. Fixed.

Two nits were left as they are:
- the English billing date;
- "an expired token whose refresh returns 400 is retried every 30 s". This cannot happen in practice:
  - the server returns 400 only when no refresh token is sent, and the client treats a missing token as a sign-out before it ever sends a request;
  - an invalid or revoked token returns 401, which signs the user out.
