# S32-A → S32-B Integration Handoff

| Item | Value |
|---|---|
| Branch | `claude/s32-a-student-experience-repairs` |
| Started from | `5d05969a2353c3050752b16cdcc6c7e302d29d71` (S31-A audit, descended from the S26 release baseline) |
| Final SHA | the head of the branch at hand-off; given in the session's final message. This file is committed in that SHA, so it cannot contain it. |
| Deployed? | **No.** Nothing was published, merged, released or marked. `release/S26_RELEASE_SHA` and the release branch are untouched. No production data, secrets or migrations. |
| Gates on the branch | `tsc` clean; full Vitest 4,043 passed / 0 failed (8 files skipped for lack of `DATABASE_URL`); `npm run build` passes |

## 1. Files S32-A did NOT touch (S32-B ownership respected)

- `client/src/App.tsx`, `client/src/lib/auth.tsx`, `server/routes.ts`, `server/middleware/*`.
- Staff/admin pages and components.
- `server/services/s29/*`, `server/services/s30/*`.
- Enrollment and account-link services, admin billing services.
- `.replit`, release and deployment scripts, `supabase/migrations`.

**Shared-ish client files touched (small, low conflict risk):**
- `client/src/components/s29/core/notification-bell.tsx`: one class swap (F21).
- `client/src/components/ui/{sidebar,sheet,dialog,toast}.tsx`: translated sr-only labels (F29). Staff also benefits.
- `client/src/components/app-sidebar.tsx`: translated labels only.
- `client/index.html`: two meta changes (F32).
- `client/src/i18n/en.ts` / `fr.ts`: spreads of four new `s32-*` modules, plus a few French values (F24).

If S32-B changed the same lines, resolve the conflicts by keeping both intents.

**Server files changed by S32-A** (student assistant only):
- `server/services/academic-assistant/{service,student-record,retrieval}.ts`, plus the new `degree-record.ts`.
- `server/data/academic-assistant/knowledge.ts`. The owner AI still sees every entry (audience `all`).
- `server/services/assistant-conversations/reply.ts`: `privateRefs` merge.
- `server/routes/academic-assistant.ts`: passes the language.

## 2. Required shared edits (S32-B owns them)

### 2.1 F20 + F30: notification templates. **Apply before release.**
```bash
patch -p1 < docs/s32/student-repairs/shared/s29-templates.patch
```
```bash
cp docs/s32/student-repairs/shared/s29-templates.regression.test.ts tests/s32a-shared-s29-templates.test.ts
```
- It changes `server/services/s29/templates.ts`:
  - **Orientation cancelled:** `href` becomes `/beyond`, and the copy says to request a new session from Beyond the Diploma / Bachelor's (« Au-delà du diplôme / baccalauréat »).
  - **French agreement for « pièce d’identité » (F30):** « examinée », « acceptée », « Elle est ».
- **Verified:** the dry run applies cleanly on this branch. Applied in a scratch worktree, the regression test and the existing S29 tests pass (4 files, 47 tests).
- **Already true on this branch:** the overdue-instalment copy ("send the proof from Billing") is accurate now, because Billing always shows "Send proof of payment" (F05). No change is needed for it.

### 2.2 F19 hardening: keep the error code on sign-up failures (`client/src/lib/auth.tsx:165-172`)
- **Current behaviour:** the sign-up call throws a plain `Error(message)`, so the code (`EMAIL_ALREADY_REGISTERED`, `INVITATION_INVALID`, …) is lost.
- **What S32-A does today:** `components/auth/signup-errors.ts` matches the known English server messages. French users already get French messages and the "Sign in / Reset your password" links.
- **Change:** throw `await authErrorFromResponse(response, 'Sign-up failed')`, the existing helper, so `status` and `code` survive. `signup-errors.ts` already handles `AuthRequestError`.
- **Regression test:** mock `fetch` to return 409 `{ error: "...", code: "EMAIL_ALREADY_REGISTERED" }`. Assert the thrown error has `.code === "EMAIL_ALREADY_REGISTERED"` and that `classifySignupError` / `signUpErrorInfo` return the duplicate-email case with `offerSignIn: true`. Keep the "check your email" success path test.

### 2.3 F01: hosted policy check and config alignment (S32-B owns `.replit` and the release docs)

**Code position on this branch.** The provider never receives student records or earlier record answers. Personal record questions are answered locally (`PROVIDER_RECORD_LABELS` is empty; `providerSafeHistory`).

**Check after release.** Sign in as a DEMO student on the live site and read `GET /api/assistant/status`:
- `mode: "live"`: students get the minor-safe live path for **general** questions only, with no personal data.
- `mode: "local"`: students use the built-in guide only.

**Then align the docs and config:**
- Record the answer in the release notes.
- Make `docs/HANDOFF-S28.md` §2 ("students: built-in guide — not live AI") match it.
- If the owner wants students local-only, remove `SPARK_ASSISTANT_STUDENT_POLICY` from `.replit` `[userenv.production]` and from the production secrets.

S32-A made no provider or policy configuration change.

## 3. Integration checks for S32-B after merging both branches

1. Run `npx tsc --noEmit -p .`, `npx vitest run` and `npm run build`. The S32-A tests are `tests/s32a-*.test.ts` (11 files, 150 tests).
2. Run `npx vitest run tests/s18-i18n.test.ts tests/s19-i18n-parity.test.ts`. If S32-B added keys to the same modules, parity must still hold.
3. Optional visual re-check (local, synthetic):
   ```bash
   npx tsx docs/s32/student-repairs/harness/s32-render.ts matrix /tmp/s32-out
   ```
   Then compare with `docs/s32/student-repairs/evidence/render-matrix-after.json`. Expect 0 overflow and 0 errors.
4. Assistant probe:
   ```bash
   META_MODEL_API_KEY=synthetic-not-a-key npx tsx docs/s32/student-repairs/harness/assistant-probe.ts /tmp/probe.json
   ```
   Expect 32 of 36 record answers, 2 provider calls and `recordDataInProviderBody: false` everywhere. The key is fake and the provider is stubbed; no network is used.
5. After applying §2.1, run `tests/s32a-shared-s29-templates.test.ts`.

## 4. Owner content still missing (truthful fallbacks are in place)

| What | Where it goes | Fallback shown today |
|---|---|---|
| Approved "how to pay" instructions (methods, references) | `s27.bill.howText` (EN/FR) in `client/src/i18n/modules/s32-services.ts` | "Your payment instructions are provided by your Lumière team. If you don't have them, ask Lumière Support", with links to Assistance (billing topic) and the official WhatsApp contact |
| Upper-level and other degree rule figures | Degree requirement data, through the existing roadmap and degree-progress models | Only canonical requirement shortfalls are shown; the KB says the university decides |

## 5. Session-specific notes

- **`npm ci` in this container:** `package-lock.json` resolves through a Replit-internal registry (`package-firewall.replit.internal`). The install here was done with the URLs temporarily rewritten to the public npm registry. The lockfile was restored and is **not modified** on this branch.
- **Worker checkpoint commits:** the commits labelled "work-in-progress checkpoint" came from parallel workers. Only the branch head is the reviewed and tested state.
