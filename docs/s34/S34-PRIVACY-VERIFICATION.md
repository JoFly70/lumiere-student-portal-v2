# S34 — Privacy verification (S33-01)

**Finding:** The student-only "From your records (private, not sent to any AI model)" section was stored inside the assistant message and then sent to the external model as conversation history on the next question.
**Status:** FIXED and verified by tests that capture the actual outgoing provider HTTP body.

## 1. Original reproduction (re-run on the S34 baseline `81256aa`)

`docs/s34/evidence/s34-baseline-repro.mts` (the S33 script, re-pathed) → `s34-baseline-repro.output.txt`:

```
A provider body contains private appendix: true
B local [Qu'est-ce qu'un crédit ?] grounded=record -> D’après votre dossier … • Earned 3.0 of 24 credits
```

The defect was present on the current production code, not only on the S33 audit baseline.

Root cause:
- `composeWithPrivateContext` (`server/services/assistant-conversations/reply.ts`) appends the private section to `content`.
- `service.ts` stores `content`.
- `store.recentTurns` returned it verbatim.
- `providerSafeHistory` removed only turns that *start* with a record-answer head. A live answer starts with model text, so the appendix behind it passed through.

## 2. Technical fix: a structural boundary, not a heading filter

New module `server/services/academic-assistant/private-boundary.ts`.

1. **Structural signals from the store.**
   - `store.recentTurns` now also returns each turn's stored `mode` and `private_refs`.
   - These columns already exist and are written on every reply: no schema change and no migration.
   - The integrity hash chain is untouched, because nothing stored is modified.
2. **`providerSafeTurns()` (primary rule, fails closed).** An assistant turn is provider-visible only if all of these hold:
   - `mode === 'live'` (text the model itself produced);
   - it is not a deterministic record answer;
   - when it carries private references, the appendix boundary can be located exactly. Only the text *before* the boundary is kept; if the boundary cannot be found, the turn is dropped.

   Local or knowledge-base answers, record answers, legacy rows with no `mode`, and unknown formats are dropped, together with the student question that produced them.
3. **Applied at the single entry point.** `createConversationService.postMessage` hands `generateReply` only the projected turns. Any reply generator (current or future) therefore receives provider-safe history. Previously stored messages are covered because the projection runs on read.
4. **Defence in depth on every caller.** `providerSafeHistory` (inside `buildProviderMessages`) now strips everything from the first private-appendix head (EN, FR, both apostrophe forms) from any assistant turn. This also covers client-supplied history on `/api/assistant/message`.
5. **One source for the heads.** `reply.ts` takes its EN/FR heads from `PRIVATE_APPENDIX_HEADS`, so the stripping layer and the composer cannot drift apart.

**Unchanged:**
- The student still sees the full private section, with its deep links (`privateRefs`).
- Record answers still work locally.
- The S32-A F01 rule that no record ever goes into the prompt (`PROVIDER_RECORD_LABELS` is empty).
- The PII guard, the minor-safe prompts, and the budget and fallback behaviour.

## 3. Tests: `tests/s34-assistant-private-history.test.ts` (13 tests)

**How the test is wired**
- It drives the production wiring: `createConversationService` → `createIntegratedGenerateReply` (private retrieval) → `generateReply` with default deps (own-record loading) → `answerMessage` → `callMuseSpark` → `fetch`.
- Only the SQL store, the record loader and the budget store are in-memory fakes.
- `fetch` is stubbed, and the **complete JSON request body** that would leave the server is captured.
- Every captured body is checked against a list of synthetic secrets: document title and date, memory item, address marker, course title, credits, balance, ticket subject, attachment file name, both appendix heads, both record-answer heads.

| Brief requirement | Test |
|---|---|
| 1. First question produces a visible private appendix | `live conversation … (EN)` / `(FR)`: stored reply contains the head and the document line |
| 2. Student receives the correct private information | same: exact line `Passport scan … — uploaded 2026-10-01`, `privateRefs` with paths |
| 3. Next question creates provider-safe history | same: the history equals exactly `[q1, public model answer, q2]` |
| 4. No private data in the outgoing payload | `expectClean` on every captured body, in every test |
| 5. EN and FR | EN/FR describe blocks; FR personal → FR general; mixed-language multi-turn |
| 6. Previously stored vulnerable history sanitized | `previously stored (pre-S34) …`: live with appendix and refs; FR straight-apostrophe appendix with **no** refs; pre-F34 local record answer; refs with an unknown format (dropped, fail closed); `mode: null` knowledge-base answer with appendix |
| 7. Personal record answers still work locally | `How many credits have I earned?` → `mode: local`, contains the fact, zero provider calls |
| 8. General questions still work | `What is photosynthesis?` → live call made, body clean |
| 9. Private links remain functional | `privateRefs` `{kind, title, path}` asserted on the stored reply |
| 10. No leak through fallback or retry | provider 500 → local fallback, the single attempted body is clean, no hidden adapter retry; replay with the same `clientRequestId` makes no new call |
| Multiple consecutive turns / truncation | 6 consecutive live turns with appendices across the 6-turn window: all bodies clean, public history kept |
| Uploaded document references | an attachment on an earlier message: the file name never reaches the provider |
| Any caller (client history) | `buildProviderMessages` strips appendices from client-supplied history and keeps the public part |
| Live/local control | student is live only under `SPARK_ASSISTANT_STUDENT_POLICY=minor_safe_v1`; adding `student` to `SPARK_ASSISTANT_LIVE_ROLES` has no effect |

**Mutation check.** With both fix layers reverted, 7 of 13 tests fail (every payload test). With the fix, all 13 pass. The new tests therefore detect the original defect.

Existing privacy suites (`s32a-assistant-review-fixes`, `s25-assistant-confidentiality`, `s21-reply-integration`, `s20-assistant-*`) pass unchanged (see `S34-TEST-EVIDENCE.md`).

## 4. Student live AI: operating rule

- Student live AI is controlled only by `SPARK_ASSISTANT_STUDENT_POLICY`. Removing `student` from `SPARK_ASSISTANT_LIVE_ROLES` has no effect: students are excluded from that list in code (`decideLive`), and the test above proves it.
- **Until S34 is live and hosted acceptance passes, production must have `SPARK_ASSISTANT_STUDENT_POLICY` set to anything other than `minor_safe_v1`** (for example `off`), or deleted. Owner AI is unaffected.
- No private data is leaving today in any case: the provider rejects every call with HTTP 402 `billing_not_configured` (see S33-03).
- After S34 is live:
  1. Set the policy back to `minor_safe_v1`.
  2. Sign in as the synthetic demo student.
  3. Confirm that `GET /api/assistant/status` returns `"mode":"live"` (or `local` with `reason`), and that a two-question conversation returns live answers.
- I could not verify the production value of the policy from this session; the owner must check it.
