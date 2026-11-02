# S34 — Rate-limit verification (S33-02)

## 1. Before (S34 baseline `81256aa`, confirmed in code)

| Limiter | Limit | Key | Mount |
|---|---|---|---|
| `adminLimiter` | 30 / 15 min | IP | `server/index.ts` `app.use('/api/admin')` |
| `apiLimiter` | 100 / 15 min | IP | `server/index.ts` `app.use('/api')` |
| `apiRateLimit` (**duplicate**) | 100 / 15 min | IP | `server/routes.ts:146` `app.use('/api')` |
| `authRateLimit` | 5 / 15 min | IP | **shared** by `/api/auth/login` and `/api/auth/refresh` |

Effect:
- Everyone behind one office IP shared 100 general and 30 admin requests per 15 minutes.
- Five sign-ins or renewals blocked every later sign-in **and** every session renewal.
- 429 responses reached the screen as raw text such as `429: {"error":…}`.
- A failed programs lookup showed a high-school student the university Flight Deck.

## 2. After

| Bucket | Limit / 15 min | Key | Where |
|---|---|---|---|
| IP ceiling (the only general `/api` limiter) | 1500 | `req.ip` | `server/index.ts` `app.use('/api', ipCeilingRateLimit)` |
| Per user | 600 | `user:<verified id>` | inside `requireAuth`, after the token is verified |
| Per user, `/api/admin/*` | 300 (in addition) | `user:<verified id>` | inside `requireAuth` |
| Login | 10 **failed** attempts (`skipSuccessfulRequests`) | IP | `/api/auth/login` |
| Session renewal | 60 | IP | `/api/auth/refresh` (own bucket) |
| Signup / reset / verification | unchanged | IP | unchanged |

**Middleware order for `/api`:**
1. Webhooks.
2. IP ceiling.
3. Route-level auth limiters.
4. `requireAuth`: verifies the token, sets `req.user`, then runs `enforceUserRateLimit`.

The per-user key is read only from `req.user.id` set by `requireAuth`. Headers such as `x-user-id` are never read (tested). Each request is counted at most once, even if `requireAuth` runs twice.

Routes that use only `optionalAuth`, and the public auth endpoints, are covered by the IP ceiling.

**Sizing:**
- A busy staff member spends about 16 requests per minute: Diagnostics polling every 60 s, the support desk after S32.1, and about 14 requests per page view (S26 runner estimate). That is about 240 per 15 minutes, against a limit of 600.
- Admin-only traffic is about 150, against 300.
- Three staff members plus students behind one NAT come to about 720, against 1500.

**Response format.** 429 bodies are `{error, code: 'rate_limited', scope, retryAfter}` with a `Retry-After` header.

**Proxy.** `trust proxy` stays at 1 hop (Replit's proxy). `req.ip` is the address that proxy saw; no additional forwarded header is trusted.
- Note (U4 from S33): that Replit forwards the real client IP is still unverified in production. If it does not, every user shares one IP-ceiling bucket. The per-user buckets still separate users, and 1500 remains above the normal office load.

**Redis.**
- Every bucket uses the existing `createRateLimitStore(prefix)`, with distinct prefixes: `rl:ip-ceiling:`, `rl:user:`, `rl:admin-user:`, `rl:login:`, `rl:refresh:`.
- With `REDIS_URL` set, counters are shared across instances. Without it, they are kept in memory per instance (the existing behaviour).
- Store errors still fail closed (`passOnStoreError` is not enabled; checked by the existing s07 test).
- **Whether `REDIS_URL` is set in production: UNVERIFIED.** The owner can see it on the Diagnostics "rate-limit backend" tile.

## 3. Client behaviour

- **One friendly message.** `client/src/lib/rate-limit-message.ts` provides a single localized 429 message, used by both fetch helpers (`queryClient.ts`, `api.ts`):
  - EN: "You have made a lot of requests in a short time. Please wait a minute, then try again."
  - FR: « Vous avez effectué beaucoup de demandes en peu de temps. Veuillez patienter une minute, puis réessayer. »
  - The minutes variant is used when `Retry-After` is 90 s or more.
  - No raw JSON is shown.
- **A 429 never signs anyone out.** `auth.tsx` treats a 429 on refresh as transient: no sign-out, and a retry after `Retry-After` (clamped to 30 s–5 min). Only a refusal (401/403) or a missing refresh token ends the session.
- **No wrong Flight Deck.** A failed programs lookup with no earlier data shows a localized retry state, never the university deck.

## 4. Tests

`tests/s34-rate-limit.test.ts` has 21 tests; all pass. The limiters are exercised for real through injectable overrides (production skips them only under `NODE_ENV=test`). They cover:
- three staff members on one IP with independent budgets;
- exhausting one user's budget leaves other users unaffected;
- the admin budget;
- spoofed `x-user-id` headers are ignored;
- `requireAuth` ordering (`req.user` is set before the limiter runs);
- one count per request;
- 15 minutes of 60 s admin polling plus browsing by three staff stays under the limits;
- the IP ceiling still applies to unauthenticated traffic;
- login brute force is blocked after 10 failures;
- successful sign-ins are not counted;
- refresh and login buckets are independent;
- 429 body shape;
- only one `/api` general limiter is mounted;
- the configured numbers;
- EN/FR messages;
- a 429 on refresh is transient;
- the high-school programs-error state.

Existing assertions changed (the layout changed; the protection did not):
- `tests/s03-rate-limit-store.test.ts`: the top-level limiter count dropped from at least 6 to at least 5 (the duplicate `apiRateLimit` was removed). The test now also checks that store prefixes are present and unique.
- `tests/s07-integration-compat.test.ts`: the mount-order check now expects `app.use('/api', ipCeilingRateLimit)` after the webhooks, and asserts that the old per-IP admin mount is gone.
- `tests/knowledge-routes.test.ts` and `tests/student-academic-routes.test.ts`: the mocks of `server/middleware/rate-limit` gained the new exports.
- `tests/routes.test.ts` (S33-06): three plan-generation tests now use `staff` instead of `student`, because students now get 403.

**Browser check** (`docs/s34/harness/s34-render.ts`, mode `s34`; Vite + Playwright with stubbed `/api`): the programs lookup answers 429 for a high-school student at 390 px, in FR and EN. Result (`evidence/s34-check.json`):
- the localized retry state is shown;
- `universityDeckShown: false`;
- `signedIn: true`;
- "Try again" restores the high-school deck ("Semaine 8 sur 16" / "Week 8 of 16");
- no console errors.

Screenshots: `evidence/s34-programs-429-{fr,en}-390.png`, `evidence/s34-programs-recovered-fr-390.png`.

**Not verified:** behaviour against live Supabase and Replit (the hosted check is in `S34-RELEASE-READINESS.md`).
