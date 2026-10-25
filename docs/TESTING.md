# Test results

Run on 25 Oct 2026 with Node 22 and headless Chromium (Playwright), against a local server that runs the real `api/release.js`.

## Release endpoint (`api/release.js`): 9/9 passed

- Before release: `locked`, no content in the body.
- `Cache-Control: no-store` on every response.
- The default release time resolves to 2027-01-07 19:00 UTC (22:00 Riyadh).
- After release: full content returned.
- Base64 (`CRISIS_CONTENT_B64`) and raw (`CRISIS_CONTENT`) both work.
- Broken JSON returns a generic `pending` error; the secret text is never echoed.
- Released but no content configured returns `pending` / `not_configured`.
- An invalid `RELEASE_AT` returns an error with no content.
- POST is rejected (405).

## Admin endpoint (`api/admin.js`): 14/14 passed

- With no admin variables set, the admin panel is disabled.
- Wrong password returns 401 and echoes no secrets. The username is case-sensitive.
- Correct login returns a signed session. Status and the pre-release preview work only with that session.
- No token, a forged or tampered token, an expired session, or a rotated `ADMIN_SESSION_SECRET` all return 401.
- The 6th wrong attempt from one IP returns 429, and a locked-out IP can't log in even with the right password.
- GET on login is rejected.
- The password appears in no site file.

## Admin panel + intro + iPad (browser)

- **Admin panel:** the login error shows remaining attempts. The dashboard shows state, countdown, content size and the health check. The encoder validates JSON and reports its size.
- **Admin preview:** shows the released site and stays on across pages. Opening `?preview=1` without logging in shows nothing.
- **Intro:** the POWER ON screen loads no music until it's tapped; then sound turns on and the music starts. ENTER WITHOUT SOUND stays muted.
- **iPad:** emulated iPad Pro 11 and iPad Mini, portrait and landscape. Touch controls appear and fit on screen, punches land, and there are no errors.

## Browser suite: 31/31 passed

**Release behavior**
- Timed release: a page opened *before* the deadline showed nothing protected. It then revealed the roster automatically after the server released, with no refresh.

**Security**
- An XSS payload inside a character name rendered as plain text.
- A `javascript:` resource link was dropped; real links kept.

**Locked state on all 10 pages** (desktop 1440, tablet 820, mobile 390)
- No protected content anywhere in the DOM.
- No console errors and no horizontal overflow.

**Interactions**
- Home has 12 "?" slots.
- Clicking a slot picks P1, and the CPU rolls a rival.
- Arrow keys move between slots.
- PRESS START opens the 9-item menu; Esc closes it.
- M toggles sound; FX switches to reduced effects.
- Nav links work, with the page transition, and so does browser Back.

**Each page**
- Updates feed shows samples clearly labelled; priority filters work.
- Timeline nodes and rules accordions expand.
- Locked character dossiers open.
- Chair portraits load.
- `?demo=1` shows the released layout with a DEMO banner.

**Failure and fallback modes**
- Endpoint returning 500 shows `NO SIGNAL · RETRYING` and stays locked.
- `file://` opens with no errors, shows FILE MODE and stays locked.
- `prefers-reduced-motion` turns on reduced effects automatically.

**Leak scan (attacker view, before release):** loaded all 10 pages, collected every downloaded file and the rendered DOM (40 resources), and probed `/api/release` with spoofed `Date` headers and query tricks. None of 61 distinctive terms from the real content appeared anywhere. The endpoint returned only `locked`.

**Repo scan:** no test secrets left in any file. Docs and README are excluded from the deployment via `.vercelignore`.

## Not verified here (do these on the real deployment)

- Vercel itself: deploy, set the env vars, open `/api/release`.
- **Real iPad/iPhone Safari:** the iPad tests used Chrome's iPad emulation, because Safari's engine (WebKit) couldn't be downloaded here. The code includes Safari-specific handling (prefixed fullscreen, audio unlock on tap, `100dvh`, touch-gesture locking), but test once on a real iPad.
- Git history: this folder is delivered without a `.git` directory, so start a clean repo.
- Screen reader passes (semantic markup, labels and focus handling are in place, but no live NVDA/VoiceOver run).
