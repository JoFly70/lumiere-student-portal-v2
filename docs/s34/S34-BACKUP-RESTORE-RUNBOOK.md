# S34 Backup and Restore Runbook (S33-09)

Short and operational. Nothing here has been rehearsed yet (see "Drill" at the end). Production Supabase project: `rheronevecsffaejteoj`. Hosting: Replit Deployments.

## 1. Who

- Only the **owner** may start a restore or approve one. Staff and agents never restore production.
- Agents may prepare, read and verify. They do not run restores, change Supabase plan settings or buy add-ons.

## 2. Where backups come from

| Layer | Source | Status |
|---|---|---|
| Daily database backups | Supabase Dashboard, project `rheronevecsffaejteoj`, Database, Backups | **REQUIRES OWNER VERIFICATION.** Depends on the Supabase plan. Do not assume enabled. |
| Point-in-time recovery (PITR) | Same page, "Point in Time" tab | **REQUIRES OWNER VERIFICATION.** Paid add-on. Do not assume enabled. |
| Pre-release `pg_dump` | `scripts/release/s26/apply-production.sh` and `scripts/release/s27|s29|s30/apply-*.sh`, run by `scripts/s26/release-loop.sh` | Taken **only before a schema release**, as `pg_dump --schema=public -Fc` into `.s26-private-backup/` (git-ignored, in the Replit workspace), then checked with `pg_restore -l`. Public schema only: not Supabase Auth users, not Storage objects. Not a scheduled backup. |
| Manual full dump (`docs/release/s14/RUNBOOK.md` step 2) | Owner machine: `pg_dump "$DATABASE_URL" -Fc` plus `--schema-only` | One-off, before major releases. |
| Uploaded files | Supabase Storage buckets (private) | Not covered by database backups. Treat as separate (see section 7). |
| Code | GitHub repo and Replit deployment history | Not a data backup. |

Owner checklist (10 minutes): open the Backups page, record (a) whether daily backups are listed and the latest time, (b) whether PITR is enabled and its retention window, (c) the plan name. Write the answers in the S34 record. Until done, assume **only the pre-release dumps exist**.

## 3. Verify backup status (any time)

1. Dashboard, Database, Backups: latest backup is under 24 hours old. If PITR is enabled, the earliest restore point is listed.
2. Latest pre-release dump: `ls -l .s26-private-backup/*.dump` in the Replit workspace, then `pg_restore -l <file> | head` lists tables and the size is non-zero.
3. Note the result and date in the release record.

## 4. App rollback versus database recovery

- **Bad code, data fine:** roll back the **app only**. Replit, Deployments, redeploy a previous build (or republish the previous git SHA). Confirm the served release marker with `/api/health` (`release` field) or `release.json`. Additive migrations stay; the older code tolerates them (see `docs/release/s14/RUNBOOK.md` Rollback). Check that the older build does not reopen a known flaw before choosing it.
- **Bad data (deleted, overwritten, corrupted):** database recovery. Rolling back the app does nothing for data.
- **Both:** stop writes first (maintenance notice to staff), recover data, then choose the app build.

## 5. Restore procedure (owner)

Never restore directly over production first.

1. **Freeze.** Tell staff to stop editing. Note the time of the incident and the last known good time.
2. **Preserve the current state** before any change: take a fresh `pg_dump -Fc` of production (and `--schema-only`) so newer data is never lost.
3. **Restore into a separate, new Supabase project** (Dashboard, Backups, restore to a new project when available, or create a scratch project and `pg_restore --no-owner` the chosen dump, or PITR to the chosen timestamp if verified enabled). Never point the app at it yet.
4. **Validate the recovered copy** (section 6).
5. **Decide the path** with the owner:
   - Small loss: copy only the missing rows from the recovered project into production (targeted `INSERT ... ON CONFLICT DO NOTHING` by id). Safest: nothing newer is overwritten.
   - Large loss: switch the app to the recovered project (new `DATABASE_URL`, Supabase URL and keys in Replit secrets, Auth URL settings), or restore over production only with explicit owner approval and the step 2 dump in hand.
6. **After:** run the post-release checks (`scripts/release/s25/90-production-postverify.sql`, `scripts/release/s14/90-verify.sql`), then smoke test as staff and as a test student. Record what was lost between the restore point and the incident and tell the affected people.

### Avoid overwriting newer data

- Compare `max(updated_at)` / `max(created_at)` on `students`, `documents`, `payments` in production versus the recovered copy before choosing a path.
- Prefer row-level recovery over a full overwrite whenever production kept receiving valid writes.
- A PITR or dump restore discards everything written after its point in time (`docs/release/s14/RUNBOOK.md`).

## 6. Validate recovered records

Run the same read-only queries on production (or the step 2 dump) and on the recovered copy; counts must match or the differences must be explained by the incident window.

- Counts: `students`, `enrollments`, `student_credits` / credit awards, `hs_enrollments`, `hs_credit_awards`, `documents`, `payments` / billing tables, `users`, `tickets`.
- Spot checks: 5 known students (including the real first student) with their enrollments, credit totals, last document, and last payment.
- Integrity: foreign keys intact (no orphan `student_id`), newest `updated_at` is just before the restore point, Auth users match `users` rows.
- Documents: sample 3 document rows and open the file in Storage (rows can exist without the object, or the reverse).
- Billing: totals per student agree with the last statement.

## 7. If the restore fails

1. Stop. Do not retry against production. Production is untouched if step 3 was followed.
2. Try the next source: an older daily backup, then the pre-release dump, then the owner's manual dump.
3. Storage objects missing: they are not in database backups; re-upload from the originals or ask students to resubmit, and mark the documents as needing re-upload.
4. Auth users missing: recreate through the invitation flow; do not hand-edit `auth.users`.
5. Escalate to Supabase support from the Dashboard with project ref, timestamps and error output.

## 8. Drill (not done yet)

Once: restore the latest backup into a scratch project, run section 6, delete the scratch project, and record the date and time taken. Until done, restore time is unknown.

## Owner verification result (2026-11-02)

The owner checked Supabase → project "Lumiere Student Portal V2" (`rheronevecsffaejteoj`, branch `main`, PRODUCTION) → Database → Backups.

- **Plan: FREE.** The page states: "Free Plan does not include project backups. Upgrade to the Pro Plan for up to 7 days of scheduled backups."
- **Daily backups: NONE. PITR: NOT AVAILABLE** (PITR requires Pro plus the paid add-on).
- The only existing copies are the runner's pre-release `pg_dump`s in `.s26-private-backup/`. These cover the public schema only (no Auth users, no Storage files) and are taken only when a schema step applies.
- **Recommendation (owner decision, involves cost):** upgrade the project to Pro, for daily backups with 7-day retention, and so that the production project is not paused for inactivity. Until then, take a manual full `pg_dump` (section 2, "Manual full dump") before any risky operation, and periodically.
- **Owner decision (2026-11-02): option B.** A nightly encrypted backup on the existing OVH VPS (the same host and offline recovery key as ClientDesk), instead of the Supabase Pro upgrade. Files and install steps: `deploy/backup-ovh-lumiere/README.md`.
