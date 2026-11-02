# S33: Independent Production Readiness Audit (Executive Summary)

**Audit date:** 2026-11-02
**Audited code:** `fbdc30b` (S32 release commit, the S33 starting point). Production currently runs `4ccd8ae` (S32.1), which differs from `fbdc30b` only in the support-desk refresh timing, release notes and the release marker. Those differences were reviewed and are covered by this audit (see the Evidence Index).
**Method:** independent code reading, targeted re-runs of existing tests, two scripted reproductions, review of S31/S32 evidence. Two specialist reviewers helped; every finding below was re-checked by the lead reviewer before it was accepted, and several of their claims were downgraded.
**What was not done:** no access to the live site, the production database, real email or the AI provider. Hosted behavior is marked *unverified* where it matters.

## Verdict: READY WITH MINOR CORRECTIONS

The Portal is fit for routine use with the first students. The enrollment chain (invitation → sign-up → "ready to link" → administrator link) is sound and well protected. Role boundaries are enforced on the server, not just hidden in the interface. Credit figures never present unaccepted credit as earned. No launch blocker was found.

Two real problems deserve a small, prompt correction. Neither affects the first student's ability to use the Portal today:

1. **A privacy gap in the Academic Assistant (live AI mode only).** On the Assistant conversation page, a short "From your records (private, not sent to any AI model)" section is added to answers. On the student's *next* question, that section is sent to the external AI model as part of the conversation history. This was reproduced. The AI provider is currently failing in production, so nothing is being sent right now. **This must be fixed before student live AI is relied on again**, or student live AI should stay off until then.
2. **Request limits are set per internet address and are very low.** All staff in one office share 30 administrative requests per 15 minutes, and everyone shares 100 general requests. One Student File opening uses several of those requests. With two or three staff working at the same time, screens will start failing with an untranslated error. S32's own release run had to pace itself to stay under these limits.

## Counts

| Category | Count |
|---|---|
| P0: launch blocker | **0** |
| P1: important | **3** (2 code, 1 configuration) |
| P2: improvement | **7** |
| Deferred / no change | **12** |
| Important unverified items | **9** |

## Top material risks

1. **S33-01 (P1):** private record snippets can reach the AI model through conversation history (student live mode).
2. **S33-02 (P1):** per-address request limits will block normal multi-person staff work and can sign people out. The error shown is a raw English message.
3. **S33-03 (P1, configuration):** live AI answers (Owner AI and the student assistant) have failed in production since 2026-11-01. S32's own log says the release is "not yet fully accepted" for this reason. The likely cause is the provider account (API key, credits or an outage), not the code.
4. **S33-05 (P2):** when a high-school graduate requests a transcript, staff are not alerted. It is visible only inside that student's High School page.
5. **S33-04 (P2):** with AI off (the current reality), "Qu'est-ce qu'un crédit ?" is answered with the student's own credit record instead of an explanation.

## What already works well, and should stay as it is

- **Invitations:** single use, expiring, bound to one email, emailed in EN/FR, and older codes are revoked automatically.
- **Account linking:** the administrator confirms every link, the email must match, and each step is audited.
- **Needs Attention:** it surfaces "account ready to link" and the other key tasks, with working deep links.
- **Academic figures:**
  - High-school credit counts only official awards; work a student reports stays "awaiting the school".
  - The degree view never counts credit the university has not accepted as earned.
  - The Flight Deck, roadmap and assistant use the same arithmetic.
- **Server-side permissions** on documents, billing, guardian and identity decisions, tickets and account administration.
- **Graduation flow:** high-school graduation is gated on verified diploma and transcript evidence, and the student sees a graduated state.
- **Billing:** ledger-based, with locked paid installments, voids that require a reason, and a full audit trail. The support-based payment fallback is adequate for the pilot.
- **French experience:** the French student screens shown in the S32 evidence are fully translated, including mobile.
- **Assistant safeguards:** the S32 assistant privacy fix on the main path, the monthly AI budget limit, and the fallback to built-in answers.
- **Design choices to keep:** the separation between the Student File and the Advanced Workspace, and the bottom-left assistant orb.

## Missing verification

The following were not checked in this audit:
- live email delivery and the French Supabase auth emails;
- whether `REDIS_URL` is set, how many server instances run, and whether Replit passes the real visitor address;
- Supabase backups and a restore test;
- the cause of the AI provider failure;
- a real-browser French journey and real-device mobile rendering against production;
- live authenticated role tests.

## Decisions for the owner

1. **Student live AI.** Keep it off (`SPARK_ASSISTANT_LIVE_ROLES` without `student`) until S33-01 is fixed, or accept the risk briefly. *Recommended: keep it off.*
2. **AI provider account.** Check the Meta model API key and credits, because Owner AI has been unavailable since 2026-11-01.
3. **Office size.** How many staff will work from one office network at the same time? This sets how far the S33-02 limits need to change.
4. **Backups.** Confirm Supabase point-in-time recovery is on, and agree who would perform a restore.

## Recommended next step

**One small maintenance batch.**
- **First:** S33-01 and S33-02, about one day of work, both with tests.
- **Optional:** the P2 items, about one more day.
- **In parallel, the owner:** fixes the AI provider account, then re-runs the S26 hosted acceptance so the release is formally accepted.

No new features, redesigns or new engineering sessions beyond this batch are justified by the evidence.
