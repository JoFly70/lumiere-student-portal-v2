# S21 Spark (Meta Model API) hardening

Evidence: `docs/recovery/s21/spark-live-smoke.json` (2026-10-27, `scripts/s21/spark-contributor-smoke.ts`). Two billable requests reached the provider in total: a first one capped at 200 output tokens (empty content: 26 prompt / 200 completion, 198 reasoning, ≈ $0.000043) and the recorded one at the production cap 700 (26 / 312, 297 reasoning, ≈ $0.000065). An earlier attempt failed locally before reaching the network (Node fetch needs `NODE_USE_ENV_PROXY=1` behind this container's proxy). No further live calls were made for this work; every provider test uses a fetch mock.

## Hard model pin
* Only `muse-spark-1.3-contributor` can leave the server. `assertContributorModel()` (`meta-adapter.ts`) runs in `callMuseSpark` immediately before `fetch`, on the configured model, and again on the model parsed back out of the serialized request body. Any other value (`muse-spark-1.3`, other Muse variants, trailing/leading whitespace, case variants, non-strings) throws `ProviderError('model_rejected')` and **no outbound call is made**. The API base is pinned the same way.
* `loadAssistantConfig()` returns the constants; no environment variable (`SPARK_ASSISTANT_MODEL`, `META_MODEL`, `MODEL`, ...) and no request field is read for model or base URL. The service passes `cfg.model`/`cfg.apiBase`, so a mutated config is rejected before fetch, the reservation is released (`settle(.., 0)`), and the answer falls back to the local knowledge base.
* Repo scan: the contributor id is the only model id anywhere in scripts, docs, tests, examples and `.env.example`; tests that mention other ids do so only to assert rejection.

## Real-response compatibility
* `completion_tokens` **includes** `completion_tokens_details.reasoning_tokens` (312 includes 297). Cost = `prompt*0.10 + completion*0.20` per million, unchanged; reasoning tokens are parsed (`reasoningTokens`, null when absent) for logging only and never added on top.
* `finish_reason: "length"` with empty content is the distinct `truncated` error kind (the cap was spent on reasoning). Empty content otherwise is `bad_response`.
* Whenever usage is returned (success, `truncated`, or `bad_response`) the budget reservation is settled at the **actual** cost, because the provider billed. Without usage, timeouts, network errors and 5xx keep the full reservation (conservative); 4xx, `not_configured` and `model_rejected` release it.
* Logs carry kind, status, token counts and finish reason only: never content, bodies or the key.

## Output cap: why 700 and why not lower
Default stays 700. The floor is now 400 (`MIN_OUTPUT_TOKENS`; env values below it are clamped up). Muse Spark always reasons and reasoning shares `max_completion_tokens`: a 200-token cap returned empty content (198 of 200 spent on reasoning) for a five-word reply, while 700 completed using 312. Knowledge-grounded answers reason more than that trivial prompt, so anything much below 400 risks paid empty answers.

## Unchanged S20 safeguards
Students are never live (`student` stripped from `SPARK_ASSISTANT_LIVE_ROLES`, role check at decision time), PII guard before any provider call, reserve-then-settle monthly budget (fails closed), per-user throttle in the route, flag default off.

## Tests
`npx vitest run tests/s21-spark-provider.test.ts tests/s20-assistant-*.test.ts tests/s20-release-readiness.test.ts` : 97 passed.
