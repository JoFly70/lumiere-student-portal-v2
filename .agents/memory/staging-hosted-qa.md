---
name: Hosted staging QA constraints
description: Concurrent session-pool use and shared preview request quotas can make hosted QA failures differ from direct-service checks.
---

Budget database sessions across both the running preview and the separate QA process. Apply the full guarded development identity to the runner, not only its database connection.

**Why:** A direct high-school projection succeeded while the running HTTP endpoint returned a pooler SQLSTATE XX000 under concurrent QA. Bounding both staging process pools resolved this; using only the verified connection without the guarded runtime identity left the runner on different pool settings.

**How to apply:** Keep production defaults unchanged. Use small staging pools and explicitly close bounded runner connections; compare direct-service and actual HTTP behavior before attributing failures to missing schema.

Repeated hosted QA can consume the same observed client-IP rate quota as owner preview testing.

**Why:** Extended browser/API repetitions produced HTTP 429 and an apparent session-reload failure, while liveness stayed healthy and the normal request logs showed no new handler activity.

**How to apply:** Read Retry-After, wait for its window, and reduce repeated calls. Do not weaken the rate policy, spoof a client IP, or restart the server merely to clear the limit. Preserve partial results so successful steps need not be repeated unnecessarily.

Auth hardening must also be reflected in disposable test-provider fixtures; never restore demo/local-token bypasses to make integration tests pass.

**Why:** Previously skipped database suites concealed old provider mocks that always rejected authentication. Once local PostgreSQL discovery worked, those requests failed before reaching the academic authorization checks.

**How to apply:** Keep the real application authentication and role middleware intact. Simulate only external provider verification for signed synthetic fixtures, and run destructive schema/error-path tests only in the cluster the harness creates, never the retained Supabase staging database.
