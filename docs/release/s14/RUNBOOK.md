# S14 first high-school student: production cutover runbook

One supervised session, about 2–3 hours. The production stack stays as it is: the Replit autoscale deployment `lumiere-student-portal-v-2.replit.app` and its existing Supabase project. No staging project and no new infrastructure.

Scripts are in `scripts/release/s14/`. Every SQL file is pasted into the Supabase SQL editor of the production project.

- **A:** low-risk and reversible. Owner OK is enough.
- **B:** schema, auth or student data. Needs written owner release approval (`APPROVE-B` below).
- **Never:** run the 192 hosted-gated test suites against this project. They create and delete users and rows.

## Before the session (read-only, can be done today)

| # | Step | Who / class | Pass condition |
|---|---|---|---|
| P1 | In the Supabase dashboard, note the project **ref**. In Replit → Secrets, check that `SUPABASE_URL` and `DATABASE_URL` contain that same ref. Look only at the host part, never copy the keys. Check that `SESSION_SECRET` and `SUPABASE_SERVICE_KEY` are set and `ALLOW_DEMO_MODE` is unset. | Owner, read | One ref everywhere. This is the project every later step targets. |
| P2 | Run `00-baseline-probe.sql`. | Owner, read | Section A shows which migrations are APPLIED, PARTIAL or ABSENT; section B shows the S13 gap objects. **Send the output to S14/S13.** It decides step 4. |
| P3 | Run `01-account-readiness.sql`. If `D_legacy_attachments` is true, also run the commented `escaping_paths` query at the bottom. | Owner, read | Admin and staff `without_active_profile = 0`; at least one admin with an active profile; all buckets private; `escaping_paths = 0`. |
| P4 | From your own machine, run `scripts/release/s14/smoke-hosted.sh https://lumiere-student-portal-v-2.replit.app` against the **current** build. | Owner, read | A record of the old build. FAILs here are expected. Keep the output. |
| P5 | Get the school's written list: the core course titles that are still placeholders and the **5 elective credits**, with half-units. Also the student's legal name, the email they will use, and confirmation that they consent. | Owner | Written source. Nothing invented. |

What a P2 or P3 result means for the session:

- **P3 lockout row ≠ 0:** fix it in step 5, before deploying. Otherwise the new build locks those staff out.
- **`escaping_paths > 0`:** stop and treat it as a possible incident. Review the storage logs for those paths and do not open the files.
- **A bucket is PUBLIC:** set it to private in step 5.
- **`ticket_attachments` is absent:** the legacy hole is closed in practice, because the legacy insert fails.
- **`ticket_attachments` exists and the cutover is more than a day away:** apply `docs/recovery/s10-evidence/security/legacy-attachment-hotfix.patch` to the workspace now (class A, see G in the S14 record).

## Cutover session

| # | Step | Class | Exact action | Verify |
|---|---|---|---|---|
| 1 | Freeze | A | Tell staff there is no portal use for the session. Nothing is sent to students. | — |
| 2 | **Backup and recovery point** | A | (a) Dashboard → Database → Backups: note the latest backup time. If PITR is on, note the current timestamp. (b) From your machine, run `pg_dump "$DATABASE_URL" -Fc -f pre-s14-$(date +%F).dump` and `pg_dump "$DATABASE_URL" --schema-only -f pre-s14-schema.sql` (the schema dump holds the grants, policies and functions needed for rollback). (c) Replit: note deployment id `a24d52bb-45d8-4fb8-89b8-4f688ba12b81` and its published time (Deployments pane). In the workspace shell, run `tar czf ~/pre-s14-workspace.tgz --exclude=node_modules .` and `sha256sum dist/index.js server/routes/tickets.ts`. | Dump file size is non-zero. Run `pg_restore -l pre-s14-*.dump \| head` and confirm it lists tables. |
| 3 | Confirm the artifact | A | The release SHA is the **final S13 SHA** named in S13's closeout. GitHub must show it on `claude/s13-hs-first-student-pilot`, with S13 reporting tsc, build and focused tests clean on it. Write it down. | `git rev-parse` in step 6 prints that SHA. |
| 4 | **Migrations** | **B** | In the SQL editor, run each file once, in this order, stopping on the first error. If P2 showed any migration **before S05** as ABSENT or PARTIAL, stop and send the output to S14/S13 instead (never re-run a pre-S05 file on a DB that has it). Order: `scripts/release/s14/10-prereq-tables.sql` → `supabase/migrations/20261026100000_s05_student_roadmap.sql` → `20261026110000_s07…` → `20261026200000_s09…` → `20261027100000_s08…` → `20261028100000_s10_support_idempotency_index.sql` → `20261028200000_s10_support_schema_repair.sql` → `20261029100000_s11…` → `20261029110000_s11…audit_event_types.sql` → `scripts/release/s14/30-account-gate.sql` (**must** come after S05–S11) → `scripts/release/s14/35-client-privilege-hardening.sql`. All are additive or grant-only, and all were re-run cleanly in the rehearsal. | `00-baseline-probe.sql`: all A rows APPLIED, all B rows `t`. |
| 5 | Buckets and account repair | B | Run `scripts/disposable-env/90_storage_buckets.sql` (creates any missing bucket as private; `ON CONFLICT DO NOTHING`). If a bucket is PUBLIC, switch it to private in Dashboard → Storage. If P3 found admin/staff without an active profile, run for each one, after checking the id: `insert into public.profiles (user_id, status) values ('<users.id>', 'active') on conflict (user_id) do update set status = 'active';`. | `90-verify.sql`: **every row pass = true**. `01-account-readiness.sql`: all pass. |
| 6 | **Deploy** | **B** | In the Replit workspace shell: put the tree at the release SHA, using either `git fetch https://github.com/JoFly70/lumiere-student-portal-v2 <branch> && git checkout --detach <SHA>`, or (if the workspace is not a git repo) a clean clone of that SHA copied over the workspace, keeping `.replit`'s `[userenv]`. Then run `npm ci && npm run build`, **required** because `dist/` is gitignored and `.replit` has no deployment build step, so publishing without it ships the old `dist/`. Run `sha256sum dist/index.js` and confirm it differs from step 2. Click Publish, with autoscale **max instances = 1** (see note R). | The Deployments pane shows a new deployment id. Record it. |
| 7 | Smoke | A | Run `smoke-hosted.sh <app url>`. Sign in as admin, then open the student list, a ticket, and Admin → High school templates. | Every check PASS. Admin pages load. `/ready` may report `distributedRateLimit:false` (accepted under R). |
| 8 | Create the student record | B | Admin → Students → **Add student**, with the legal name and email from P5. | The record has a `LCA-YYYY-NNNN` code. |
| 9 | Invitation | B, plus approval to contact the student | Admin issues the single-use invitation. The token shows **once** and no email is sent. Deliver the link to the student personally. | The invitation is listed as active. |
| 10 | Link the account | B | After the student signs up, open the student → Account card → **Link** the account. The email must match and the account must have the student role. | Audit row exists; the card shows Linked. |
| 11 | Enroll | B | Admin → High school → enroll in `us-hs-diploma-21` (16 core + 5 elective = 21). | Draft shows 21 required. |
| 12 | Courses | B | Confirm the placeholder core titles and add the school's 5 elective credits, **exactly as P5**. Do not type the awarding school's name in any free text before disclosure. | Draft shows planned = required in every area, or a gap the school accepted. |
| 13 | Publish the roadmap | B | Admin publishes. | Version 1 published. |
| 14 | Student view | A | With the student, or on a call: sign in → lands on `/high-school`; My Journey, Subjects and Graduation show 0 earned of 21 with the confirmed courses; Documents and Support open. | Matches the draft. No school name before disclosure. |
| 15 | Monitor | A | For 48 hours: Replit deployment logs (5xx, `HS_UNAVAILABLE`, `ACCOUNT_INACTIVE`) and Supabase logs. Keep `pre-s14-*.dump` and the old deployment for 14 days. | — |

## Rollback

- **App, step 6 or later:**
  - Replit Deployments → redeploy `a24d52bb…`, or restore `~/pre-s14-workspace.tgz` and republish.
  - This **re-opens the legacy attachment route**. Apply the hotfix patch to the old tree if it stays live more than a few hours.
  - The step 4 and 5 database changes can stay. They are additive, the old server uses the service role, and the old client makes no direct table calls (checked at `b9079a5`).
- **Database, step 4 or 5 fails partway:**
  - Every file is its own transaction, so the failed file has applied nothing. Fix the cause or stop.
  - The files already applied are additive and do not need undoing to keep the old app running.
- **Grants or policies are wrong:** re-apply the relevant `GRANT`, `POLICY` or `FUNCTION` statements from `pre-s14-schema.sql`.
- **Data corruption:** PITR or `pg_restore` of `pre-s14-*.dump`. This is the last resort, because it discards anything written after step 2.
- **Student-level:** unlink the account (with a reason), then revoke the invitation or archive the profile.

## Note R: Redis and rate limits

- Without `REDIS_URL`, rate limits are per instance and `/ready` reports not ready. The server still starts.
- With max instances = 1 the limits are still enforced. That is acceptable for a one-student pilot.
- Add `REDIS_URL` before scaling out.
