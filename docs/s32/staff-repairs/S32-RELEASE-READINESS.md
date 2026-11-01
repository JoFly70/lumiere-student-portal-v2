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
