# S32 — Release Readiness (one combined production release)

## 1. Gates (HANDOFF-S28 §0, pre-approved release conditions)

| Gate | Status | Evidence |
|---|---|---|
| Type check | PASS | `npx tsc --noEmit -p .` is clean on the candidate |
| Full test suite | PASS | 4,227 passed, 0 failed; 8 env-gated files skipped (as on S32-A) |
| Production build | PASS | `npm run build` |
| Security review of the changes | PASS | Independent review of the combined diff: no Critical, High or Medium findings. The 8 Lows were fixed (`141d6ad`). |
| Visual checks | PASS (local) | Staff: 50 renders at 390/768/1440, light and dark, EN and FR, 0 overflow, 0 errors. Student: S32-A matrix, 0 overflow. |
| Role boundaries | PASS | Full-app boundary test; staff/admin/coach crawl 103/103 |
| Academic integrity | PASS | No path marks credit or verified records. Imports and placements are unchanged and admin-only. Reported vs accepted credit is unchanged on the staff side; S32-A tightened the student side (F04, F07). |
| Financial integrity | PASS | No payment, balance or receipt logic changed. Evidence reuse is checked server-side against the same student. |
| Audit integrity | PASS | FK intact; previously lost audit rows are now written (real-Postgres proof) |
| Schema / migrations | none | No `supabase/migrations`, `scripts/release` or `.replit` change, so the runner's schema steps are no-ops (already applied) |

## 2. Release procedure (S26 marker; nothing bypassed)

1. Fast-forward `claude/s26-owner-and-first-student-finish` to the candidate SHA.
2. Write that full SHA into `release/S26_RELEASE_SHA`.
3. Commit "Release marker: S32 …" and push the release branch.
4. The **owner** runs the S26 runner once in the production Replit Shell. It:
   - preserves the workspace;
   - checks out exactly the marker SHA;
   - runs `npm ci` and the build;
   - runs the guarded schema steps (backup, verification);
   - provisions demo data;
   - writes `release.json`;
   - prints **ready to publish <sha>**;
   - waits for the live site to serve that SHA;
   - runs hosted acceptance.
5. Publish (Replit **Republish**, or the Replit `publish_app` tool) once the runner prints "ready to publish".
6. Release is complete only when `/health` reports the candidate SHA **and** `s26-evidence/acceptance.json` passes all required checks.

The single command the owner runs (from HANDOFF-S28 §4):

```bash
curl -fsSL https://raw.githubusercontent.com/JoFly70/lumiere-student-portal-v2/claude/s26-owner-and-first-student-finish/scripts/s26/release-loop.sh | S26_RELEASE_MARKER=1 S26_LOOP_HOURS=6 bash
```

## 3. Post-release observations (owner or next session)

| What | How | Why |
|---|---|---|
| Hosted acceptance result | Read `s26-evidence/status.json` and `acceptance.json` (Replit `read_app_file`) | Release gate |
| S32-A F01: assistant mode for students | Sign in as a DEMO student and open `GET /api/assistant/status` | Align `.replit` (`SPARK_ASSISTANT_STUDENT_POLICY`) and HANDOFF-S28 §2 with what is live. On this code, no student record reaches the provider in either mode. |
| SA-05 in production | Diagnostics → Audit tile: the failure count should stop rising after the release | Confirms the FK defect is gone live |
| Concierge | Decide whether to switch the Concierge on (Notifications → Concierge) | Student calendar reminders are sent only when it is on (SA-14, truthful default) |
| Staff | Give a staff member the File: they can now review documents | Owner decision 3 takes effect |

## 4. Genuine blockers

None in code. The only step S32 cannot do itself is **running the S26 runner in the production Replit Shell**. Production secrets live there, and this session cannot reach the live workspace. Production is **not published** until the owner runs the command above and hosted acceptance passes.

## 5. Live release log

### `fbdc30b` (published 2026-11-01 22:19 UTC)

- **Runner:** sync, build and provision passed; schema steps skipped (already applied); ready_to_publish at 22:16. Published through the Replit deployment.
- **Live check:** `/health` reported `release: fbdc30b…`, database ok.
- **Hosted acceptance: FAIL.** 57/59 required checks passed and 2 failed; 19/27 optional checks passed.
  - **Required failures (2):**
    - `admin.owner-ai-answer-en` and `admin.owner-ai-draft-reply-fr`: "provider_error: Spark did not answer".
    - The student assistant also reported "the AI model was unavailable" in the same run.
    - The AI provider adapter, model pin, config and Owner AI service are unchanged since `31c3a1f` (which passed); S32 changed only the citation paths. This points to the AI provider being unavailable at that time, not a code change.
  - **Optional failures (8):**
    - `browser.admin.*` from the support desk onwards showed the sign-in form.
    - The run used 104 API requests against the server's 100 per 15 minutes per IP, with 778 s of budget waits.
    - Previous releases passed these pages. The cause is most likely the session timing out under rate-limit pressure (the in-browser token refresh is blocked by the harness), but this was not proven.
    - `browser.student.subjects-tab` is the known outdated check.
- **Response:** fix-forward release `S32.1`:
  - The support desk's automatic refresh (SA-37) is lighter: queue every 2 min, counters every 5 min, open ticket on window focus. That is about 10 requests per 15 min instead of about 45, since every `/api` request counts against the shared 100-per-15-minutes per-IP limit.
  - The new marker gives a fresh acceptance run in a clean rate window.

### `4ccd8ae` (S32.1, published 2026-11-01 22:50 UTC): current live release

- **Runner:** all steps passed; schema steps skipped (already applied). Published; `/health` reports `release: 4ccd8ae…`, database ok.
- **Hosted acceptance: FAIL on the same 2 required checks only.** 57/59 required checks passed; 33/34 optional passed, the 1 failure being the known outdated `subjects-tab` check.
  - All the admin browser pages that failed at `fbdc30b` now pass.
  - Every other functional area passed: sign-in for each role, documents, support, billing, photos, role restrictions, S29 operations, approved-release match, and the student screens.
- **Remaining failures:** `admin.owner-ai-answer-en` and `admin.owner-ai-draft-reply-fr`, "provider_error: Spark did not answer".
  - The student assistant again fell back to its built-in guide, with the notice shown to the student.
  - The failure repeated 45 minutes apart.
  - The provider adapter, pinned model, configuration and Owner AI request assembly are unchanged since `31c3a1f`, which passed both checks at 05:21 the same day.
  - This points to the provider account or connection (API key, credits/quota, or a provider outage), not S32 code. It is not yet confirmed: the provider's actual error is only in the production deployment log.
- **Status:** live and functionally verified except live AI answers; the AI features degrade gracefully (no data loss, no wrong answers). The release is **not yet fully accepted** until the AI checks pass.
