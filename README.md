# FORMA MUN · Crisis Division

A 16-bit arcade, cyberpunk crisis-committee website. It is plain HTML, CSS and vanilla JavaScript, with no framework and no build step. It deploys as a static site on Vercel plus one tiny serverless function that releases the secret scenario at the right moment.

**Release time:** 7 January 2027, 22:00 Riyadh (`2027-01-07T22:00:00+03:00`).

---

## What's in the box

The site is split into small modules. Each file does one job, so you can change one part without touching the rest.

```
index.html … chairs.html, admin.html   One file per page. Each page holds only its own <main> content.

css/
  base.css      Fonts, colour tokens, reset, CRT effect, buttons, panels, countdown
  layout.css    Top bar, nav, status bar, modal, page transition
  home.css      Home: arena, character select, signal panel, intro + power-on screen
  game.css      Playable game: PLAY button, full screen, 3-2-1, touch controls
  pages.css     Briefing, characters, factions, timeline, updates, locations, rules, intel, chairs
  fx.css        Release overlay, topic cutscene, reduced-effects rules (loaded last)
  admin.css     Admin control room

js/
  core/config.js    Settings + SITE MAP (nav, menu, page list). Edit pages/nav here.
  core/util.js      DOM helpers, storage, events, time formatting
  core/audio.js     Sound settings, sound effects (files + synthesized), background music
  core/release.js   Talks to /api/release; demo mode; admin preview mode
  core/status.js    Countdown + status bar
  ui/layout.js      Builds the header, nav and status bar on every page
  ui/modal.js       Dialogs
  ui/fx.js          SIGNAL ACQUIRED overlay + topic cutscene
  ui/chrome.js      Nav menu, settings buttons, page transitions, shortcuts, easter eggs
  game/sprites.js   Pixel-art character engine
  game/characters.js Default fighters (chairs), "?" silhouettes, released roster
  game/arena.js     Attract mode + the playable fighting/debate game
  pages/*.js        One module per page
  admin/admin.js    Admin control room
  main.js           Boots the page (loads last)

api/
  release.js      Public release endpoint (checks the server clock)
  admin.js        Admin login + status + pre-release preview (password checked here)
  _lib/content.js Shared helpers + content health check (not deployed as a function)

assets/  images, fonts, audio (music + sound effects), demo placeholder data
docs/    Content schema example + test results (not deployed)
```

The scripts are plain files that share one `window.FORMA` namespace. There are no ES modules or build step, so the site still works when you double-click `index.html`. Every page lists the modules it needs at the bottom of its HTML, in load order.

**Adding a page:** add an entry to `NAV` in `js/core/config.js`, create `yourpage.html` (copy any page), create `js/pages/yourpage.js` that sets `F.pages.yourpage = init…`, and add its script tag.

## How the secret stays secret

- **The repository contains zero crisis material.** No title, roster, factions or anything else is in HTML, CSS, JS, images or filenames.
- **The scenario lives in a Vercel environment variable** (`CRISIS_CONTENT_B64`). Only `api/release.js` reads it.
- **The server decides.** `/api/release` compares the **server's** clock with `RELEASE_AT`:
  - Before release, it returns only `{"status":"locked","releaseAt":…,"serverTime":…}`.
  - After release, it returns `{"status":"released", …, "content": { … }}`.
- **The countdown is cosmetic.** When it hits zero, the page only *asks* the server. Nothing is revealed until the server says `released`. A visitor who changes their computer clock gets nothing.
- **Content is kept in memory only.** It is never written to localStorage or sessionStorage.
- **If the endpoint is down**, the site stays locked and the status bar honestly shows `NO SIGNAL · RETRYING`. Retries back off from 2 s up to 60 s.
- **Automatic reveal.** A visitor sitting on the page sees it flip the moment the server confirms, with no refresh. Anyone who arrives later simply gets the released version.

## Open it locally (no server needed)

Double-click `index.html`. Everything works: navigation, character select, the playable game, countdown, sounds and settings. The admin panel needs the deployed site.

The status bar will say **FILE MODE**. A `file://` copy cannot reach the release endpoint, so it can never unlock. Scheduled release only works on the deployed Vercel site.

To preview what the released site looks like with **placeholder data**, add `?demo=1` to the address, e.g. `index.html?demo=1`. A yellow DEMO banner appears and all content is obviously fake. This is safe to keep public.

> To test the real endpoint from a local file, set `CONFIG.endpoint` at the top of `script.js` to your deployed URL, e.g. `https://your-project.vercel.app/api/release`.

## Admin control room (`/admin.html`)

The admin panel is not linked in the nav. Open `https://<your-site>/admin.html` and log in.

- **What it shows:** live release state and countdown, server time, whether the content variable is set and valid, a count of characters, factions and so on, and a health check that flags mistakes such as an unknown faction member or a bad special-move type.
- **Preview released site:** lets you see the whole site exactly as it will look after release, before release. Only a logged-in admin sees it; visitors get nothing.
- **Content encoder:** paste or load the content JSON, validate it, and copy the encoded value for `CRISIS_CONTENT_B64`. This runs in your browser.

**Security:** the username and password are **only** in Vercel environment variables. They never appear in the site code, so nobody can find them with Inspect.
- The server checks them in constant time.
- Five wrong attempts from one device lock it out for 15 minutes.
- Sessions are signed, expire after 8 hours and live only in that browser tab.
- Changing `ADMIN_SESSION_SECRET` logs everyone out.
- The lockout is per server instance, so a long random password is still your best protection.

The admin panel can't edit the live site by itself, because the brief rules out a database. To publish changes, encode the content here, paste it into Vercel, and redeploy.

## Deploy on Vercel

1. Push this folder to a **private or public** GitHub repo. It's safe either way, because nothing secret is in it.
2. In Vercel: **Add New → Project → Import** the repo. Framework preset: **Other**. No build command. Output directory: the repo root.
3. In **Project → Settings → Environment Variables**, add:

| Name | Value |
|---|---|
| `RELEASE_AT` | `2027-01-07T22:00:00+03:00` (22:00 Riyadh) |
| `CRISIS_CONTENT_B64` | your content JSON, base64-encoded (see below) |
| `ADMIN_USERNAME` | admin login name (see the private READ-ME-FIRST) |
| `ADMIN_PASSWORD` | admin password (see the private READ-ME-FIRST) |
| `ADMIN_SESSION_SECRET` | long random string that signs admin sessions |

4. Redeploy so the variables take effect.
5. Check it: open `https://<your-site>/api/release`. Before the release time it must say `"status":"locked"` and contain nothing else.

### Preparing the content

1. Write the approved content as JSON following `docs/release-content.schema.example.json`. Keep this file **outside** the repo; `.gitignore` also blocks `crisis-content*.json`.
2. Base64-encode it:
   - macOS / Linux: `base64 -i crisis-content.json | tr -d '\n'`
   - Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("crisis-content.json"))`
3. Paste the result as the value of `CRISIS_CONTENT_B64`.

Vercel allows about 64 KB of environment variables per deployment. That is plenty for text. Put large images on a host you control and reference them by URL in the JSON; they are only loaded after release.

`CRISIS_CONTENT` (raw JSON, not base64) also works if you prefer.

### Changing the release time

Update **both**:

- `RELEASE_AT` on Vercel (this is what actually controls release), and
- `CONFIG.releaseAt` in `script.js` (only the countdown display, before the first server reply).

### Character pixel art after release

Each character in the JSON carries a `look` object. The sprite engine draws it as a detailed 36×50 animated fighter with automatic light, shadow and outline:

```json
"look": { "skin": "#5a3a24", "hair": { "style": "close", "color": "#120d0d" }, "facial": "mustache", "glasses": "wire",
          "outfit": { "type": "suit", "jacket": "#2a2c33", "tie": "#1a1b22" } }
```

The full list of options (hair styles, facial hair, eyewear, hats, build, props, outfits) is in `docs/release-content.schema.example.json`. Before release, every slot is a glowing silhouette with a "?". An optional `portrait` URL shows in the character's dossier.

**Default fighters:** the two chairs are built in (`DEFAULT_CHARS` in `script.js`). They are always unlocked on the home screen and fight each other before release.

### Release sequence and arena behavior

When the server confirms release, visitors on the site see **SIGNAL ACQUIRED**. Then a **topic cutscene** shows the committee title from the content (`title`, plus `cutscene.date`, `cutscene.tagline` and `cutscene.disclaimer`). After about 7.5 seconds, or any key or click, it returns to the site. The length is `CONFIG.cutsceneMs`.

The arena runs CPU vs CPU until someone presses **▶ PLAY**. That opens full screen, counts down 3-2-1-FIGHT and gives the visitor control of the selected fighter against the CPU rival. Phones get on-screen buttons.

The chairs and the "?" silhouettes fight for real (K.O.). Released characters play the same game as a **debate battle**: hits throw words like OBJECTION!, the loser is OUT-ARGUED and the winner WINS THE FLOOR: taunts, no hits and no K.O. To make released characters fight physically too, set `CONFIG.fightAfterRelease = true` in `script.js`.

Each character's special move comes from `special` in the content JSON: `{ "name": "…", "type": "projectile | stream | wave | dash | uppercut | counter | flash", "color": "#hex" }`. Use `null` for standard moves only. Keeping these in the private content means move names can't hint at the topic.


## Updating the site

- **Text, layout, styles:** edit the page's HTML or the matching CSS module, then commit and push. Vercel redeploys automatically.
- **Nav or page list:** edit `NAV` in `js/core/config.js`. The header, nav and home menu all update from it.
- **Chair bios:** edit the placeholder paragraphs in `chairs.html` (search for `EDIT:`).
- **Chair portraits:** replace `assets/images/tamer-pixel.png` / `mutasim-pixel.png` (572×686 recommended). A labelled fallback shows if a file is missing.
- **Crisis updates after release:** change the `updates` array in the content JSON, re-encode, update `CRISIS_CONTENT_B64` and redeploy. Open pages pick up changes within ~5 minutes. This is a refresh, not a live stream.
- **Number of "?" slots before release:** `CONFIG.lockedSlots` in `script.js`. It is display-only and doesn't reveal the real roster size.

## Controls

| Key | Action |
|---|---|
| Arrow keys | Move through character select / menus / cards |
| Enter / Space | Select |
| ▶ PLAY / P | Fight the CPU full screen (3, 2, 1, FIGHT!) |
| ← → / A D | Move |
| ↑ / W / Space | Jump |
| ↓ / S | Block |
| J / Z | Punch |
| K / X | Kick |
| L / C | Special move (when the meter under your health bar is full) |
| M | Toggle sound: background music + effects (starts muted) |
| Esc | Close any dialog / leave a match |

The intro opens on an animated **first-person pixel-art scene**: you're on a 90s bedroom floor at dusk, holding a controller wired to a retro console and a big CRT TV that shows the game's title screen. Around you are a shelf of tapes, posters, a door with a jacket, a window onto the neighbourhood, a dresser with a VCR, a bed, and snacks on the rug. Pressing **POWER ON** zooms the camera into the TV, the screen flashes, and you land on the start menu. It's drawn in `js/ui/intro-scene.js`. Browsers only allow music after a tap or click, so that tap turns on sound and starts the intro music. **ENTER WITHOUT SOUND** keeps the site muted. The top bar has **SND** (sound) and **FX** (full or reduced effects) toggles.

**iPad and phones:** the game shows on-screen controls on any touch screen, including an iPad with a keyboard attached. It goes full screen where the browser allows it, and otherwise fills the screen. Scrolling and pinch-zoom are locked during a match. Reduced effects turn on automatically if the device asks for reduced motion.

There are two harmless easter eggs. One involves a very famous cheat code.

## Before you go live: checklist

- [ ] `/api/release` returns `locked` with no content before the deadline.
- [ ] `RELEASE_AT` on Vercel matches `CONFIG.releaseAt` in `script.js`.
- [ ] The repo has no content JSON and no `.env` file: `git log --all --stat | grep -i -E "env|crisis-content"` shows nothing.
- [ ] Chair bios replaced.
- [ ] Optional: test a release by setting `RELEASE_AT` a few minutes in the future on a **preview** deployment.
