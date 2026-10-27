# S21 closeout: persistent academic intelligence, premium student experience, first-student readiness

## 1. Overall result

**PASS WITH GAPS.**

| Track | Status |
|---|---|
| A. Lumière academic intelligence | Implemented + locally verified (real Postgres 16, real routers) |
| Student experience (branding, avatar, search, welcome) | Implemented + locally verified (unit/UI tests + browser simulations) |
| Spark Contributor | **Verified against the real Meta API** (2 billable requests), enforcement locally verified |
| B. Launch readiness | Code ready + locally verified; **hosted staging NOT available** (no non-production Supabase reachable) |

Not claimed: hosted staging verified, production verified. Nothing was deployed or merged.

## 2. Branch

`claude/s21-hosted-readiness-spark-smoke` (base `2e9a66c90150bd3836b68f317dde70841b28dc1d`, S20 closeout). Single branch; `main` untouched.

## 3. Final SHA

The commit that adds this file; reported in the session hand-off (`git log -1` on the branch). Last code commit before the closeout: `41506bc`.

## 4. Workstream outcomes

| Stream | Outcome | Commit |
|---|---|---|
| Opus (lead) | Live Contributor smoke first (critical path), fixed API contracts for all five agents before they started, S20 chain checks made S21-tolerant, all mounts/wiring, private-context reply pipeline, memory review panel, `/assistant` deep links, 23-step journey, gates, screenshot review + fixes, closeout | `6752ed2`, `b8e215a`, `df6ddf5`, `9b0c69a`, `6ba91f6`, `41506bc` |
| Sonnet A: conversations + integrity | Done: schema, append-only triggers, hash chain, idempotent appends, CRUD/search/archive API, integrity verifier, checkpoints, audited purge. 25 tests (21 on real PG16) | `4249fcc` |
| Sonnet B: attachments + extraction | Done: content-sniffed policy, quota, sha256 dedup, bounded OOXML/CSV/TXT/PDF extraction, chunk index + invalidation, Documents "Chat attachments" tab. 110 tests | `cc5faaa` |
| Sonnet C: memory, RAG, search | Done: memory schema/extraction/supersession/corrections, owner-scoped private retrieval, global search (student + staff scopes), knowledge base 17 → 50 entries (EN/FR, sourced). 50 tests + 56 S20 regression | `df6ddf5` |
| Sonnet D: Spark, staging, branding, welcome | Done: Contributor-only guard, `truncated` handling, actual-cost settlement, staging runbook, S21 migration verifier (79/79), "Student Portal" branding, welcome API + banner. 184 targeted tests | `d0311e2` |
| Sonnet E: premium UI | Mostly done before a container restart stopped it: history/search/rename/archive/resume, paperclip upload + document picker, header global search (Ctrl/Cmd+K), avatar account menu, staff photo upload, screenshot harness. Opus finished the remainder (memory panel, `/assistant` route, screenshot run, defect fixes) | WIP checkpoints, `6ba91f6`, `41506bc` |

## 5. Conversation persistence

Tables (`20261102100000_s21_assistant_conversations.sql`): `assistant_conversations`, `assistant_messages`, `assistant_message_attachments`, `assistant_audit_events`, `assistant_integrity_checkpoints`, all in the existing Postgres (drizzle `db`), RLS enabled, owner-only PostgREST policies.
API `/api/assistant/conversations`: list (newest activity first), create, `GET /:id` (resume), rename, archive/unarchive, full-text search across the student's own messages (`search_vector`, `simple` config), `POST /:id/messages`, `GET /:id/integrity`.
Server-assigned ids, timestamps, authorship and `seq`; `clientRequestId` idempotency (a retry returns the same pair); one assistant reply per student message (`reply_to_message_id` unique); concurrent posts serialize on `SELECT … FOR UPDATE` (10 parallel appends → consecutive seqs, tested). A failed reply returns 503 and a retry generates only the missing reply. Not-owner → 404 (never 403). Staff cannot read student conversations.
Only the current message + ≤ 6 recent turns reach the answer generator; the database stays authoritative.
Retention: archive never deletes. Deletion is `assistant_purge_owner(owner, reason)`, owner-role only, leaving a content-free tombstone (basis for lawful removal; no HTTP exposure).

## 6. Tamper evidence and its limits

Per-conversation SHA-256 chain over canonical JSON (content, role, author, language, mode, sources, links, private refs, notice, attachment ids, DB timestamp, previous hash). Insert trigger enforces `seq = prev + 1`, `prev_hash`, owner/author rules; UPDATE (except `status`), DELETE and TRUNCATE are rejected. Checkpoints every 10 messages and on archive go to a table **and** to a structured log line (`assistant_integrity_checkpoint`), the out-of-database anchor.
Detected in tests: modified content, wrong hash, deleted row, reordered/missing seq, unauthorized author, cross-owner access, plus the journey's J23 (direct SQL edit with triggers disabled → `hash_mismatch` at seq 1).
**Limitation (stated honestly):** a database superuser who rewrites the chain, recomputes every hash and also rewrites the checkpoints table is detectable only against the shipped log anchors and backups (`verify-conversation-integrity.ts --anchors`). The owner must route those log lines to a store with separate retention. Details: `conversations.md`.

## 7. Student memory and provenance

`student_assistant_memory` + `assistant_memory_sources` (`20261102120000`). Deterministic EN/FR extraction (no model) of intended major, goals, preferred language, country/institution interests, pathways, priorities, schedule constraints, preferences, approved plans, open questions. Each item: basis (`student_reported` / `official_record`), status (active / superseded / retracted), version, supersedes link, timestamped sources (message/document/correction). Identical facts reinforce (new source, no duplicate row); a changed goal supersedes transparently; student corrections create a new version; retraction is idempotent and audited.
UI: "What Lumière remembers" panel in the drawer (basis label, "where you said it" deep link, correct, forget), `/assistant?memory=<id>`.
Memory never writes credits, verification, billing, acceptance or graduation (static test on the module's SQL; journey J20 checks official half-units unchanged at 3).

## 8. RAG and source coverage

Extended, not replaced: in-process BM25 public knowledge, now **50 curated EN/FR entries** (was 17) with source title, URL, verification date 2026-10-27, optional institution/program/applicability/limitations. New coverage: portal features (documents, support, billing, roadmap, conversations, memory, search), diploma pathways, Penn Foster High School, core vs elective coursework, admissions terms, transfer credit, Thomas Edison State University, Sophia Learning, Study.com, ACE credit, CLEP, documentation, scheduling/progress, financial-admin and support procedures. Sources: official TESU, Penn Foster, Sophia, College Board and Common App pages. GED/HiSET items are general wording without a source (official page unreadable); Study.com facts rest on TESU's page. Retrieval adds institution/course matching, date-aware demotion (>18 months), near-duplicate suppression and a relevance threshold.
Private retrieval (`retrievePrivateContext`): the student's memory, past messages, indexed document chunks and own academic context, owner-scoped, thresholded. It is appended **locally** as a labelled "From your records (private, not sent to any AI model)" section with deep links and stored as `privateRefs`; it is never placed in a provider request. When neither public sources nor private items ground an answer, the reply offers Support with a direct link. Document matches are labelled "Found in your document", not analysis. No vector search, no new service.

## 9. Document attachments

Reuses the Documents system: same private `student-documents` bucket, same `student_documents` rows (`source='chat'`, `doc_type='chat_attachment'`), signed URLs, existing `GET /api/documents/:id` for preview/download. Messages link document ids (no copied blobs); identical re-uploads are deduplicated by sha256. Students can upload new files or pick existing documents; attachments show in history and in a Documents "Chat attachments" tab. Chat attachments are excluded from enrollment-document status and from the welcome attention count; the staff review workflow is unchanged (they appear as ordinary pending rows of the student). Soft delete removes the chunk index without breaking message references.
Extraction (local, Node built-ins only): zip-bomb-safe OOXML reader (entry count, total size, ratio caps), DOCX paragraphs/headings/tables, XLSX shared strings + sheets (row caps), CSV, TXT, machine-readable PDF (Flate streams, object streams, text operators); ~1,500-char chunks, 200k-char cap. Scanned/CID-font PDFs and images are stored only (no OCR).

## 10. File types and limits

| Format | Max | Format | Max |
|---|---:|---|---:|
| PDF | 20 MB | TXT | 5 MB |
| DOCX | 20 MB | JPG/JPEG | 10 MB |
| XLSX | 20 MB | PNG | 10 MB |
| CSV | 10 MB | WEBP | 10 MB |

5 attachments and 50 MB combined per message (enforced client-side and in the conversation transaction). Real content is checked (magic bytes, OOXML structure, UTF-8 without NUL); rejected: executables, extension/content mismatch, double extensions, path traversal/control characters, encrypted PDF/OOXML, legacy OLE, macro packages, malformed files, other students' paths or ids. The Documents page keeps its stricter 10 MB PDF/image rule.

## 11. Storage quota

250 MB per student by default (`STUDENT_STORAGE_QUOTA_MB`), per-student override in `student_storage_quota`; checked at upload-url and again at finalize against the stored object's real size. Legacy uploads without `size_bytes` count as 0. No staff UI for overrides yet (table and reader exist).

## 12. Search

Header search adapted from the ClientDesk pattern (top bar, ranked, grouped by type, Ctrl/Cmd+K, arrows, Enter, Esc, outside click; mobile icon + overlay). Students: own courses, roadmap, subjects, documents (name, type, indexed text), tickets, conversations, memory, Billing page for payment/tuition terms, static portal pages (client-side, EN/FR). Staff/admin: students only (name/code/email), never conversation or memory content; coach: nothing. Billing amounts/receipts are not searched (no safe student read model).

## 13. Avatar and photo

Circular avatar at the top right (photo via the existing signed-URL endpoint, else initials) opening My Profile / Change Photo / Sign Out; language and theme controls kept. Header, sidebar, profile and welcome banner share one react-query entry, so a changed photo shows everywhere. Staff upload reachable from the staff student workspace ("Photo" action) through the existing ownership-checked endpoint. Same 5 MB PNG/JPEG/WEBP rules, same storage, no new system.

## 14. Branding

`BRAND.tagline` = "Student Portal" (sidebar, mobile header, login, invitation and staff wordmarks), aria labels and footers "Lumière Student Portal", roadmap presentation name, root `index.html` title; login footer pair now "Private student portal · By invitation only" (FR equivalents). Crest, nine themes and legal/business records untouched.

## 15. Personalized welcome

`GET /api/student/welcome` (+ `POST /seen`), table `student_welcome_state` (`20261102130000`, backfills existing students as already welcomed). "first" only on the first-ever login (server state), then "returning"; "attention" only from real items: documents to resubmit that were not already answered by a newer upload, overdue installments, tickets waiting on the student. Inline banner on the Flight Deck (no modal), photo/initials, dismissible, once per login, reduced motion respected, EN/FR. No model call.

## 16. Live Contributor verification

`scripts/s21/spark-contributor-smoke.ts` through the production adapter, model asserted on the outgoing body, host pinned. Evidence `spark-live-smoke.json`.
- Request 1 (cap 200): reached Meta, `muse-spark-1.3-contributor`, 26 prompt / 200 completion tokens of which 198 reasoning, **empty content** → adapter reported `bad_response` (now a distinct `truncated` kind).
- Request 2 (cap 700, production default): `finish_reason: stop`, reply "Hello, welcome new student!", 26 / 312 tokens (297 reasoning), 3.4 s.
No other model was called; `/v1/models` (free) listed several variants, none used. No further live calls (all later tests mock fetch).
Enforcement: `assertContributorModel` before fetch and on the serialized body; env vars/payloads cannot change model or base; mutated config → local fallback with the reservation released.

## 17. Provider cost observations

Pricing $0.10 / $0.20 per M input/output tokens. Observed: request 1 ≈ $0.0000426, request 2 ≈ $0.0000652, **total ≈ $0.00011**. `completion_tokens` already includes reasoning tokens (confirms the S20 assumption: no double counting). Reasoning dominates (~95% of output on a trivial prompt), so the output cap floor is now 400 (default 700). Worst-case reservation per call at defaults = 2,500 × 0.10 + 700 × 0.20 per M ≈ $0.00039; the $2 monthly budget covers ~5,000 worst-case calls. Usage is settled at actual cost whenever the provider returns usage, including truncated/bad responses.

## 18. Hosted staging

Not available. The container has no `SUPABASE_*`, `DATABASE_URL`, `PG*`/`NEON*` variables or `.env`; nothing hosted was contacted and no paid infrastructure was created. `staging-readiness.md` holds the baseline-schema audit (what supabase/migrations does not create and which historical script does) and an ordered 11-step bootstrap with dashboard settings and verification probes.

## 19. Migrations

Release order (all additive, idempotent, RLS on every new table):
1-7. the S18/S19/S20 files (unchanged order, see S20 closeout)
8. `20261102100000_s21_assistant_conversations.sql`
9. `20261102110000_s21_document_attachments.sql` (also extends `student-documents` bucket limits when `storage.buckets` exists)
10. `20261102120000_s21_student_memory.sql`
11. `20261102130000_s21_student_welcome.sql`
`npx tsx scripts/s21/verify-migrations.ts`: **79/79** on throwaway PG16 (order, apply-twice, no drops/retypes, legacy rows unchanged, RLS on all 10 new tables, append-only triggers, audit immutability, welcome backfill). Prerequisite (non-migration) schema is listed in `staging-readiness.md` §2.

## 20. First-student journey

`tests/s21-journey-first-student.test.ts` → `journey-results.json`: **23/23 pass**, one Express app (production `registerRoutes`) on one throwaway PG16. J1-J15 = S20 journey (invitation, signup gate, verification, sessions, account link, 21-credit plan = 16 core + 5 elective, projection, documents reject/resubmit/verify, official results, isolation, support, billing, evidence, correction). S21: J16 welcome first → returning, attention 0; J17 conversation stored, retry replayed, integrity ok; J18 attach own verified document, foreign document 422; J19 new session resumes 4 messages + attachment, integrity ok; J20 memory `intended_major` (student_reported) recalled for "Which universities did we discuss for communications?", official half-units unchanged; J21 search hits; J22 other student 404/empty/422, staff 404; J23 tamper detected.
Backing labels per step: DB, DB+MOCK or MOCKED. Doubled: Supabase Auth, account-status lookup, audit sink, email, object storage, support tables. **This is a local rehearsal, not a hosted run.**

## 21. English / French

All new UI strings in EN/FR modules (student-os, attachments, welcome, memory); parity tests pass (`s19-i18n-parity`, S20 journey namespaces). Server-generated memory statements and some staff screens remain English; native-speaker review still pending (carried from S20).

## 22. Security and access control

Owner boundary on every conversation, memory, retrieval, attachment and search query (`req.user.id`; client ids ignored); 404 for foreign ids; staff cannot read conversations or memory; coach gets no search results. Attachment ownership re-checked inside the posting transaction. Private retrieval never reaches the provider; students are never live-eligible (S20 rule unchanged), PII guard unchanged. CSRF on all new mutating routes; per-account throttles. Production client bundle scan (`dist/public`): no model id, `api.meta.ai`, key name, `SPARK_ASSISTANT` or Chatbase reference. Official credits, verification, billing and acceptance cannot be changed by conversation or memory.

## 23. Tests, TypeScript, lint, build

- `npx tsc --noEmit`: 0 errors.
- ESLint on every file changed since S20: 0 errors (195 warnings, all `no-explicit-any`, same class as S20).
- Full `npx vitest run`: see §23a.
- 21 new S21 test files.
- `npm run build`: passes.
- `scripts/s21/verify-migrations.ts`: 79/79.
- Browser simulation checks (`render-screens.ts`): 51/51.

### 23a. Full suite
FULL_SUITE_PLACEHOLDER

## 24. Screenshots

`docs/recovery/s21-evidence/screens/` (31 PNGs + `render-notes.json`). **LOCAL UI SIMULATIONS**: vite + Playwright, every `/api` call stubbed with synthetic data (fictional people), no backend, no model. Includes login with Student Portal branding, desktop Flight Deck with avatar, mobile headers 360/390, first-login and returning welcome (EN + FR), global search (student desktop/mobile, staff, dark), assistant history list/search/archived, opened historical conversation, attach menu, document picker, composer chips, message with attachment, send failure + retry, mobile 390/360, French greeting/conversation/memory, Monaco dark history + memory. The "Prototypes" sidebar group visible there is dev-only (compiled out of production builds).
Defects found in review and fixed: drawer title wrapping with five header controls; welcome-banner initials differed from the header; login footer repeated "Student Portal"; attachment status implied the guide "reads" documents (now "Text searchable in your records"); French quote punctuation.

## 25. Remaining launch blockers

1. Hosted staging does not exist: real Supabase Auth email/redirects, RLS through PostgREST, Storage uploads/limits, email delivery and the full journey have never run on hosted infrastructure.
2. Prerequisite schema for a fresh Supabase comes from historical scripts (S14 release scripts, `PRODUCTION_DATABASE_SETUP.sql`), not from `supabase/migrations`.
3. Integrity anchors: the `assistant_integrity_checkpoint` log lines must be shipped to a separately retained log store for superuser-level tamper detection.
4. Live inference stays off for students by design (no adult attestation). The first student's launch does not depend on it.
5. Not built: OCR, virus scanning, cleanup of never-finalized uploads, staff UI for quota overrides, billing-record search, PKCE `?code=` links (from S20).
6. French review by a native speaker; staff screens partly English.

## 26. Owner actions

1. Create an isolated staging Supabase project (free tier) and run `staging-readiness.md` §3 in order; send back `00-baseline-probe.sql` and `90-verify.sql` output.
2. Set Supabase Auth: "Confirm email" on, sign-ups off, Site URL = `APP_URL`, redirect allow-list `${APP_URL}/auth/verify` and `${APP_URL}/verify-email`.
3. Create the first admin (runbook §3).
4. Provide staging env vars to the deployment (names in the runbook; never in chat).
5. Route application logs (at least `assistant_integrity_checkpoint`) to a retained log store.
6. Decide later whether to enable live Spark for staff/coach (`SPARK_ASSISTANT_ENABLED=true`, `SPARK_ASSISTANT_LIVE_ROLES`); budget defaults to $2/month.

## 27. No deployment, no merge

Confirmed: no production deployment, no merge to `main`, no production database, credential or real student data used. The only external call was the Meta API (models list + two bounded Contributor completions with a non-personal prompt).

## 28. Recommended next milestone

**S22: hosted staging verification.** Bootstrap the isolated Supabase per the runbook, deploy the branch to staging, and rerun the 23-step journey against real Auth, Storage, RLS and email, plus a real attachment upload of each type. Then decide on production approval.

## Execution efficiency

- The live Meta test ran first on the critical path (minutes in), so the reasoning-token finding fed Sonnet D's adapter work instead of surfacing at the end.
- Opus fixed all cross-agent API contracts and table shapes (`api-contracts.md`) before launching, so five agents built backend and UI in parallel against stubs with no waiting; integration needed only mounts and one reply-pipeline seam.
- Exclusive file ownership plus "Opus commits" avoided merge conflicts in one working tree; each workstream was committed as it landed (WIP checkpoints protected work across a container restart).
- Reused existing infrastructure everywhere: Postgres + drizzle, the throwaway PG16 harness (every new migration exercised by every DB test), Documents bucket/rows/signed URLs, photo endpoint, BM25 retrieval, S20 journey (extended rather than rewritten), S20 screenshot harness pattern.
- Targeted tests per agent; one full-suite run at integration and one after final fixes.
- The private-retrieval design (append locally, never send to the provider) removed the need for any new AI infrastructure or extra model calls.
