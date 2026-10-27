# S14: First high-school student production launch readiness

- **Branch:** `claude/s14-hs-production-launch`, started at `21341a4`.
- **Scope:** S14-owned files only: `docs/release/s14/**`, `scripts/release/s14/**` and this record.
- **Safety:**
  - Nothing was deployed, published or written to Replit or to any hosted database.
  - No real student data was used.
  - S13 files and branches were not touched.

How each claim is labelled:
- **VERIFIED:** run or read in S14.
- **PRIOR:** reported by an earlier session.
- **NOT EXECUTED:** not run.
- **BLOCKED:** could not be run from here.

## A. What was inspected

| Item | State |
|---|---|
| S14 base | `21341a4` (VERIFIED). Equal to the S13 tip when S14 started. |
| S13 tip at S14 close | `b2c7f11` (VERIFIED). Browser pass and toast accessibility. No migration, `.replit` or `package.json` change since `21341a4`. |
| main | `e9919e9` (VERIFIED, untouched) |
| Replit app | replId `33a30f4f-b01b-4abc-a2d8-e08f31fe10d9`. Publish status `success`, deployment `a24d52bb-45d8-4fb8-89b8-4f688ba12b81`, URL `https://lumiere-student-portal-v-2.replit.app` (VERIFIED via MCP). The tool shows no publish time, commit, history or build log. |
| Replit workspace code | `b9079a5` baseline from 2026-09-16, before S01 (VERIFIED: file inventory plus a `package.json` match). It has none of the S03–S13 files: no `invitations.ts`, `account-status.ts`, `high-school-*` or `admin-student-account.ts`. Its `tickets.ts` is the pre-S08 vulnerable one. It is 119 commits behind S13. `.git/HEAD` is not readable through the MCP. |
| Deployed build = workspace? | **Not verifiable.** `dist/` exists in the workspace but cannot be hashed through the MCP. Live HTTP is BLOCKED by sandbox egress (all requests returned 000). |

## B. Production: known facts vs unknowns

**Known:**
- Production runs code from before S03 (workspace, VERIFIED).
- Replit `[deployment]` has `run = npm start` and **no build command** (VERIFIED).
- `dist/` is gitignored (VERIFIED).
- The production env names in `.replit` are `APP_URL`, `PUBLIC_APP_URL` and `AUTH_EMAIL_MODE` (VERIFIED).
- No new env-var names were introduced from `b9079a5` to HEAD (VERIFIED).

**Unknown (each is resolved by a read-only runbook step):**
- Which Supabase project ref the Replit Secrets point to (P1).
- Which migrations are applied, and whether the S13 gap objects exist (P2).
- Whether staff and admin have active profiles; bucket visibility; whether `ticket_attachments` exists and has escaping paths (P3).
- Whether live routes answer 401 (P4).
- The Supabase backup or PITR tier.
- The Postgres version and table sizes.

## C. Deployment procedure

See `docs/release/s14/RUNBOOK.md`, step 6.
- Put the workspace on the exact S13 release SHA.
- **Run `npm ci && npm run build` before Publish.** Without a build step, Publish ships the stale `dist/`.
- Run autoscale with max instances = 1. Without `REDIS_URL`, rate limiting is per instance (see note R).
- Rollback is to redeploy `a24d52bb…` or restore the workspace tarball.

## D. Database migration plan

**New finding (S14, VERIFIED by grep and local rehearsal):** the S13 server needs objects that **no** `supabase/migrations` file creates. They exist only in the disposable-env scripts:
- `account_invitations`: invitations and sign-up fail without it.
- `current_user_is_active()`.
- `student_documents`: HS evidence fails without it.
- `student_contacts`.
- `student_english_proof`.
- The `trg_generate_student_code` trigger: "Add student" fails without it, because `student_code` is NOT NULL.

Two ordering problems also apply:
- S05, S09 and S11 each `CREATE OR REPLACE` `is_staff_or_admin()` and `student_owns_record()` **without** the active-account check, so the account gate must run last.
- S09 silently skips its contact columns if `student_contacts` does not exist yet.

S14 supplies three idempotent release scripts, taken from the repo's own definitions:

| File | Content | Class |
|---|---|---|
| `scripts/release/s14/10-prereq-tables.sql` | Three student tables and two triggers, from `50_runtime_supplement`/legacy `005`. RLS on, no client grants. Runs before S05. | B, additive |
| S05 → S07 → S09 → S08 → S10 idx → S10 repair → S11 → S11 audit | The existing migrations, unmodified | B, additive and enum values |
| `30-account-gate.sql` | S03 §1 and §6 verbatim (helpers, `account_invitations`), plus an anon revoke on the new tables. Runs **after** S11. | B |
| `35-client-privilege-hardening.sql` | S03 §3 and §5 verbatim: no anon table privileges; users cannot change their own `profiles.status`. Safe because neither the current nor the S13 client makes direct table calls (VERIFIED at `b9079a5` and at HEAD). | B, grants only |

**Rehearsal (VERIFIED, `scripts/release/s14/rehearse-local.sh`, log in `docs/release/s14/evidence/rehearsal-local-pg16.log`):**
- Setup: disposable PG 16, Supabase shim with default privileges, production-lineage baseline.
- Every release file returned rc=0, taking 0.03–0.15 s each.
- A second full pass returned rc=0 (idempotent).
- The probe reports all migrations APPLIED and every gap object present.
- **All `90-verify.sql` gates pass.**
- A synthetic smoke (rolled back) passed: student code generated, invitation row, document row.
- Timings are metadata-only, on empty tables. Production volume was NOT EXECUTED.

**Re-runnability (VERIFIED by a subagent on local PG):**
- S05–S11 and the S14 files: re-running is a no-op.
- Three pre-S05 files error if re-run.
- Five pre-S05 files silently revert policies if re-run.
- Rule: never re-run anything before S05. If P2 shows a pre-S05 migration ABSENT or PARTIAL, stop.

**Not included (S03 §2 and §4):** reconstructed legacy tables and coach policy rewrites. The pilot has no coach, and the server uses the service role.

## E. Essential hosted security checks

The checks below replace the 192 hosted suites for this launch. Those suites are **NOT EXECUTED**. Seven of the eight hard-code ref `rheronevecsffaejteoj`, which the docs name as both dev and the production auth target, and they mutate users and rows. Running them against production would be destructive.

1. `90-verify.sql` (read-only):
   - RLS on every public table.
   - No anon grants.
   - No authenticated grants on tables without policies.
   - No anon-executable functions.
   - 29 expected tables.
   - Private buckets.
   - Audit enum values.
   - HS triggers.
   - `profiles.status` not writable.
   - No ticket attachment path escapes its folder.
2. `01-account-readiness.sql` (read-only): admin/staff lockout check, bucket visibility, legacy attachment table.
3. `smoke-hosted.sh` (GET only, no credentials):
   - 401 on protected app routes.
   - `/env.js` serves an anon or publishable key, never a secret key.
   - Anon PostgREST is refused or gets zero rows on 12 sensitive tables.

   Tested here against a local stub only (it detected a planted leak). It is NOT EXECUTED against hosted because egress is blocked.
4. Supabase Auth → "Allow new users to sign up" is **off**. The server creates accounts with the admin API.
5. Step 14 of the runbook: the real student sees only their own data. Cross-student isolation, official-credit authority and document ownership were verified locally by S13 against the same code (PRIOR, 15/15 journey and 12/12 security).

A second hosted student account for a live cross-student test is **not** required. Isolation is enforced in server code that the student cannot bypass (the student id is derived from the token), and check 3 closes the direct-PostgREST path. If the owner wants it anyway, it is one synthetic invited account, archived afterwards.

## F. Backup and rollback

See runbook step 2 and "Rollback".
- **Backup:** the dashboard backup or PITR timestamp, plus a `pg_dump -Fc` and a schema-only dump (grants, policies and functions) from the owner's machine, plus the Replit workspace tarball and the old deployment id.
- **App rollback:** redeploy the old deployment. Database changes can stay: they are additive, the old server uses the service role, and the old client makes no direct table calls.
- **Data restore:** a last resort only.

## G. Legacy attachment issue

| Question | Answer |
|---|---|
| 1. Implementation in the workspace | Pre-S08 `server/routes/tickets.ts` (VERIFIED). The client supplies `storage_path` unchecked, the server signs it for 1 hour with the service role, and `upload-url` returns `publicUrl`. |
| 2. Is the deployed build running it? | **Not verifiable** here. Likely, because the workspace is the `b9079a5` baseline and `dist/` exists, but unproven. |
| 3. Storage and table configuration | Unknown. P3 answers it: whether `ticket_attachments` exists, the bucket visibility, and `escaping_paths`. |
| 4. Is the narrow hotfix sufficient? | As a stopgap, yes. `docs/recovery/s10-evidence/security/legacy-attachment-hotfix.patch` applies cleanly to the identical `72f89c9` blob after `tr -d '\r'` (VERIFIED by subagent). |
| 5. Does deploying S13 replace the route? | **Yes** (VERIFIED, HEAD `tickets.ts`):<br>• server-generated path pinned to ticket and uploader, checked against `pathRe`;<br>• object-existence check and duplicate rejection;<br>• the download re-checks the `tickets/<id>/` prefix and `..`, so rows planted before the fix stop working;<br>• no `publicUrl`. |
| 6. Checks before a real student has access | P3 (`escaping_paths = 0`, buckets private), then step 7 (`smoke-hosted.sh` 401 on `download-url`). |

The status is **unconfirmed, conditional exposure**, not an incident.

- **If P3 shows no `ticket_attachments`:** the practical exposure is nil, and the S13 deploy closes it.
- **If the table exists and the cutover is more than a day away:** apply the patch to the workspace and republish. This is class A but still a production action, so it needs explicit owner authorization. S14 did not do it.

## H. Release blockers, by severity

1. **CRITICAL: missing database objects in the release chain (D).** Fixed by S14 scripts 10, 30 and 35, which are rehearsed. They still need owner approval to apply.
2. **CRITICAL: production schema baseline unknown.** P2 must be run. If a pre-S05 migration is absent, re-plan before step 4.
3. **HIGH: possible staff lockout.** The S13 build requires an active `profiles` row and the current build does not. P3 detects it; step 5 repairs it.
4. **HIGH: stale `dist/`.** Replit has no build step. Runbook step 6 runs the build explicitly. Optionally, S13 or the owner adds `build = ["npm","run","build"]` to `.replit [deployment]`, which is outside S14 scope.
5. **HIGH: legacy attachment exposure (G).** The S13 deploy closes it. Until then, P3 decides whether to apply the hotfix.
6. **MEDIUM: hosted checks not executed** (E1–E4). They run in the session; a FAIL is a stop.
7. **MEDIUM: school curriculum not confirmed** (P5). Steps 12–13 are blocked until it is.
8. **LOW: Redis absent.** Accepted with max instances = 1.
9. **LOW: no staff caseload scoping.** Accept for the pilot and keep staff accounts to trusted people.

## I. Owner approvals needed

1. Run P1–P4, which are read-only, and share the P2 and P3 output.
2. **APPROVE-B:** apply runbook steps 4–5 to the production Supabase project, after the step 2 backup.
3. **APPROVE-B:** publish the final S13 SHA to Replit (step 6).
4. Accept for the pilot:
   - max instances = 1 without Redis;
   - all staff may act on all students;
   - the 192 hosted suites are not run, replaced by E1–E4.
5. The student's identity, consent and invitation delivery. The school's written course and elective list.
6. Only if needed (G): apply the legacy hotfix before the cutover.

## J. Shortest safe path

P1–P5 (read-only, today) → one session with steps 1–15. There is no staging and no new Supabase project. The read-only verification files and the smoke test give the hosted evidence. The only isolated environment used is the local disposable rehearsal, which is already done.

## K. What S13 must deliver before cutover

1. The **final release SHA** on `claude/s13-hs-first-student-pilot`, with `tsc`, `npm run build` and the focused S13 suites clean on that SHA.
2. Confirmation that S13 added no new migration after `20261029110000`. If it did, S14's order must be re-checked and `rehearse-local.sh` re-run.
3. A short operator note naming the exact admin screens for steps 8–13, if any label differs from the runbook.
4. Optional: `.replit` `[deployment] build = ["npm","run","build"]`.

## L. S14 commit

The SHA is reported in the chat closeout, because this record is part of that commit.

## Single ordered production-launch checklist

- [ ] P1 Confirm the project ref and secrets (read)
- [ ] P2 `00-baseline-probe.sql` (read) → send output
- [ ] P3 `01-account-readiness.sql` and `escaping_paths` (read)
- [ ] P4 `smoke-hosted.sh` on the old build (read)
- [ ] P5 Written curriculum, electives and student identity/consent
- [ ] S13 final SHA delivered (K)
- [ ] APPROVE-B signed
- [ ] 1 Freeze
- [ ] 2 Backup: dashboard/PITR plus `pg_dump` (data and schema) plus workspace tarball plus old deployment id
- [ ] 3 Record the release SHA
- [ ] 4 Run 10 → S05…S11 → 30 → 35, then the probe: all APPLIED
- [ ] 5 Buckets and profile repair, then `90-verify.sql`: all pass
- [ ] 6 Workspace at SHA, `npm ci && npm run build`, publish with max instances = 1
- [ ] 7 `smoke-hosted.sh`: all PASS; admin pages load
- [ ] 8 Add student
- [ ] 9 Issue the invitation and deliver it personally (authorized)
- [ ] 10 Link the account
- [ ] 11 Enroll `us-hs-diploma-21`
- [ ] 12 Core titles and 5 elective credits, exactly as the school wrote them
- [ ] 13 Publish the roadmap
- [ ] 14 Student signs in and sees the correct information
- [ ] 15 Monitor for 48 hours; keep the rollback for 14 days
