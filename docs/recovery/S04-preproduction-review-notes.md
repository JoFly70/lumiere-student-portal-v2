# S04 — items recorded for pre-production review

These are recorded findings, not fixes. Neither is changed in S04.

## 1. Lint tooling deficiency (pre-existing, separate from S04 work)

- `eslint.config.js` imports `@eslint/js`, `globals`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh` and `typescript-eslint`. None of them, nor `eslint` itself, is declared in `package.json`. There is no `lint` script.
- Running `npx eslint …` fails before any file is linted: `ERR_MODULE_NOT_FOUND: Cannot find package '@eslint/js'`. The failure is the same on the S03 baseline (`8f97ae9`) and on S04.
- So lint has not been a working quality gate in S01–S04. The checks that do run are `tsc --noEmit`, `vitest run` and `npm run build`.
- **Recommendation:** decide whether to adopt ESLint. If yes, add the packages as devDependencies with pinned versions, add a `lint` script, and triage the first run in a dedicated change. If no, delete the orphaned config.

## 2. Redis rate-limit readiness after startup disconnection

**Question:** does `/ready` detect a Redis disconnection that happens after startup?

**Answer: no.** Based on reading the code; not tested against a real Redis.

- `getRateLimitBackend()` in `server/lib/rate-limit-store.ts` changes to `'redis'` once at startup, after the first connection succeeds. It never changes back. Readiness (`distributedRateLimit`) therefore stays true after a later disconnect.
- `server/index.ts` logs `error`, `reconnecting` and `end` events and pings Redis every 60 s. None of this feeds readiness.
- During a disconnect:
  - node-redis queues commands while it reconnects, because `disableOfflineQueue` defaults to false. Rate-limited requests can stall until Redis comes back.
  - If a store call rejects, express-rate-limit passes the error on (`passOnStoreError: false`) and the request fails. It does not bypass the limit. This fails closed for login and signup, but the API is unavailable until Redis recovers.
- **Pre-production decisions:**
  - Should `/ready` reflect live Redis health, for example the last ping result or `client.isReady`, so the orchestrator stops routing to an instance that has lost Redis?
  - Is fail-closed (requests error or stall) the intended policy, or should auth endpoints fail closed while general API limits fail open?
  - Should a command timeout bound the stall?
- **Not tested:** multi-instance Redis limiting, disconnect and reconnect behaviour, and failover.
