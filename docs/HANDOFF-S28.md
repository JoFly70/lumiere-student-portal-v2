# Lumière Student Portal — Engineering Handoff (S28)

You are taking over as the engineering lead for the **Lumière Student Portal**. This document is everything the
previous lead (Claude, sessions S26–S27) knew. Read it fully before changing anything. When something here conflicts
with what you see in the code, the code wins — verify, then update this file.

---

## 0. Ground rules from the owner (non-negotiable)

These were stated by the owner at different times and still apply.

**Data, privacy and confidentiality**
- The GitHub repository is **public**. It must never contain: identifiable student data, credentials/keys/tokens,
  banking information, restricted/confidential documents (the student contract, portraits, research PDFs), or the
  **name of the awarding school** (refer to it as "the awarding school" / "Awarding school" in code and copy). This
  includes tests, fixtures, docs, commit messages and grep patterns. Before every push:
  `git grep -il "<school name>"` must return nothing (keep the name out of the command history you commit, too).
- Never invent the real student's identity, school approval, official results, guardian consent or payment history.
  Never mark anything received/verified or issue a receipt without genuine evidence. The real student stays
  pre-enrollment ("lead", unpublished draft plan) until those conditions are verified.
- Demo data must be clearly synthetic: `preferred_name` starts with `DEMO-` (pattern `/^DEMO[-_ ]/i`, see
  `shared/synthetic-accounts.ts`), emails on the `.invalid` demo domain, idempotent seeding, never touching non-DEMO
  students. Demo personas never count in real totals.
- Never create unrestricted impersonation of a real student or weaken role separation. "View as student" works on
  DEMO students and on a DEMO *mirror* of the real student's scenario only; it is audited.
- Do not expose credentials in logs or code. Error logs must not include query parameters (note bodies, etc.).

**Product and design**
- **No red and no harsh colours anywhere** (not even for errors/overdue/urgent/destructive). Lumière palette only:
  ink/charcoal, ivory, warm neutrals, gold accent; muted **umber** for "needs attention", muted **sage** for "done".
  Severity is shown by icon, wording and order. Colours come from theme tokens (see §6).
- Keep the existing app shell ("ClientDesk" shell); refine interiors. Calm, premium, academic, symmetric, no dead
  space, no clipped text, EN/FR everywhere (French uses *vouvoiement*), light + dark themes, phone → wide desktop.
- The floating **Lumière orb** (round face icon with eyes) sits **bottom-left on every page** (student and staff; not
  for coaches, who have no AI). A persistent **"View as student"** button sits top-right on every student-file page
  (admins only). Demo sessions show a **"Back to staff portal"** button.

**Operations**
- Do **not** invoke the Replit AI Agent. Do **not** modify the custom domain.
- **Pre-approved release conditions:** if type checks, the full test suite, a security review of the changes and visual
  checks all pass, you may move the release marker and publish without asking. Report only genuine blockers.
- **Fix forward:** small visual issues don't block a release (log them). Security, privacy, data integrity and broken
  core flows (logging progress, documents, billing, Control Center, sign-in) DO block.
- No production database migrations, live student-data mutation, secret/provider changes or deployments **outside**
  the release process below, and nothing that bypasses the owner for the real student.
- The owner is budget-conscious and prefers: short status updates, phased releases, recommendations rather than option
  lists, and — when asked to "restate" — a numbered list (title, restated issue, fix) with no action taken.

---

## 1. Where things are

| Thing | Value |
|---|---|
| Repo | `JoFly70/lumiere-student-portal-v2` (public) |
| Development branch | `claude/s27-premium-ux-excellence` (all S27 work; fast-forwarded together with the release branch) |
| Release branch (the runner follows ONLY this) | `claude/s26-owner-and-first-student-finish` |
| Release marker | `release/S26_RELEASE_SHA` on the release branch — the ONE commit production may deploy |
| Live app | https://lumiere-student-portal-v-2.replit.app (Replit app "lumiere-student-portal-v2", Autoscale) |
| Live release at handoff | `5f1b8c8` (see `/health` → `release`) |
| Production Supabase project ref | `rheronevecsffaejteoj` (already in repo scripts) |
| Evidence package for S27 | `docs/s27-ux/` (REPORT.md, inventory, findings register, repair log, before/after screens) |

Do not use `main` as a source — it is stale. Start new work from the release branch head (both branches are equal at
handoff) on a new branch, e.g. `claude/s28-...`, and fast-forward the release branch only when releasing.

---

## 2. Stack and architecture

- **Client:** React 18 + Wouter + TanStack Query + Tailwind + shadcn/ui. Entry `client/src/App.tsx` (routes + role
  guards via `ProtectedRoute`). Staff shell + student shell share `client/src/components/app-sidebar.tsx`.
- **Server:** Express + TypeScript (`server/index.ts`, routes mounted in `server/routes.ts`), Drizzle on Postgres
  (`server/lib/db.ts`, lazy postgres-js pool; `DB_POOL_MAX` env caps a process's pool), Supabase Auth.
- **Shared contracts:** Zod schemas in `shared/*-contract.ts` (e.g. `high-school-contract.ts`, `s27-contract.ts`,
  `billing-contract.ts`, `student-roadmap-contract.ts`).
- **DB migrations:** `supabase/migrations/*.sql` (applied in production only by the release scripts, §4).
- **i18n:** `client/src/i18n/en.ts`, `fr.ts` + modules in `client/src/i18n/modules/*` (`s27.ts` student, `s27-owner.ts`
  staff, `staff.ts`, `auth.ts`, …). Parity tests: `tests/s18-i18n.test.ts`, `tests/s19-i18n-parity.test.ts` (a French
  value identical to English fails unless allow-listed with a reason).
- **Themes:** `client/src/styles/themes.css` is GENERATED by `scripts/s19/gen-portal-themes.py` — never hand-edit;
  change the generator and regenerate (`tests/s19-themes-parity.test.ts` checks byte equality). Also
  `client/src/index.css`, `client/src/styles/student-s27.css`, `student-s27-degree.css`, `owner-cockpit.css`,
  `academic-assistant.css`.
- **Tests:** vitest (`npx vitest run`, full suite ≈ 8–15 min on a slow box, ~3,750 tests). Real-Postgres harnesses in
  `tests/helpers/` (s05-local-pg, s11-hs-stack). `npx tsc --noEmit -p .` must be clean (it skips `scripts/` and
  `tests/`; type-check new script files separately if needed).

### Roles
`student`, `coach` (support desk only, no AI, no student files), `staff` (Control Center, billing, support, web
research; no admin student workspace), `admin` (everything incl. Owner AI, view-as-student, administration).

### Main feature areas (what exists)
- **Student:** Flight Deck cockpit (shared design for high-school AND bachelor's students —
  `client/src/components/s27/flight-deck.tsx`, `degree-flight-deck.tsx`, `deck-parts.tsx`, `flight-instrument.tsx`;
  router `client/src/pages/flight-deck-router.tsx`), log-first Roadmap (HS: `roadmap-log.tsx`; degree:
  `client/src/components/degree-journey/*`), Beyond the Diploma / Beyond the Bachelor's (`client/src/pages/beyond.tsx`,
  `components/s27/beyond*.tsx`), Documents, Billing, Support, Profile, Library, Lumière assistant (built-in guide for
  students — not live AI — by policy).
- Degree students are kept off high-school routes by `client/src/components/high-school-only.tsx`.
- **Staff:** Control Center (owner flight-deck cockpit: rings, fleet map, queue, Ask Lumière —
  `client/src/components/admin/control/*`), Students directory (`client/src/pages/admin-students.tsx`), student file
  with tabs (`client/src/components/admin/file/*`: overview, roadmap, documents, billing with instalments, notes &
  timeline, sessions), older "Academic workspace" (`/admin/students/:id/workspace` — duplicate view kept pending an
  owner decision), support desk, elective requests, Lumière Owner AI (`/admin/assistant`), Web research
  (`/admin/web-research`), Administration.
- **Program journey (S27 backend):** tables `student_agreements`, `student_checkpoints`, `orientation_sessions`,
  `student_staff_notes` (+ `seq`), RLS on, no client grants; services `server/services/program-journey/*`, routes
  `server/routes/program-journey.ts` (503 `S27_UNAVAILABLE` if tables missing). Same-slot session requests are
  idempotent.
- **Billing:** obligations, instalments (`setInstallments`), receipts allocated oldest-first, discounts, payment
  evidence approve/reject, void with reason. Money in integer cents; FR decimal comma parsing in
  `client/src/components/admin/billing/money.ts`.
- **Security token (CSRF):** `client/src/lib/api.ts` `freshCsrfToken()` renews the token 5 minutes before the expiry
  embedded in it; `apiRequest` retries once on a CSRF 403. All request helpers use it.

### AI
- Provider: Meta Model API, model **pinned** to `muse-spark-1.3-contributor`, host `https://api.meta.ai/v1`
  (`server/services/academic-assistant/config.ts`, `meta-adapter.ts` — `assertContributorModel` refuses anything
  else). Production secrets (names only): `META_MODEL_API_KEY`, `SPARK_ASSISTANT_ENABLED=true`,
  `SPARK_ASSISTANT_LIVE_ROLES=admin,staff`; optional `SPARK_WEB_SEARCH=off`, `SPARK_WEB_SEARCH_BUDGET_SHARE` (default
  0.5), `SPARK_ASSISTANT_MONTHLY_BUDGET_USD`.
- **Owner AI** (admin only): reads one student's records, cites `[R#]`, never writes; also cites curated "Lumière
  program guide" knowledge (`server/data/academic-assistant/knowledge.ts`, institution "Awarding school", no names or
  URLs). Live answers return `model: { requested, served }`.
- **Web research** (admin + staff): Responses API with the built-in `web_search` tool; only the typed question is sent;
  questions containing emails/phones/student codes are refused; ≤4/min/user; may only spend while the month's AI total
  is under its budget share. `server/services/web-research/service.ts`, `server/routes/admin-web-research.ts`.
- **Students:** built-in guide (local, labelled "not live AI") — live AI for students is a pending policy decision.
- Verified live on `c7a8eae` and again on `5f1b8c8`: owner AI status live, EN answer and FR draft with valid
  citations, requested AND provider-served model = `muse-spark-1.3-contributor`.

---

## 3. Demo data (production, synthetic)

Seeded by `scripts/s26/provision-demo-student.ts` → `scripts/s26/demo-cohort.ts` (+ `demo-bachelors.ts`), run by the
release runner's "provision" step on every release (idempotent; pool capped at 2 connections; takes ~2–6 min).
Personas: DEMO-S26-FR (main demo student), DEMO-S26-SECOND, DEMO-S26-P3 Amira (mid-program, has a goal → Beyond the
Diploma shows content), P4 Yanis (at risk), P5 Lina (elective change), P6 Omar (near completion), P7 Sofia (billing
scenario), DEMO-S27-P8 Karim (instalment plan), **DEMO-S27-P9 Avery (bachelor's: BS Business Administration, 120
credits, prior college 48 + workplace 12 earned, Sophia 39 + Study.com 12 planned, 9 open; residency 0/15; no
billing)**, and DEMO-MIRROR-<real code> (mirror of the real student's scenario). The real student (code
`LCA-2026-0001`) is a lead with an unpublished draft plan — leave it to the owner.

---

## 4. Release process (exactly how production changes)

Production is a Replit workspace; GitHub is the source of truth.

1. Finish work on your branch; run `npx tsc --noEmit -p .`, the full `npx vitest run`, a security review of the diff
   (independent reviewer agent is a good pattern), and visual checks (screenshots at 390/768/1440, light + dark).
2. Fast-forward the release branch to your commit, write the full SHA into `release/S26_RELEASE_SHA`, commit
   ("Release marker: … (<sha>)"), push the release branch.
3. The **owner** runs the release runner in the production Replit Shell (only they can — production secrets live
   there; your sandbox usually cannot reach the live host):
   ```bash
   curl -fsSL https://raw.githubusercontent.com/JoFly70/lumiere-student-portal-v2/claude/s26-owner-and-first-student-finish/scripts/s26/release-loop.sh | S26_RELEASE_MARKER=1 S26_LOOP_HOURS=6 bash
   ```
   It watches the marker (default window 2 h; `S26_LOOP_HOURS` extends), and for a new marker SHA: preserves the
   workspace (tags `s26-pre-sync-backup-<sha>`, stashes uncommitted tracked changes), checks out the SHA, `npm ci` +
   build, schema steps (S26 and S27; skip when already applied; S27 apply backs up with a pg_dump matching the server
   major version — production Postgres is 17.x), provisions demo data, writes `release.json`, prints
   **"ready to publish <sha>"**, then waits for the live site to serve that SHA and runs hosted acceptance.
4. Publish: with the Replit MCP tool `publish_app` (replId of "lumiere-student-portal-v2") or ask the owner to click
   **Republish**. Poll `get_publish_status` until `success`.
5. The runner then runs `scripts/s26/production-acceptance.ts` against the live site (~20 min because it paces itself
   under the server's 100 requests / 15 min limit) and writes `s26-evidence/acceptance.json`.
6. Read evidence with the Replit `read_app_file` tool: `s26-evidence/status.json` (step results),
   `s26-evidence/provision.json` (includes the DB `cause` on failure), `s26-evidence/acceptance.out` /
   `acceptance.json`. **`.log` files are not readable through that tool** — ask the owner to `tail` them if needed.

**AI-only live check** (no data writes; runs from the owner's Shell, isolated from the workspace's packages):
```bash
bash -c 'w=$PWD; d=$(mktemp -d /tmp/s27ai.XXXX) || exit 91; trap "[ -n \"$d\" ] && rm -rf \"$d\"" EXIT; cd "$d" || exit 91; curl -fsSL https://raw.githubusercontent.com/JoFly70/lumiere-student-portal-v2/<FULL_SHA>/scripts/s26/production-acceptance.ts -o acc.mts || exit 90; npm init -y >/dev/null && npm install --no-audit --no-fund --silent tsx@4.19.2 @supabase/supabase-js@2.80.0 ws@8 >/dev/null || exit 92; npx --no-install tsx acc.mts --base https://lumiere-student-portal-v-2.replit.app --ref rheronevecsffaejteoj --ai-only --out "$w/s27-ai-evidence"; exit $?'; echo "AI acceptance exit status: $?"
```
Ends with `AI: functional …; requested model …; provider-served model …`.

**Known release gotchas**
- Production Supabase session pooler allows **15 clients total**; the app uses up to 10 per instance; scripts must cap
  their pool (`DB_POOL_MAX`). `EMAXCONNSESSION` = pool exhaustion.
- The production workspace's `node_modules` is incomplete (missing `tsx`, `ws`) — the runner's `npm ci` handles
  builds, but ad-hoc `npx tsx` scripts in the workspace fail; use the isolated /tmp pattern above.
- Other agents (the owner's Replit Agent) have made local commits/stashes in the production workspace
  (preserved as tags `s26-pre-sync-backup-53856ae`, `-b2a5114`, `-ec18619`, and in `git stash`). Review with the owner;
  agree that only the runner changes the workspace.
- `/ready` reports `distributedRateLimit: false` (no `REDIS_URL`) — expected for now, but rate limits are per-instance.

---

## 5. Working method that worked well

- Phased releases; each phase ships as soon as it passes its own gates.
- Two coordinated agents: an **inspector** (read-only, renders real code with mocked synthetic APIs via Playwright,
  files findings with evidence screenshots, re-inspects merged fixes) and a **repairer** (fixes assigned findings in its
  own worktree, before/after screenshots, targeted tests). The lead routes findings, prevents file conflicts, merges,
  runs the full suite and releases. Plus an independent **security reviewer** before each release.
- Screenshot harnesses: `scripts/s27/render-student-screens.ts` (student screens with fixtures in
  `tests/helpers/s27-fixtures.ts`; `npx tsx scripts/s27/render-student-screens.ts <screens|beyond|chat|log-flow> <outDir>`,
  runs vite itself). Staff screens were captured with ad-hoc Playwright scripts that mock `/api/**` and inject auth into
  `localStorage` key `lumiere_auth` — recreate as needed (the previous session's harnesses lived in a temporary
  scratchpad and are gone).
- Chromium + Playwright are preinstalled in Claude's cloud container; in other environments install as appropriate.
- `tests/s07-acceptance-journey.test.ts` writes evidence to a temp dir unless `S07_WRITE_EVIDENCE=1`.
- Never hand-edit generated files; keep EN/FR parity; keep data-testids; no new raw hex colours.

---

## 6. Open items and backlog (prioritised)

### A. Must do before onboarding the first real student
1. **Invitations & onboarding — code DONE in S28; hosted dry run still OPEN.** Administration → Invitations
   (`client/src/components/admin/invitations-panel.tsx`): issue (EN/FR, send email or copy only), list with status
   (pending / account created / revoked / expired), resend (revokes the old code, issues a new one), copy link/code,
   revoke. Add student has an "Invite to the portal" option. Server: `GET /api/admin/invitations`,
   `POST /api/admin/invitations` (`language`, `sendEmail`), `POST /api/admin/invitations/:id/resend`, `/:id/revoke`.
   Email: `server/lib/invitation-email.ts` (branded EN/FR) via `deliverEmail` in `server/lib/email.ts` (Resend HTTP
   API). **Production configuration needed (not a code defect):** `EMAIL_ENABLED=true`, `EMAIL_FROM` (verified sender
   domain) and `RESEND_API_KEY` in production secrets. Until then the UI says "Email is not configured" and admins
   copy the link; it never claims an email was sent. The invite link is `/login?invite=<code>&lang=fr|en`.
   **Still to do:** the end-to-end dry run with an owner-controlled test address on the live site: invite → sign up
   → verify email → forgot password → first login.
2. **Real student readiness (owner-driven):** confirm the 5 estimated exam counts in the HS template
   (Health and Nutrition, Personal Finance, U.S. Government and Economics, Human Relations, Reading Skills) and catalog
   conflicts (21 vs 21.5 credits, 15 vs 16 transfer credits, 65% vs 70% pass mark — the agreement says 65%), publish
   the roadmap, set agreement dates (language test within 30 days of signing; proof of prior schooling within 90 days
   of enrollment; Lumière support 9 months from activation; school access up to 36 months; 2 free 30-min orientation
   sessions; MC retake within 30 days, higher score counts; written work redone capped at 65%; ≤15 exams/week),
   verify ID and guardian consent, then activate.
3. **Billing hardening — DONE in S28.** `requireCsrf` on every admin billing POST and router-wide on the admin router;
   the server refuses an instalment plan that does not sum to the net obligation (`BILLING_SCHEDULE_SUM_MISMATCH`) and
   any change to the date or amount of a fully paid instalment (`BILLING_PAID_INSTALLMENT_LOCKED`);
   tests `tests/s28-onboarding-http.test.ts` (real Postgres) and `tests/s28-onboarding-units.test.ts`.
   **Owner step remaining:** configure the real obligation/instalments from the contract.
4. **Production stability:** cap the app's DB pool (e.g. `DB_POOL_MAX=5` in production secrets, verify instance count)
   and add `REDIS_URL` for distributed rate limiting.
5. **Workspace hygiene:** review/clean the preserved local commits and stashes; reinstall workspace dependencies.

**S28 also added:** the official WhatsApp contact (`https://wa.me/19453917325`, Lumière's public business number) as
a card on Support and an item in the student sidebar (EN/FR; `client/src/components/support/whatsapp-contact.tsx`).
The S27 env-gated `VITE_SUPPORT_WHATSAPP` link is retired. Beyond the Diploma uses the same constant.

### B. Should do soon after
6. Staff/coach invitations with role, and two-step sign-in for admin/staff.
7. Privacy (Québec Law 25): in-portal privacy notice and terms, data access/deletion request flow, retention policy;
   keep the school name hidden from students until the owner discloses it.
8. Verify notification emails (support replies, document decisions, payment due, checkpoints) and deliverability.
9. Monitoring/alerts and a tested restore from backups.
10. Decide live AI for adult students (and the policy for minors).

### C. "Next level" roadmap (owner-approved direction; sizes in ~1-day sessions)
| Item | Sessions |
|---|---|
| Proactive reminders/nudges (email first, WhatsApp later — needs WhatsApp Business + templates), exceptions-only queue | 2–3 |
| Business dashboard & exports (revenue, collections, pipeline, completion, pace by cohort) | 1 |
| Online payments (payment links per instalment, auto-matched receipts — needs a provider account) | 2–3 |
| Guardian read-only portal + weekly summary | 2 |
| Fleet AI co-pilot for the owner (cross-student questions, bulk actions, one-click approved replies) | 2–3 |
| Live AI tutor for adult students | 2 |
| Application tracker after the diploma/bachelor's (extends Beyond) | 2 |
| Motivation touches (weekly goals, streaks, calm celebrations) | 1 |
| Integrations: CSV import of provider progress/school results + calendar sync (live connectors 3–6 more if available) | 1 (+3–6) |

### D. Known smaller gaps
- Degree data not modelled: structured finish date (only a roadmap milestone), ACE/NCCRS 63/90 transfer cap;
  degree Requirements card counts accepted credit only (planned credit shown separately); Control Center has no
  degree credit/arrival source (shows "—"); a COMPOSED degree result carrying diagnostics is rejected (engine issue).
- Older "Academic workspace" duplicates the new student file — owner decision pending.
- Repository history still contains the school's name in old commits (owner decided to leave it).
- Hosted acceptance on `5f1b8c8`: PASS 53/53 required; optional `browser.student.subjects-tab` fails because the
  student high-school page is now the log-first Roadmap (the old tabbed view lives at `/high-school?view=details`).
  Update that browser check in `scripts/s26/production-acceptance.ts` to the new Roadmap (or the details view).
- Some older staff dialogs (`billing-dialogs.tsx` ReasonDialog, ObligationPanel/EvidencePanel) still have English-only
  strings.

---

## 7. How the owner likes to work with you

- Start with a short plan; restate requests as a numbered list when asked; recommend one option.
- Keep updates brief and concrete (what's live, what's next, what you need from them — usually one Shell command).
- They run commands in the production Replit Shell when asked; give one exact, safe, copy-paste command at a time, in
  its own code block, and explain in one line why their action is needed.
- They review the live site visually and send screenshots; treat each screenshot as a defect report.
- They are allowance-conscious: avoid redundant full-suite runs and unnecessary agent rounds; batch work into one
  release where possible.

Good luck — the foundation is solid; the next leap is proactive automation, payments, family visibility and AI that
works across the whole cohort.
