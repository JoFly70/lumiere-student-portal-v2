# S17 design record: premium UI, themes and the Academic Flight Deck preview

Agent B. Scope: visual foundation, navigation, theme system, Flight Deck prototype. No server, shared or Support changes.

## 1. What was adapted from ClientDesk (concepts, not code)
- Nine theme palettes (colour values and token roles): canvas, panel tiers, text tiers, accent, accent ink, semantic red/amber/green/blue, and a separate navigation "rail" palette.
- The deep-rail-beside-calm-canvas navigation character, the active item (tinted fill, accent text, edge bar), the collapsed icon rail.
- Instrument patterns: hero arc, stacked coverage bars, heat strip, timeline, drawer.
- The contrast-audit approach: every text role is checked on every surface it can appear on.

All Portal code is a fresh implementation (token names are `--t-*`; no ClientDesk source, engine, data or branding copied). Theme files carry the header "Visual tokens adapted from the Lumière ClientDesk design system; re-implemented for the Portal."

## 2. Theme system
Files: `client/src/lib/themes.ts` (typed registry, resolve/apply/store, try/catch storage), `client/src/styles/themes.css` (generated palettes), `client/src/hooks/use-theme.tsx`, flash-free bootstrap in `client/index.html`, picker in `components/os/theme-picker.tsx` opened from `components/theme-toggle.tsx` (keeps `data-testid="button-theme-toggle"`).

- `html[data-theme=...]` carries the palette; the `.dark`/`.light` class is kept in sync, so Tailwind `dark:` variants work.
- Non-default themes map onto the shadcn HSL variables, the Portal's `--s-*` student/staff layer, `--st-*` status colours and `--sidebar-*`, so existing pages follow every theme.
- Default "Lumière" deliberately leaves the Portal's own Lumière tokens untouched: this keeps the approved Support screen identical. Only the navigation rail is restyled (shell, not Support).
- Legacy storage: `light` maps to Lumière, `dark` to Lumière Dark; the old key `theme` is still read. New key: `lumiere-portal:theme`.

Themes: Lumière (light, default), Lumière Dark, Midnight Slate, Monaco Navy, Forest Ledger, Bordeaux Reserve, Graphite Executive, Sandstone Light, Teal Reserve.

### Contrast audit
71 pairs per theme: text roles on canvas/panel/panel-3, status colours on card/page/tint, rail text and active item, button label on accent, destructive label, non-text lines at 3:1. The generator nudges lightness where a pair would fail and re-audits from the rounded HSL values it emits. Result: every pair meets its threshold in all nine themes. Lowest body-text ratio per theme (4.5 required): Lumière 5.16, Lumière Dark 4.74, Midnight 5.02, Monaco 4.91, Forest 4.93, Bordeaux 5.03, Graphite 4.81, Sandstone 4.70, Teal 4.91. `tests/s17-ui-theme-contrast.test.ts` re-checks text, accent, rail and status rules from the CSS itself.

## 3. Navigation
- Student sidebar: dark rail in every theme, round brand medallion, serif wordmark, groups "Your journey" (High School, Flight Deck, Your Roadmap) and "Your file" (Profile, Documents, Billing, Support), plus "Prototypes" (Flight Deck Preview) only when prototypes are enabled.
- Program-aware visibility unchanged (`filterStudentNav`); routes and every `data-testid` unchanged.
- Desktop collapses to a 3.75rem icon rail with tooltips (`--sidebar-width-icon` raised from 3rem in App.tsx).
- Mobile bottom nav: active tab gets a pill behind the icon, 60px targets; the "More" sheet is the same rail.
- Student header is a white bar; the theme control is the picker.

## 4. Flight Deck preview anatomy (`/preview/flight-deck`)
Route gate: `components/os/prototype-gate.ts` (`import.meta.env.DEV || VITE_ENABLE_PROTOTYPES === "true"`). In `App.tsx` the preview renders before the auth and query providers, so it makes no API calls (0 `/api` requests observed in Playwright). A non-dismissible banner "Prototype — synthetic data" sits in the sticky header.

Instruments: hero credit arc (verified / in progress / planned / remaining, one tick per credit), status legend with half-unit and credit counts, whole-program/core/elective coverage bars, subject heat strip (one square per half-unit, 42 total), subject drawer with course list and half-credit arithmetic, milestone timeline, next actions, file status (documents, support, profile, billing "Statement not connected"), eight quick-link cards to existing routes. The toggle "Verified only" / "Including planned" redraws arc, bars and strip.

Data (`client/src/lib/flight-deck-preview-data.ts`): sample program configuration 42 = 32 core + 10 elective half-units, labelled as configuration, not universal. Areas follow the real contract (English 8, Math 6, Science 6, Social Studies 6, Startup 2, Humanities 2, Health and PE 2, Electives 10). Sample split 16 verified / 10 in progress / 9 planned / 7 not yet planned. No GPA, no percentage implying standing, no balances.

Status is never colour alone: solid, striped, dashed and dotted fills plus text labels. Reduced motion is respected.

## 5. Critique round and fixes
Findings from the first renders, fixed and re-shot:
1. Coverage card left a large empty block beside the hero: added a whole-program bar and a pattern key.
2. Planned arc segment read as noisy hatching: lighter stroke, longer dashes.
3. Gauge caption wrapped to two lines and crowded the numeral: shorter caption, wider text box, smaller size.
4. Subject card header cramped at 390px: header now wraps.
5. Picker: nine rows overran the viewport and "Light · Light" was duplicated: tighter rows, note deduplicated.
6. Accent (gold) is never used as a status; status uses green/blue/neutral with patterns.

No gradients, glass or purple; one radius scale (12 / 8 / pill); one type scale in Inter with tabular figures.

## 6. Screenshots (`docs/recovery/s17-evidence/screens/`)
- `flight-deck-preview-{lumiere,monaco,lumiere-dark}-{1440,390}.png` (6)
- `flight-deck-preview-verified-only-monaco-1440.png`, `flight-deck-subject-drawer-monaco-1440.png`
- `theme-picker-open-1440.png`
- `student-shell-lumiere-1440.png`, `student-shell-collapsed-rail-1440.png`, `student-shell-monaco-1440.png`, `student-shell-lumiere-390.png`, `student-shell-menu-390.png` (stubbed `/api`, fake student, Billing page)
- `support-default-theme-1440.png` (stubbed; Support content and design unchanged)

## 7. Verification
- `npx tsc --noEmit`: clean.
- `tests/s17-ui-*`: 3 files, 47 tests pass.
- Existing source-grep UI tests (s13 navigation, s10, s07 tokens, phase5f) pass.
- Full suite: 4 failures, all in `tests/s13-first-student-journey.test.ts` (real Postgres document upload, "The file has not been uploaded"), outside this scope.
- `npx vite build` succeeds; the production bundle has no preview chunk and no "synthetic data" string.

## 8. Known gaps
- Staff shell gets the same rail colours and picker but was not otherwise redesigned.
- Non-default themes restyle Support (it follows the theme by design); only the default is guaranteed identical.
- The preview is a standalone screen, not mounted in the authenticated student shell; its rail is a static echo.
- The palette generator lives in scratch, not the repo; `themes.css` is audited by tests but regenerated manually.
- Existing Flight Deck and High School pages were not re-skinned beyond what the theme tokens give them.
