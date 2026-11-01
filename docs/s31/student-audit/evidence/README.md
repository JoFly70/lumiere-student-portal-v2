# S31-A evidence

None of these files contain real student data, credentials or session tokens.

| Prefix | Label | Source |
|---|---|---|
| `live-*` | **LV**, live | The published site, signed out. The only typed credentials were a non-existent `s31-audit-nonexistent@demo.invalid` address and a dummy password, in one wrong-credential attempt. |
| everything else (`hs-*`, `ba-*`, `j-*`, `ai-*`) | **LS**, local simulation, **not live** | Real client code in Chromium; all `/api` responses stubbed from synthetic fixtures in `tests/helpers/`. Names such as "Noa Synthétique", "Avery Synthetic" and "Amy" come from those fixtures. The French notification texts in the harness are synthetic too. |

## Files

| File | Shows |
|---|---|
| `live-login-fr-390.png`, `live-login-fr-1440-dark.png`, `live-invite-fr-1440.png` | Public sign-in and invitation (F22, F23; NO CHANGE) |
| `live-login-error-fr-390.png`, `live-login-error-fr.json` | Translated wrong-credential error with `role=alert` |
| `live-notfound-fr-390.png` | Translated 404 page |
| `live-forgot-fr-text.txt` | Forgot-password screen text (nothing was submitted) |
| `live-results.json` | Per page, width and scheme: HTTP status, redirect, load time to network idle, horizontal overflow, `lang`, h1 |
| `live-pwa-probes.json` | No manifest or service worker (the SPA HTML is returned); head meta tags (F32) |
| `hs-flight-deck-fr-1440.png`, `hs-flight-deck-fr-390.png`, `hs-flight-deck-fr-390-dark.png` | HS dashboard: English deadline cards (F08), « déc.. » (F28), orb overlap (F27) |
| `ba-flight-deck-fr-1440.png` | Degree dashboard full page: label collision (F14), « Appliqués » vs « Déjà acquis » (F07), high-school checkpoint wording (F16), « dans 1 jours » (F28) |
| `ba-roadmap-fr-390.png` | Degree roadmap credit-source card (KEEP) and orb overlap (F27) |
| `hs-billing-fr-390.png` | Billing first screen on a phone (F05) |
| `j-hs-details-fr-1440.png` | `?view=details`, where the elective change lives (F11) |
| `j-documents-reason-fr-390.png`, `j-library-no-reason-fr-390.png` | The same rejected document: reason shown on Documents, missing in Library (F09) |
| `ai-panel-ba-fr-390.png` | Assistant panel in local mode: "not live AI" label (KEEP) |
| `hs-more-menu-fr-390.png` | Phone « Plus » menu |
| `hs-calendar-fr-390.png`, `hs-notifications-fr-390.png`, `hs-roadmap-fr-390.png` | Calendar, notification inbox, log-first course page on a phone |
| `journeys.json` | Results of the LS journeys (J1, J3, J5, J9, assistant panel) |
| `render-matrix.json` | Probe results for every LS render (overflow, small targets, unnamed controls, English-leak heuristic) |
| `harness/` | Scripts used: `live-public.cjs` and `live-locale.cjs` (live, read-only), `s31-render.ts` and `s31-journeys.ts` (local simulation), `assistant-probe.ts` (runs the real assistant routing functions). Paths are absolute to the audit container; adjust before reuse. |

## Re-running

From the repo root, after `npm ci`:

```bash
npx tsx docs/s31/student-audit/evidence/harness/s31-render.ts matrix /tmp/s31-matrix
```
