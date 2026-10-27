# Lumière Academic Assistant - API contract (S20, Sonnet D -> Sonnet E)

Router mount: `app.use('/api/assistant', router)` (server/routes/academic-assistant.ts, default export).
Both endpoints require the normal bearer auth. POST also requires the `x-csrf-token` header (same as other mutating routes).

## GET /api/assistant/status
200:
```json
{
  "enabled": true,
  "liveModel": false,
  "mode": "local",
  "reason": "disabled",
  "suggestions": [{ "id": "roadmap-how", "en": "How does my roadmap work?", "fr": "Comment fonctionne ma feuille de route ?" }]
}
```
- `enabled`: the assistant is usable. Always true (local mode always works).
- `liveModel` / `mode`: `true`/`"live"` only when a live AI model WOULD answer this account right now. Today for all students this is `false`/`"local"` (no adult attestation exists).
- `reason` (present only when mode is local): `"disabled" | "not_configured" | "not_eligible" | "budget_exhausted"`. Show neutral copy; never imply an AI replied when mode is local.
- No provider internals are ever returned.

## POST /api/assistant/message
Body: `{ "message": string (1..500), "language": "en"|"fr", "history"?: [{ "role": "user"|"assistant", "content": string }] }`
(history: at most 6 turns kept, newest; each truncated to 400 chars; extra is silently dropped.)

200:
```json
{
  "reply": "text (plain text, may contain line breaks; render as text, not HTML)",
  "mode": "live" | "local",
  "sources": [{ "title": "...", "url": "https://...", "verifiedAt": "2026-10-27" | null }],
  "links": [{ "label": "My roadmap", "path": "/roadmap" }],
  "notice": "optional, e.g. privacy notice when personal info was detected"
}
```
- `mode: "local"` = curated, source-backed answer from the portal's built-in knowledge (no AI model). `"live"` = AI-generated (label it as AI to the user).
- `links[].path` are real in-app routes; `label` is already in the requested language.
- When personal info is detected in the message, the reply is local with a `notice`; nothing is sent to any provider.
- Local replies never claim transfer-credit acceptance.

Errors (JSON `{ "error": string, "code": string }`):
- 400 `invalid_request` (empty/too long/bad language)
- 401 unauthenticated, 403 CSRF
- 429 `throttled` (per-account; honour `Retry-After`)
- 503 `unavailable` (generic message; provider failures normally degrade to a local reply with `notice`, 503 only if even that fails)

Do not send student data in the request; the server ignores everything except the fields above.
