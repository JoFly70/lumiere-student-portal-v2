# S22 hosted first-student journey

Status: **LOCAL ONLY. HOSTED NOT RUN.** The S22 container cannot reach Supabase or any deployed app and holds no credentials, so no step below has run against a real hosted service. Every "PASS" in this document is a local result against an in-process app on a throwaway PostgreSQL 16 with test doubles, and is labelled as such. The evidence file a real run writes says `HOSTED PASS` only if the run targeted a guarded staging deployment, every step passed, none was skipped and every backing label is REAL or NOT_USED (`scripts/s22/journey/runner.ts`, `hostedPass`).

What this delivers: the S21 23-step journey (J1 to J23) made runnable against a deployed staging app as real synthetic users, plus six S22 steps (J24 to J29), a run-scoped cleanup, and a local harness proving the logic.

| File | Role |
|---|---|
| `scripts/s22/hosted-journey.ts` | CLI (`--dry-run`, `--cleanup`, `--run-id`), guard-first, writes evidence |
| `scripts/s22/journey/steps.ts` | P0, P1, J1 to J29. No server imports; HTTP only |
| `scripts/s22/journey/types.ts` | `Target` (hosted needs the staging guard; local must be loopback), `classifyBacking`, `Ops`, `Sessions` |
| `scripts/s22/journey/http.ts` | Target-bound fetch, URL allow-list, rate governor |
| `scripts/s22/journey/hosted-ops.ts` | Hosted privileged operations (service role, database) and app-based sessions |
| `scripts/s22/journey/cleanup.ts` | Run-scoped cleanup (foreign-key walk, one transaction) |
| `scripts/s22/journey/fixtures.ts` | Valid tiny files for the 8 formats (generators from `tests/helpers/s21-attachment-fixtures.ts`) |
| `tests/s22-hosted-journey-harness.test.ts` | Runs the same steps in process and asserts the labelling is honest |

## 1. Prerequisites (all on you, none done by S22)

1. Supabase staging project created and bootstrapped, verifier green: `docs/recovery/s22/supabase-staging.md` (`staging-bootstrap.ts`, `hosted-verify.ts`). Not `rheronevecsffaejteoj` or either historical ref: the guard refuses them.
2. Staging app deployed and pointing at that project: `docs/recovery/s22/replit-staging.md`. On the staging app: `ENABLE_EMAIL_VERIFICATION=true` (J2 fails with a clear message otherwise), Supabase "Confirm email" on, and `SPARK_ASSISTANT_RATE_LIMIT_PER_MINUTE` unset (default 6; the runner paces to it).
3. First admin: not needed. The script creates its own synthetic admin, staff and student B with the service role key, tagged with the run id, and removes them with `--cleanup`.
4. An address you control for the synthetic students: `S22_TEST_INBOX=name@host` (becomes `name+s22-<run>-a@host`) or `S22_TEST_EMAIL_DOMAIN=domain`. Nothing is invented.
5. The `DATABASE_URL` role must own `assistant_messages` (J23 disables its triggers inside one transaction) and the tables touched by cleanup. The default `postgres` role of a Supabase project does.

## 2. Run

```bash
export S22_STAGING_PROJECT_REF=<ref>  S22_STAGING_CONFIRM=staging:<ref>
export APP_URL=https://<staging app>   SUPABASE_URL=https://<ref>.supabase.co
export SUPABASE_SERVICE_KEY=...        DATABASE_URL='postgresql://postgres.<ref>:...@...pooler.supabase.com:5432/postgres'
export S22_TEST_INBOX=you@example.com        # or S22_TEST_EMAIL_DOMAIN

npx tsx scripts/s22/hosted-journey.ts --dry-run          # plan only: guard result, identities, steps; makes no request
npx tsx scripts/s22/hosted-journey.ts --cleanup          # run, write evidence, then remove what the run created
npx tsx scripts/s22/hosted-journey.ts --cleanup --run-id <id> --dry-run   # preview a cleanup of an earlier run
npx tsx scripts/s22/hosted-journey.ts --cleanup --run-id <id>             # perform it
```

Exit code 0 only for `HOSTED PASS`; 1 for a failed run; 2 when the guard refuses (nothing was requested). Every printed line passes through `redact`.

**Time.** The deployed limiters are per IP: all `/api/*` 100 requests per 15 min, login 5 per 15 min, signup 3 per hour, verify-email 20 per 15 min, assistant messages 6 per minute per account (`server/middleware/rate-limit.ts:15,88,141`, assistant config). The run is about 230 paced API calls and 8 logins, so the runner's governor (`http.ts`, budgets 85 / 4 / 3 / 15 / 5, 429 `Retry-After` honoured) makes it take roughly 45 to 75 minutes; it prints each wait. The "invitation cannot be reused" check of J2 needs a fourth signup call, so it runs after the last step (signup window). Only if you have raised the limiters on staging: `S22_JOURNEY_PACE=off`.

**Output.** `docs/recovery/s22-evidence/hosted-journey-<runid>.json` (only for a real hosted run), `...manifest.json` (ids created, updated as the run goes, used by cleanup), `...cleanup.json`. Each step: `{id, title, status PASS|FAIL|SKIPPED, backing{db,auth,storage,email,app}, durationMs, detail, skippedChecks, observations, note}`. No token, password or URL with credentials is written. Send back the JSON; check with `grep -ci 'eyJ\|password' docs/recovery/s22-evidence/*.json` (expect only the word "password" inside step titles, no values).

**Cleanup scope.** Accounts are recognised by the e-mail tag `s22-<runid>-`; students by that tag or by a link to such an account; invitations by that tag; a manifest id whose database row lacks the tag is ignored. Everything below those roots is removed by walking foreign keys children-first in ONE transaction (any failure rolls back everything), with user triggers disabled only on the tables touched, and assistant conversations purged through the owner-only `assistant_purge_owner()`. Storage objects and auth users are removed afterwards. It refuses to delete more than 20,000 rows. Audit or event rows that mention the synthetic users without a foreign key are append-only by design and may remain.

## 3. How the harness is built

- **Target abstraction.** `Target` is `hosted` (only constructible through `makeHostedTarget`, which runs `assertStagingTarget({requireSupabaseUrl, requireAppUrl})`, and the CLI also validates `DATABASE_URL`) or `local-inprocess` (must be loopback). `Http` binds fetch to the target; the same step functions run against either.
- **Honest labels.** `classifyBacking(target, step.uses)`: hosted and used gives REAL; local gives LOCAL (db, app) or MOCKED (auth, storage, email) and **throws** if anything asks for REAL; unused is NOT_USED. A step cannot choose its own label.
- **Egress allow-list.** The only calls leaving the app are signed Storage URLs the app issued and direct Storage probes. Hosted: host must be `https://<ref>.supabase.co`, so a staging app wired to another Supabase project fails loudly (P0 also compares the app's `/env.js` Supabase host with the guard).
- **Privileged shortcuts** (labelled in each step's `detail.privileged`): create the synthetic admin/staff/student B auth users (P1); read `account_invitations` (J1, J2); admin `generateLink` for the verification token and admin read of email confirmation (J2, J3); flip `profiles.status` (J4); read `student_documents`, `student_billing_receipts`, `assistant_messages`, `student_hs_course_results` counts (J9, J15, J17, J20); tamper UPDATE with triggers disabled (J23); Storage list to prove rejected objects were deleted (J25); cleanup.
- **Four actors**: admin, staff, student A (created by invitation, signup, verification, login), student B (provisioned, linked to a student record, used for every isolation check).

## 4. Steps

Local = harness result on in-process app + PG16 + doubles (31 of 31 PASS, 261 HTTP requests). Hosted = NOT RUN for every row.

| Id | Verifies | Touches | Privileged | Local | Hosted |
|---|---|---|---|---|---|
| P0 | App's `/env.js` Supabase host = staging ref; `/health` ok incl. database; privileged DB reachable | app, db | DB `select 1` | PASS (wiring check skipped) | NOT RUN |
| P1 | Synthetic admin/staff/B exist, can sign in; B has a linked student record | app, auth, db | service-role user creation | PASS | NOT RUN |
| J1 | Only admin issues an invitation; only the SHA-256 hash is stored; email lower-cased | app, db | read `account_invitations` | PASS | NOT RUN |
| J2 | Signup needs a valid invitation for that email; account is unconfirmed, no session, login refused; failed provider releases the invitation (local only); reuse refused (deferred) | app, auth, db | invitation read, email-confirmed read | PASS | NOT RUN |
| J3 | Missing/wrong-type/invalid/bare tokens never verify; a provider-issued token does, not echoed; login works afterwards | app, auth | admin generateLink | PASS | NOT RUN |
| J4 | Valid token works; tampered, expired-claim, forged-issuer, alg=none, absent are 401; inactive account 403 then restored | app, auth, db | profile status flip | PASS | NOT RUN |
| J5 | Student cannot create records; staff creates A; unlinked 404; admin links | app, db | | PASS | NOT RUN |
| J6 | Enrollment `us-hs-diploma-21` v2; plan = 17 core courses = 32 half-units (16 credits) + 6 electives = 10 half-units (5 credits, two of 0.5) = 42 (21 credits); staff cannot publish, admin does; student view 42/32/10 | app, db | | PASS | NOT RUN |
| J7 | Projection before evidence: 42 required, 0 official, no graduation date | app, db | | PASS | NOT RUN |
| J8 | Reported progress is awaiting/in-progress/planned, never official | app, db | | PASS | NOT RUN |
| J9 | Real signed upload, staff rejection with student-visible reason (internal note hidden), resubmission, verification; rejected doc refused as evidence | app, db, storage | status read | PASS | NOT RUN |
| J10 | Official results: english-1 (2) + 0.5-credit elective (1) = 3 half-units, 39 remaining, buckets distinct | app, db | | PASS | NOT RUN |
| J11 | B cannot read/change A's projection, documents, billing, staff surfaces | app, db | | PASS | NOT RUN |
| J12 | Tickets, staff reply, internal note hidden, idempotent student reply (one comment) | app, db | | PASS | NOT RUN |
| J13 | Billing: 12,000.00 agreed, 2,000.00 discount, 4 installments; integer cents, no staff-only fields | app, db | | PASS | NOT RUN |
| J14 | Proof upload (real signed upload) never counts until staff confirm; exact receipt | app, db, storage | | PASS | NOT RUN |
| J15 | Void needs a reason, totals revert, evidence returns to review, one active receipt per evidence | app, db | receipt count read | PASS | NOT RUN |
| J16 | Welcome is `first` once then `returning`; attention count 0 | app, db | | PASS | NOT RUN |
| J17 | Conversation: stored, replay-safe, hash chain ok, mode `local` | app, db | message count read | PASS | NOT RUN |
| J18 | Own document attachable; another student's document refused (B's is a real upload) | app, db, storage | | PASS | NOT RUN |
| J19 | Real logout, fresh login: history, attachment reference, integrity intact; old-token status recorded as an observation | app, db, auth | | PASS (logout mocked) | NOT RUN |
| J20 | Memory is student-reported with a source; later question cites the earlier discussion; official records unchanged | app, db | course-results count read | PASS | NOT RUN |
| J21 | Global search per role (student sees own, staff sees students only) | app, db | | PASS | NOT RUN |
| J22 | B cannot list/read/post/search/attach into A's conversations, memory, documents | app, db | | PASS | NOT RUN |
| J23 | Direct SQL edit of a stored message (triggers disabled in one transaction) is detected by the integrity check | app, db | tamper UPDATE | PASS | NOT RUN |
| J24 | 8 formats (pdf, docx, xlsx, csv, txt, jpg, png, webp): upload-url, PUT, finalize, stored mime/size/extraction, signed URL fetched and **byte-compared** (SHA-256), extracted text searchable, quota grows, 5 + 3 attachments in messages, 6 refused | app, db, auth, storage | | PASS (storage double) | NOT RUN |
| J25 | Rejected: exe renamed .pdf, png named .jpg, text named .docx (415, object deleted from Storage), oversize pdf/image (413), mime mismatch, .exe, double extension, traversal name, zero bytes, forged/never-uploaded/traversal storage path, Documents route cannot mint `chat_attachment`, no auth 401, no CSRF 403; no document or quota change | app, db, storage | Storage list | PASS | NOT RUN |
| J26 | Profile photo png: signed URL byte-identical, also via `/api/students/me`, `welcome.photo`; replacement (webp) byte-identical and old object not downloadable; jpeg; svg/jpeg-as-png 400, 5 MB+1 refused, B 403, anon 401 | app, db, storage | | PASS | NOT RUN |
| J27 | B gets no signed URL or path for any of A's 8 attachments, verified document, photo; cannot finalize A's path or attach A's file; **direct Storage**: anonymous public URL, B's token on object/authenticated endpoints, B listing and writing A's prefix all fail; control download by A succeeds | app, db, auth, storage | | PASS minus direct probes (skipped, listed) | NOT RUN |
| J28 | Memory correction (new version, old superseded) and retraction persist across logout/login; retracted/superseded memory not cited; B gets 404; official credit unchanged | app, db, auth | | PASS | NOT RUN |
| J29 | After logout/login: both conversations listed, order/attachments (5 + 3) intact, attachment bytes identical, integrity ok, J23's tamper still flagged, chat continues on the same chain (seq 5, integrity over 6) | app, db, auth, storage | | PASS | NOT RUN |

## 5. Service matrix

| Service | Real now | Simulated now (local harness) | Will be real on a hosted run |
|---|---|---|---|
| Database | nothing hosted | Throwaway PostgreSQL 16, all migrations, real SQL and real route code; Supabase PostgREST reached through test shims | Staging Supabase Postgres, through the deployed app and `DATABASE_URL` |
| Auth | nothing | Local JWT verified by the real middleware; sign-in, signup provider, verifyOtp, account status doubled; logout is a stub | Supabase Auth: signup (admin createUser), login, JWT validation, session revocation, generateLink |
| Storage | nothing | In-memory object store with signed upload/download URLs served by the same process (moves real bytes) | Supabase Storage private buckets: signed upload/download, deletion of rejected objects, direct-access denial |
| Email | nothing | Doubled | Not machine-verified even hosted (label stays NOT_USED); see manual checks |
| App | nothing | The production `registerRoutes` in process | The deployed Replit staging build, including its limiters, CSRF and proxy |

Local result of the harness test (`npx vitest run tests/s22-hosted-journey-harness.test.ts`): 16 tests pass. The evidence of the in-process run says `LOCAL ONLY - NOT A HOSTED RESULT`, zero REAL labels, db/app LOCAL, auth/storage MOCKED, email NOT_USED. Three mutation tests prove the assertions have teeth: aliasing B's token to A's fails J11; corrupting Storage bytes fails J24; keeping a rejected object fails J25. Other tests: classifier cannot return REAL locally, hosted target refuses production origin / production ref / missing confirmation, egress allow-list, rate governor on a fake clock, identity generation, `--dry-run` and a refused run make no `fetch` call, step failure is reported with later steps SKIPPED and secrets redacted, cleanup (dry run, then real: only the run's rows, objects and auth users; an unrelated row survives; triggers re-enabled; second run is a no-op).

## 6. Not exercised locally (hosted only)

- Real Supabase Auth, Storage and PostgREST behaviour; real signed-URL hosts; the deployed limiters (the governor is proved only on a fake clock).
- J27 direct Storage probes; J25 deletion of the rejected object on real Storage; J26 old signed URL after replacement on real Storage.
- J2 provider-failure release; real `/api/auth/logout` and whether the old token is then rejected (J19, J29 record `oldTokenAfterLogout` as an observation, not an assertion).
- J23 needs the table-owner role on the real database. Cleanup on Supabase needs the same.

## 7. Assumptions to confirm on the first hosted run

1. J3 verifies with a `magiclink` hashed token sent as `type: "email"` (then `"signup"`); if GoTrue refuses it the step FAILs with the types tried. The app's `verify-email` accepts only those two types.
2. The signed upload accepts a raw `PUT` with the file as body (the app's own client does this); a hosted failure here would be a real client bug.
3. `ssl: 'require'` and `prepare: false` for the pooler connection in `hosted-ops.ts`.
4. `public.users.id` is varchar and `profiles.status` enum has `inactive` (assumed from migrations).
5. Staging `ENABLE_EMAIL_VERIFICATION=true`.

## 8. Manual checks that stay manual

These are also written into every evidence file (`manualChecks`): e-mail receipt and sender/link host; natural token expiry; browser/SPA/TLS; provider-failure behaviour.
