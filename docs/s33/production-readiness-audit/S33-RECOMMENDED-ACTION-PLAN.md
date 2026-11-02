# S33: Recommended Action Plan

## A. Fix immediately (only where necessary)

| Item | Who | Action | Effort |
|---|---|---|---|
| S33-01 interim | Owner | Leave `student` out of `SPARK_ASSISTANT_LIVE_ROLES` until the S33-01 code fix ships. This is a configuration change only, with no code. | 5 min |
| S33-03 | Owner | Check the AI provider account: API key, credits and quota, and the production log for the provider's error. Then re-run the S26 hosted acceptance so the S32.1 release is formally accepted. | 30–60 min |
| S33-09 (verification) | Owner | Confirm that Supabase backups and point-in-time recovery are enabled. | 10 min |

No code change has to happen before the first student continues to use the Portal.

## B. One small maintenance release (a single batch)

**Priority order.** S33-01 and S33-02 come first and are each independently shippable. The rest is optional within the same release.

| Order | Finding | Minimal change | Effort | Regression test |
|---|---|---|---|---|
| 1 | S33-01 | Remove the private-records appendix from provider-visible history: strip from the `PRIVATE_T` head onward in `providerSafeHistory`, or store it separately. | 1–2 h | Next-turn provider body contains no appendix text (EN/FR). |
| 2 | S33-02 | Key the `api` and `admin` limiters by user id, falling back to IP, and raise them. Give `/api/auth/refresh` its own limiter. Remove the duplicate `apiRateLimit` mount. Show a translated 429 message in `queryClient.ts` and `api.ts`. | ~4 h | Limiter wiring test; 429 UI message test (EN/FR). |
| 3 | S33-10 | The welcome endpoint returns `preferred_name \|\| first_name`. | <1 h | Welcome route test with a preferred name. |
| 4 | S33-04 | Apply `isPersonalQuestion` in local mode as well. | <1 h | Local-mode general question gets a knowledge-base answer (EN/FR). |
| 5 | S33-05 | Add a Needs Attention rule `transcript_requested`, linking to the HS graduation section. | ~2 h | Rule unit test. |
| 6 | S33-08 | French date and plural helpers in the assistant record text. | 1–2 h | Snapshot of a French record answer. |
| 7 | S33-06 | Refuse students on `/api/assignments` and `/api/generate-plan`; drop `details` from the 500 response; require auth on `/api/system/check`. Alternatively, delete these legacy routes. | ~1 h | Route returns 403 for the student role. |
| 8 | S33-07 | Forward `logger.error` to Sentry (redacted). | ~1 h | Logger unit test with a Sentry stub. |
| 9 | S33-09 | One-page restore runbook. | ~1–2 h | — |

**Total.**
- About 1 day for items 1–2.
- About 1.5–2 days for the whole batch.

This is a maintenance release, not a new engineering session. It has no schema migration and no new feature.

## C. Defer until real usage justifies it

These items are listed as D1–D6 and D9 in the Findings Register:
- elective title markers;
- legacy English-only views;
- the privacy notice that sticks after a flagged message;
- the error message on a double-clicked payment-proof confirmation;
- `/health` detail;
- the unused upload limiter;
- optional prospect fields.

Revisit any of these only after a real complaint or an incident.

## D. Do not build or redesign

- Do not merge the Student File and the Advanced Workspace.
- No enrollment wizard. The derived enrollment status and the "ready to link" item are enough.
- No administrator email for "ready to link". The queue item already escalates.
- No PWA, native app, push notifications or offline mode.
- No Stripe, online payments or bank reconciliation for the pilot. Do not invent payment details. The support fallback is adequate.
- No additional chatbot or AI feature.
- Do not move the assistant orb.
- No restriction of staff billing permissions. That is an intended policy.
- No merging with PowerED or ClientDesk.
