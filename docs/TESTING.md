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
- PRESS START opens the menu; Esc closes it.
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

## Committee, publishing and security pass (2 Nov 2026)

- **Unit:** 38/38 passed (`npm run test:unit`).
- **Browser, local server with an in-memory KV:** 45/45 passed. This covers publishing, Unicode, the failed-load publish guard, the full caucus lifecycle, the delegate code, 20 simultaneous directives, a KV read failure, a wrong device clock and the unpublished-changes warnings.
- **Release moment:** a page open before the deadline stayed locked with no content in the response, then flipped by itself and played the reveal.
- **Live site:** the read-only Playwright suite passed, and published content matched the private master exactly.

## Admin rebuild, preview and release pass (2 Nov 2026)

- **Unit:** 52/52 passed (`npm run test:unit`). Added: every new admin action refuses a request with no session, drafts never reach the public, nothing reaches the public before release, restore, posted updates stay locked and survive a stale editor, public text validation and the scenario-name guard, and version checks.
- **Browser, local server with an in-memory KV:** 36/36 passed (`npm run test:local`).
- **With the real scenario, on a local server:** an unsaved edit appeared in the preview; preview stayed on through the home card, nav, menu and reload; a publish with no edits matched the master exactly in the earlier pass; the rebuilt site matched the FULL build on every shared page and all 22 dossiers, apart from the real chair bios.
- **Release moment, local:** an open page flipped by itself and played the reveal; a visitor on the Home intro got the reveal after the intro closed; a late visitor saw it once.

## Visual editor and in-panel preview (3 Nov 2026)

- **Browser, local server with an in-memory KV:** 44/44 passed. Added click-to-edit for public and scenario text, Esc to cancel, page switching, preview with no new tab, and a page named like the admin frame getting no content.
- **Preview:** the earlier new-tab version could not be reproduced as failing in real Chrome, so the cause of the live report is not confirmed. Preview no longer opens a tab at all.

## Chair report and form fields (3 Nov 2026)

- **Unit:** 61/61 passed. Added: visitors get nothing before release, admins get the exact bytes, a forged token is refused, the link only appears after release and is never written into the published document, non-PDF files are refused, and replacing or deleting the report removes its pieces.
- **Browser, local server with an in-memory KV:** 47/47 passed. Added: upload and remove in the panel, and every form field has an id or name.

## Committee rebuild and easier admin (3 Nov 2026)

- **Unit:** 81/81 passed (`npm run test:unit`). Added: lists of speakers, duplicates, the queue limit, moving, SPEAK NOW and its undo, a speaker changed during a pause, added time after zero, reopening an ended caucus, speakers saved before ids existed, the delegate list, spoken counts, and the public response hiding an idle caucus and the delegate list.
- **Browser, local server with an in-memory KV:** 64/64 passed (`npm run test:local`). Added: pasting a messy list, a full caucus from start to end, undoing a wrong NEXT, TIME UP, roll call and renaming, tap to add, 12 fast adds in a row, a second tab picking up changes, typing surviving a refresh, and an expired session going to the login screen.
- **Layout:** every admin section checked at 1280px and 390px with no sideways scrolling.
- **Not checked:** two chairs pressing buttons at the same moment on the live site. Changes to the caucus are in order within one browser, but two browsers can still overwrite each other if they press within a fraction of a second.

## Crisis Room, all phases (3 Nov 2026)

- **Unit:** 127/127 passed (`npm run test:unit`). Covers vote sums, frozen voters and rules, quorum, corrections, delegate logins, every chair action refusing a delegate session, one delegate never reaching another's records, drafts staying private, unchangeable sent versions, two chairs reviewing at once, updates needing approval and going out once, faction and character delivery, read receipts, and the projector showing nothing private.
- **Browser, local server with an in-memory KV:** 71/71 passed (`npm run test:local`).
- **Full rehearsal:** `npm run test:rehearsal` runs a chair, two delegates (one on a phone) and the projector at once, from delegate setup to the final archive. Passed three times in a row.
- **Layout:** every Crisis Room tab, the delegate desk and the projector checked by eye and for sideways scrolling at 1280px and 390px, and the projector at 1920px.
- **Bugs these tests found, now fixed:** a second chair's review silently replacing the first; a late redraw swallowing the TELL THE DELEGATE click; renaming a threshold blocking the rules from saving; a connection warning wiping typed text.
- **Not checked:** the lock, log and login on real Upstash, because previews share production data. Check on a temporary separate Vercel project before relying on them.
- **Not checked:** real phones, screen readers, printing the code cards on paper, and 30 delegates at once. The rehearsal used two delegates.
- **Upstash command limit:** not confirmed. Neither the Vercel MCP nor the CLI could read the plan, so check it in the Upstash dashboard before the conference.

## Crisis Room, a full room (3 Nov 2026)

Local server only, fake storage slowed by 25 ms a command to act like a network, fictional names. One chair, one projector and 30 delegates: 6 real browsers (WebKit iPhone 13 and SE, Chromium Pixel 7 and Galaxy S9+, desktop) and 24 scripted delegates sending the same requests, because the test PC could not hold 30 browsers.

- **Found and fixed:** 8 of 30 directives sent at the same moment were refused as busy; read receipts were lost the same way (13 of 30); ten wrong codes locked out everyone on the same internet address. Busy answers are now retried quietly, and the limit is 200 wrong codes in 15 minutes.
- **After the fixes:** 30 of 30 logged in together; 30 of 30 autosaved; 30 of 30 sent on the first press, in 13 seconds; 30 unique directive numbers; a message reached everyone within 10 seconds; 30 of 30 read receipts; no delegate saw another's work; no sideways scrolling on any device; no page errors.
- **Storage use:** 588 commands a minute (about 35,000 an hour) measured in a quiet room. A live caucus makes pages check more often, so expect roughly 70,000 an hour; that figure is worked out, not measured.
- **Fake store bug fixed:** an old lock's timer could remove a newer lock, which real Redis does not do. It caused false duplicate directive numbers.
- **Live site:** one save was checked on real storage: rules saved unchanged, three presses at once, one log line.
- **Printed cards:** 30 cards fit on 2 A4 pages as a PDF, and a long name stays on its card. Not printed on paper.
- **Not checked:** real phones, real Safari on iOS, 30 real browsers, delegate logins on real storage (refused until release), and screen readers.
