# S22 lumiereportal.app cutover runbook

Moves `https://lumiereportal.app` to the new V2 deployment. **Owner executes every step; nothing here was performed or verified from the build container** (it cannot reach lumiereportal.app, replit.app or Supabase). Do not start until the approval gate (section 9) is signed.

## 0. What is known, what is not

Known (Opus, read-only):
* The V2 Repl `lumiere-student-portal-v2` has a published Autoscale deployment at `https://lumiere-student-portal-v-2.replit.app`. The Replit agent says `lumiereportal.app` is **not** linked to it.
* `lumiereportal.app` currently serves an **older public marketing landing page** (footer "(c) Lumiere College Accelerator", public "Create account" signup modal; the fetched copy may be cached from 2026-04). V2 signup is invitation-only, so this is a different application.
* Of the four Repls the connector can see (`lumiere-student-portal-v2`, `MockPortalNode`, `StudyGenExcel`, `QuickBooker`) none shows the domain.

Not known: **who hosts lumiereportal.app today** (another Replit deployment in a workspace/account the connector cannot see, or an external host such as Netlify/Vercel/GitHub Pages) and who controls its DNS. Section 1 determines it.

Replit custom-domain facts (docs.replit.com/references/publishing/custom-domains, as relayed by Opus): connect in **Publishing, Domains**. External registrar: one **A record** plus one `replit-verify=` **TXT record**; the TXT must stay permanently (certificate renewal depends on it). **Cloudflare proxying is not supported** (DNS-only/grey cloud). No AAAA record. `www` is linked separately; wildcards unsupported. If the domain is already linked to another of the owner's projects, Replit warns and offers to **move** it. Replit-purchased domains are managed in Tools, Domains. Shutting down a deployment removes its custom-domain links. Not verified (check at the time): exact certificate issuance time (Replit does not publish one; plan for minutes, allow up to a few hours, tied to DNS propagation) and whether a domain can be on two deployments (assume **no**).

## 1. Determine the current owner (read-only)

1. From the owner's machine: `dig +short A lumiereportal.app`, `dig +short A www.lumiereportal.app`, `dig +short CNAME www.lumiereportal.app`, `dig +short TXT lumiereportal.app`, `dig +short NS lumiereportal.app`, `whois lumiereportal.app` (registrar). Save the output; this is the rollback record.
2. Interpretation: a `replit-verify=` TXT and an A record pointing to a Replit IP means a Replit deployment owns it; Netlify (`75.2.60.5`, `*.netlify.app` CNAME), Vercel (`76.76.21.21`, `cname.vercel-dns.com`), GitHub Pages (`185.199.108-111.153`) identify other hosts. Do not guess: compare with the host's own dashboard.
3. If Replit: in **every** Replit workspace/account the owner (or the person who built the landing page) uses, open each Repl, Publishing, Domains/Settings and look for `lumiereportal.app`. Also search Gmail for "replit" + "lumiereportal" (domain purchase/verification mail) if helpful.
4. Record: current host, account, DNS provider/registrar, who can log in to each. If nobody can log in to the current host, section 3 option C applies.

## 2. Decide the old site's fate

The old landing page has a public "Create account" modal; V2 is invitation-only. After cutover the old page disappears. Owner decides: (a) retire it, (b) re-host it at another name (for example `www`, a subdomain, or a different domain) before cutover, (c) accept loss. Keep the old deployment running and untouched until sign-off (rollback depends on it).

## 3. Linking mechanics (choose by section 1)

* **A. Domain on another Replit deployment (same account):** Open V2 Repl, Publishing, Domains, add `lumiereportal.app`. Replit warns it is linked elsewhere and offers to move. **Do not accept on the day of cutover without sections 5-6 done.** Moving unlinks it from the old deployment immediately (a domain is on one deployment), so there is a short window where the old site is off. To avoid downtime, prefer testing under a subdomain first (for example `staging.lumiereportal.app`, a separate link, no wildcard).
* **B. External DNS (registrar/Cloudflare/Netlify DNS):** In V2 Publishing, Domains, add the domain; Replit shows the A record value and the `replit-verify=` TXT. In the DNS provider: lower the existing A/CNAME TTL to 300 s at least 24-48 h before (so rollback is fast), then replace the apex A record with Replit's, add the TXT, remove any AAAA records, and set Cloudflare proxy to DNS-only. Link `www` separately (CNAME as shown by Replit, or redirect `www` to apex at the DNS/registrar level).
* **C. Owner of the current host unreachable:** the domain's registrar login is the only authority; recover that first. Without DNS control, cutover cannot happen.

## 4. Values that change at cutover (code audit)

| Where | Today | At cutover |
|---|---|---|
| `APP_URL` (deployment secret; `.replit` `[userenv.production]` currently hardcodes the replit.app URL) | `https://lumiere-student-portal-v-2.replit.app` | `https://lumiereportal.app`. Used for password-reset and verification `redirectTo` (`server/routes.ts`, `resolvePasswordResetAppUrl`), email links, and the `/ready` appUrl check. **Edit the `.replit` hardcoded line too**, because precedence between `[userenv.production]` and secrets is unverified (see replit-staging.md finding 1). |
| `PUBLIC_APP_URL` (`.replit`) | replit.app URL | `https://lumiereportal.app` (preflight `--production` enforces equality with the apex) |
| Supabase Auth Site URL | current value | `https://lumiereportal.app` |
| Supabase Auth Redirect URLs | current | add `https://lumiereportal.app/auth/verify`, `/verify-email`, `/reset-password`; keep the replit.app entries until sign-off (rollback), remove after |
| CORS (`server/config/production.ts`) | allows `https://lumiereportal.app`, `https://www.lumiereportal.app`, `*.lumiere.college` by default (`CUSTOM_DOMAIN` env overrides the base domain) | **No change needed**, it already names the target. The SPA calls its own origin, so CORS is not exercised for same-origin use. The replit.app origin is not in the list (only matters for cross-origin callers). Do not set `CUSTOM_DOMAIN` unless the domain differs. |
| Session cookie (`sessionConfig`: `secure`, `sameSite: strict`, `domain: .lumiereportal.app`) | **Not wired to any middleware** (auth is a Supabase JWT in `Authorization`, no `express-session`) | No effect. If it is ever wired, `domain=.lumiereportal.app` would be rejected by browsers on the replit.app host, which is another reason to keep both URLs consistent. |
| CSP `connect-src` | `'self'` + `SUPABASE_URL` + Stripe | no change (relative origin) |
| HSTS (`helmet`: 1 year, `includeSubDomains`, `preload`) | already sent on replit.app | begins applying to `lumiereportal.app` and **all subdomains** once served; see 5.6 |
| Supabase `SUPABASE_URL`, `DATABASE_URL`, keys, `SESSION_SECRET` | production | unchanged |
| Stripe webhook / return URLs | n/a to this runbook; if Stripe is configured, update any dashboard URL that names the old origin | check |

## 5. Pre-cutover checklist (all must be true; attach evidence)

1. **Backups:** Supabase production database backup/PITR point recorded (Dashboard, Database, Backups) and storage buckets listed/exported; `git` tag of the release commit; the old site's source/export saved; `dig` output from section 1 saved.
2. **Staging PASS:** `docs/recovery/s22/replit-staging.md` section 4 completed on staging (preflight PASS, smoke PASS, rehearsals J1-J15 and S21 flows), outputs attached.
3. **Production preflight:** with the production values exported locally, `npx tsx scripts/s22/preflight-env.ts --production --ref <production ref>` prints `result: PASS` (requires `APP_URL=https://lumiereportal.app`, `ENABLE_EMAIL_VERIFICATION=true`, `AUTH_EMAIL_MODE=custom_smtp`, `REDIS_URL` present, demo mode off). Currently the **live** secrets would fail it (no `ENABLE_EMAIL_VERIFICATION`, no `REDIS_URL`, APP_URL is replit.app): fix these first, redeploy, and confirm `/ready` returns 200 on the replit.app URL before touching DNS.
4. **Supabase Auth production config** set as in section 4; `npm run verify:supabase-auth-config` passes; custom SMTP verified with a real inbox test; public signup disabled.
5. **Baseline of the old origin:** `scripts/s22/smoke-staging.sh https://lumiereportal.app --allow-production-readonly --allow-not-ready` (records what the old site answers; expected to FAIL V2 checks, saved as evidence only) and the same against `https://lumiere-student-portal-v-2.replit.app --allow-production-readonly`.
6. **HSTS acknowledged:** once `lumiereportal.app` serves `includeSubDomains; preload`, browsers refuse plain HTTP for the domain and every subdomain for a year; anything on a subdomain without HTTPS (mail web UIs, old tools) will break. The `preload` flag is only a *request*; do not submit to hstspreload.org until the owner is certain. Rolling back DNS does not clear HSTS already cached in browsers.
7. **TTL lowered** to 300 s at least 24-48 h earlier (option B).
8. **Maintenance window** agreed; support contacts informed; invitation emails not sent during the window.
9. **Cost:** custom domains require a published deployment (paid). Owner confirms.

## 6. Cutover steps (owner, in order)

1. Announce the window. Confirm the old deployment is running and untouched (do not shut it down: shutting down removes its domain links).
2. Final production deploy of the release commit on the V2 deployment with `APP_URL`/`PUBLIC_APP_URL` set to `https://lumiereportal.app` (secret and `.replit`). Smoke the replit.app URL: `scripts/s22/smoke-staging.sh https://lumiere-student-portal-v-2.replit.app --allow-production-readonly` must PASS (`/ready` 200).
3. Set Supabase Auth Site URL and Redirect URLs (section 4), keeping the replit.app entries.
4. Link the domain: option A (move in Replit Publishing, Domains) or option B (A + TXT at DNS, apex; then `www`). Wait for Replit to show the domain as Verified/Active.
5. Wait for the TLS certificate (Replit shows status; do not announce until HTTPS works). `dig +short A lumiereportal.app @1.1.1.1` and `@8.8.8.8` must return Replit's address, and `curl -sI https://lumiereportal.app/health` must give 200 with a valid certificate.
6. Immediately run section 7.

## 7. Post-cutover verification (read-only)

1. `scripts/s22/smoke-staging.sh https://lumiereportal.app --allow-production-readonly` -> PASS (`/ready` 200; HSTS, CSP, nosniff; 401s; `/env.js` public keys only; `/auth/verify`, `/verify-email`, `/reset-password` 200). Then `scripts/release/s14/smoke-hosted.sh https://lumiereportal.app`.
2. `/env.js` shows the **production** Supabase project served to browsers.
3. Owner-run live checks with a real account: login, request a password reset and check the email link starts with `https://lumiereportal.app/reset-password`, open an invitation link, logout.
4. `https://www.lumiereportal.app` redirects or serves as decided. Certificate valid for both.
5. Watch deployment logs for 5xx and CSRF 403 bursts for 30 minutes (see multi-instance note in replit-staging.md section 3).

## 8. Rollback (decide in advance; target under 15 minutes)

Triggers: smoke FAIL not fixed in 15 minutes, login or reset broken, certificate not issued within the agreed time.
1. Option A: in the old deployment's Publishing, Domains, re-link `lumiereportal.app` (move it back). Option B: restore the saved DNS records from section 1 (old A/CNAME, remove or leave the Replit TXT, which is harmless) with the 300 s TTL.
2. The old deployment was not touched, so it serves immediately once DNS/link returns. If it was shut down by mistake, republish it (domain links must be re-created).
3. Supabase: restore Site URL to the previous value (the replit.app redirect entries were kept).
4. Application rollback independent of DNS: Replit Publishing, deployment history, redeploy the previous build (and revert `APP_URL`).
5. HSTS already cached by browsers persists up to a year; this is why section 5.6 is a gate.
6. Record cause, then re-attempt only after a new staging PASS.

## 9. Owner approval gate (all lines must be signed before step 6.4)

```
[ ] Section 1 completed: current host/DNS owner identified: ______________________
[ ] Fate of the old landing page decided: ______________________
[ ] Backups taken and recorded (DB point, storage list, release tag, dig output)
[ ] Staging PASS evidence attached (preflight, smoke, J1-J15 + S21 flows)
[ ] preflight-env --production PASS; live secrets corrected (ENABLE_EMAIL_VERIFICATION, REDIS_URL, APP_URL)
[ ] Supabase Auth Site URL / Redirect URLs set; SMTP inbox test done
[ ] HSTS includeSubDomains/preload consequence accepted
[ ] Cost of the published deployment confirmed
[ ] Rollback owner and 15-minute window agreed
Approved by: ______________________   Date/time (UTC): ______________________
```
