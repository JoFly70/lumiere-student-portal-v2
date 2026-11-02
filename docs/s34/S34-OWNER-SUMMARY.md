# S34 — Owner summary (plain English)

S34 corrected what the S33 audit found. Nothing was redesigned. Screens, workflows, credit rules and permissions work as before.

## What is safer

- **Private records no longer reach the AI provider.**
  - The assistant's private "From your records" section stayed private when shown. But the next question could carry it to the AI company as conversation history.
  - Now, what the AI receives is filtered using facts stored with each message (was it a live AI answer? did it carry private items?), not by looking for a heading.
  - Anything uncertain is left out. Old conversations are filtered too.
  - Tests capture the exact message that would leave the server and check it in English and French.
  - Students still see their private section and links.
- **Old student-callable shortcuts are closed.** Two legacy endpoints can no longer be used by students to write plan data. The system-check endpoint now requires an administrator.
- **Errors reach monitoring without exposing data.** Server errors now reach Sentry, without student data, tokens or e-mail addresses, and each error is reported once.

## What is more reliable

- **Office work no longer hits limits.**
  - Request limits now count per signed-in person (600 per 15 minutes; 300 more for admin pages), instead of 100 shared by everyone in the office.
  - Sign-in attempts are still strictly limited, but only failed attempts count.
  - Session renewal has its own allowance, so a busy morning of sign-ins can no longer lock everyone out.
- **"Too many requests" is now readable.** The message is short and in French or English, instead of raw technical text. It never signs anyone out.
- **No wrong Flight Deck on a temporary error.** A high-school student hit by a temporary error sees "try again", never the university Flight Deck.
- **Clearer assistant answers.**
  - The assistant explains general questions (« Qu'est-ce qu'un crédit ? ») instead of showing the student's own credit line.
  - French answers use readable dates (« 2 novembre 2026 ») and correct plurals (« 1 jour », « 2 jours »).
- **Transcript requests are no longer missed.** A graduate's transcript request now appears in Needs Attention.
- **One name on the first screen.** A student with a preferred name sees it in both the greeting and the welcome banner.
- **A recovery guide exists.** `docs/s34/S34-BACKUP-RESTORE-RUNBOOK.md`.

## What you need to do

1. **Now: keep student live AI off until S34 is published.**
   - In Replit → Secrets (production), set `SPARK_ASSISTANT_STUDENT_POLICY` to `off`, or delete it.
   - Removing `student` from `SPARK_ASSISTANT_LIVE_ROLES` does **not** turn it off.
   - Leave Owner AI settings unchanged.
2. **Fix AI billing.**
   - The AI provider is refusing calls with *"Billing verification failed … your team needs to resolve a billing issue"* (HTTP 402, `billing_not_configured`).
   - Open https://dev.meta.ai/billing for the team that owns `META_MODEL_API_KEY`, resolve the billing issue, and confirm credits or quota.
   - No code or model change is needed.
   - My test used this session's connection to the same provider. Please confirm that the production key belongs to that team (in the production deployment log, look for `Owner assistant provider call failed` with `status: 402`).
3. **Publish S34** using the usual S26 release runner (exact steps in `S34-RELEASE-READINESS.md`). Then check that the hosted acceptance shows the new SHA and all required checks pass.
4. **After publishing, if you want students to have live AI again:**
   - set `SPARK_ASSISTANT_STUDENT_POLICY=minor_safe_v1`;
   - as the synthetic demo student, confirm the assistant status shows live and that two questions in a row are answered.
5. **Backups (10 minutes).**
   - In Supabase (project `rheronevecsffaejteoj`) → Database → Backups, note whether daily backups and point-in-time recovery are on, and their retention.
   - Use the checklist in the runbook.
   - Optional: `REDIS_URL` (Diagnostics → rate-limit backend tile).

## Is another engineering session justified?

**No.** After S34 is published and accepted, the Portal can return to normal operations.

The remaining items are owner configuration: AI billing, the student AI switch, and backup verification. They don't need development.

Only cosmetic leftovers remain (for example, an English billing date format). They don't justify a session on their own.
