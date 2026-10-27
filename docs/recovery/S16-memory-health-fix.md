# S16 memory health calculation

## Scope

Only `/health` memory-pressure evaluation changes. `/ready`, authentication,
student workflows, database access behavior, rate limiting and deployment
settings are unchanged. No dependency changes or new infrastructure are needed.

## Signals and thresholds

The former warning compared heap-used with V8's **currently allocated** heap,
using rounded MiB values. V8 can naturally occupy almost all of that elastic
allocation while far below its actual memory limit.

The new calculation uses unrounded bytes and warns at **90% or more** of either:

- JS heap used / V8 `heap_size_limit`.
- Process RSS / effective memory capacity: the smaller valid value of OS total
  memory and Node's `process.constrainedMemory()` OS/container constraint.

This retains 10% headroom against actual limits. Node 20/libuv detects container
constraints. A zero/unknown constraint falls back to system physical memory;
the response identifies which capacity was used. If neither capacity is known,
the heap limit is invalid, or a usage measurement is invalid, the health check
warns rather than silently claiming healthy.

This is an instantaneous process-pressure signal, not a leak detector or proof
that other processes on the machine have spare memory. It requires no sampling
timer or retained history. Native/buffer pressure is covered by RSS independently
of JS heap usage.

## Behavior and diagnostics

Existing `memory` fields remain in MiB. An additive `memoryPressure` object exposes
actual limits in bytes, utilization ratios, capacity source, threshold and reasons.
`heapTotal` remains informational; it is never the pressure denominator.

For example, 39 MiB used / 41 MiB allocated is normal with a 2 GiB V8 limit and
121 MiB RSS / 4 GiB machine capacity. It must not return 503 solely because
39/41 is above 80%. Actual heap or RSS pressure still logs a warning and returns
503. Existing database failures still return 503.

## Security boundaries

This does not repair or bypass the existing `/ready` failures. Public signup
being enabled (`disable_signup=false`) still fails the invitation-only auth gate.
Without Redis, distributed rate-limit readiness still fails. Neither shared
Supabase Auth configuration nor Redis/hosting settings are changed by this fix.

Focused tests cover the reported false positive, both genuine-pressure signals,
threshold boundaries, unavailable measurements, HTTP status/logging behavior,
database failures using a mock only, and unchanged production readiness failures.

## Verification (2026-10-27)

- Clean `npm ci`, TypeScript, fresh production build, changed-file ESLint and
  whitespace checks passed.
- 767 focused tests passed across 29 files, including 21 new memory/HTTP tests.
  Tests ran without inherited application credentials and used no real database.
- Full audit: 0 critical, 0 high, 8 moderate. Production-only audit: 0 critical,
  0 high, 2 moderate. The high-severity gate passed; default audits still exit 1
  for the existing, disclosed moderate advisories. No dependencies changed.
- Built browser HTML/JS/CSS scan found no service-role JWTs or secret markers.
  The served client matches the fresh build and remains unchanged from S16.
- The rebuilt production-mode workspace returned `/health` 200 with database and
  memory OK; `/ready` remained 503 for authEmail/distributedRateLimit and
  `/api/me` remained 401 unauthenticated. The `/ready` handler is byte-unchanged.
- The live, pre-republish `/ready` still returned those same failures. Canonical
  public Auth settings confirmed email enabled and `disable_signup=false`;
  production secret-existence metadata confirmed no `REDIS_URL`.
- No database writes, shared Auth changes, Redis provisioning, hosting-setting
  changes, invitations or student workflow changes were performed. This fix was
  not published; production needs a separate republish to receive the server fix.
