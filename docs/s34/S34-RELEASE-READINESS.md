# S34 — Release readiness

| Item | Value |
|---|---|
| Source branch / SHA | `claude/s26-owner-and-first-student-finish` @ `81256aaa0baefe65fac66f18e2a25e554808bd7b` |
| Current live release (marker content) | `4ccd8ae9481986f0e4c1268cca9fabed9df09308` (S32.1). Not re-verified from here: the hosted site is unreachable from this container. |
| S34 branch | `claude/s34-post-audit-maintenance` (a fast-forward descendant of `81256aa`; no rebase, no force-push) |
| Candidate (tested code) SHA | `6fb963409548a8df2e80d506454906dd96808708` |
| Release marker commit | the next commit on the S34 branch, which writes the candidate SHA into `release/S26_RELEASE_SHA` |
| Schema / migrations / release scripts / `.replit` / dependencies | **none changed**, so the runner's guarded schema steps are no-ops |

## Gates

| Gate | Status |
|---|---|
| TypeScript, full suite (4319/0), build, lint (0 errors) | PASS (`S34-TEST-EVIDENCE.md`) |
| Privacy acceptance (S33-01) | PASS: outgoing provider bodies inspected in tests (`S34-PRIVACY-VERIFICATION.md`) |
| Rate-limit acceptance (S33-02) | PASS: shared IP, refresh vs login, error translation, middleware order (`S34-RATE-LIMIT-VERIFICATION.md`) |
| Independent review | PASS after fixes |

**Regression gate:**
- Account linking, authorization, earned-credit calculations, student-record exposure and enrollment are unchanged or tightened.
- The production build passes.
- No important test fails.

## Release procedure (S26 marker; nothing bypassed)

1. **Promote the release branch.** Fast-forward `claude/s26-owner-and-first-student-finish` to the S34 marker commit. It is a pure fast-forward of `81256aa`. This is the step earlier sessions performed.
   - **This session was authorized to push only to the S34 branch, so this step needs the owner's go-ahead.**
   - Either say "promote S34 to the release branch" in a session, or run:

```bash
git fetch origin claude/s34-post-audit-maintenance && git push origin origin/claude/s34-post-audit-maintenance:claude/s26-owner-and-first-student-finish
```

   - The push is rejected unless it is a fast-forward (no force).
2. **Before publishing**, set `SPARK_ASSISTANT_STUDENT_POLICY` to `off` (or delete it) in the production secrets, if it is not already.
3. **Run the S26 runner** once in the production Replit Shell. It checks the production identity, preserves the workspace, checks out exactly the marker SHA, runs `npm ci` and the build, runs the (no-op) schema checks with backup, provisions demo data, writes `release.json`, and prints "ready to publish":

```bash
curl -fsSL https://raw.githubusercontent.com/JoFly70/lumiere-student-portal-v2/claude/s26-owner-and-first-student-finish/scripts/s26/release-loop.sh | S26_RELEASE_MARKER=1 S26_LOOP_HOURS=6 bash
```

4. **Publish** (Replit → Republish) when the runner says "ready to publish". The owner keeps the final publishing authority.
5. **Live only when** `/health` reports `6fb963409548a8df2e80d506454906dd96808708` **and** `s26-evidence/acceptance.json` passes the required checks.
   - The two Owner AI checks (`admin.owner-ai-*`) will keep failing until the AI billing is resolved (S33-03).
   - The runner does not pass `--allow-ai-unavailable`, the acceptance script's own flag (`scripts/s26/production-acceptance.ts`). If billing cannot be fixed first, expect exactly those two failures. Record them as the known S33-03 configuration item, not as an S34 defect.

## Backup and rollback readiness

- **Database:** S34 makes no schema or data change.
  - The runner's guarded steps still take their pre-release dump when a schema step applies.
  - Supabase backup and PITR status: **REQUIRES OWNER VERIFICATION** (`S34-BACKUP-RESTORE-RUNBOOK.md` §2).
- **Application rollback:** write `4ccd8ae9481986f0e4c1268cca9fabed9df09308` back into `release/S26_RELEASE_SHA` (or republish the previous Replit deployment).
  - Rolling back reopens S33-01. Keep `SPARK_ASSISTANT_STUDENT_POLICY` off if you ever roll back.

## Known blockers and conditions

| Item | Owner action |
|---|---|
| AI provider HTTP 402 `billing_not_configured` (S33-03) | Resolve billing at dev.meta.ai for the team owning `META_MODEL_API_KEY`. |
| Student live AI | Keep it off until S34 is live and accepted. Then re-enable `minor_safe_v1` and confirm `/api/assistant/status` shows `live` for the synthetic student. |
| `REDIS_URL` and the real client IP behind Replit | Check the Diagnostics rate-limit tile (unverified). |
| Hosted acceptance | Run by the runner after publishing; not performed from this session. |

**S34 is not live.** It is ready to release.
