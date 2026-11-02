# FORMA MUN · Crisis Division

A 16-bit arcade, cyberpunk crisis-committee website. It is plain HTML, CSS and vanilla JavaScript, with no framework and no build step. It deploys as a static site on Vercel plus four small serverless functions: one releases the secret scenario at the right moment, one runs the admin panel, one runs live committee proceedings, and one serves editable public page text. Published content and committee data live in a Vercel KV store.

**Release time:** 7 January 2027, 22:00 Riyadh (`2027-01-07T22:00:00+03:00`).

---

## What's in the box

The site is split into small modules. Each file does one job, so you can change one part without touching the rest.

```
index.html … committee.html, admin.html   One file per page. Each page holds only its own <main> content.

css/
  base.css      Fonts, colour tokens, reset, CRT effect, buttons, panels, countdown
  layout.css    Top bar, nav, status bar, modal, page transition
  home.css      Home: arena, character select, signal panel, intro + power-on screen
  game.css      Playable game: PLAY button, full screen, 3-2-1, touch controls
  pages.css     Briefing, characters, factions, timeline, updates, locations, rules, intel, chairs
  fx.css        Release overlay, topic cutscene, reduced-effects rules (loaded last)
  admin.css     Admin control room
  committee.css Committee page + the admin Committee tab

js/
  core/config.js    Settings + SITE MAP (nav, menu, page list). Edit pages/nav here.
  core/util.js      DOM helpers, storage, events, time formatting
  core/sitecopy.js  Applies editable page text (anything tagged data-edit)
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
  admin/            Admin control room, one module per job:
    api.js          Server calls + shared state (F.Admin)
    fields.js       Form building blocks
    dashboard.js    Login, session, release status, health check, restore
    editor.js       All-fields forms + save draft / publish
    visual.js       Click-to-edit on the real pages + preview, both in a frame
    updates.js      Post crisis updates
    site.js         Page text list
    committee.js    Live committee controls
    report.js       Upload the chair report
    admin.js        Section switching (loads last)
  main.js           Boots the page (loads last)

api/
  release.js      Public release endpoint (checks the server clock)
  admin.js        Admin login + status + pre-release preview + publish (password checked here)
  committee.js    Caucus state, speakers list and public directives
  site.js         Public page text (never holds scenario content)
  report.js       Chair report PDF, locked until release
  _lib/content.js Shared helpers + content health check (not deployed as a function)
  _lib/auth.js    Session signing shared by the admin and committee endpoints
  _lib/kv.js      Vercel KV (Upstash REST) helper

assets/  images, fonts, audio (music + sound effects), demo placeholder data
docs/    Content schema example + test results (not deployed)
test/    Unit and browser tests (not deployed)
```

The scripts are plain files that share one `window.FORMA` namespace. There are no ES modules or build step, so the site still works when you double-click `index.html`. Every page lists the modules it needs at the bottom of its HTML, in load order.

**Adding a page:** add an entry to `NAV` in `js/core/config.js`, create `yourpage.html` (copy any page), create `js/pages/yourpage.js` that sets `F.pages.yourpage = init…`, and add its script tag.

## How the secret stays secret

- **The repository contains zero crisis material.** No title, roster, factions or anything else is in HTML, CSS, JS, images or filenames.
- **The scenario lives on the server:** in Vercel KV once anything has been published from the admin panel, otherwise in the `CRISIS_CONTENT_B64` environment variable. KV wins when both exist.
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

> To test the real endpoint from a local file, set `CONFIG.endpoint` in `js/core/config.js` to your deployed URL, e.g. `https://your-project.vercel.app/api/release`.

## Admin control room (`/admin.html`)

The admin panel is not linked in the nav. Open `https://<your-site>/admin.html` and log in.

The panel has one bar that is always visible, with **PREVIEW**, **SAVE DRAFT** and **PUBLISH**, and these sections:

- **Edit Site:** your real pages. Pick a page, click any outlined text and type. Blue text is public as soon as you publish. Pink text is the scenario and stays locked until release. Switch between **After Release** and **Before Release** to see both versions of a page.
- **Post Update:** write a crisis update and post it. Before release, updates are held privately and appear at the reveal. After release, they reach every open page within about 40 seconds, with a "new update" notice.
- **Committee:** set up and run caucuses, manage the speakers list, read and delete directives. It saves as you go. The delegate code is shown here.
- **Status:** release state and countdown, content health check, and **Restore previous version** to undo a publish.
- **More → All Fields:** everything as forms. Use this to add or remove characters, factions, events and other items, and to change fighter looks.
- **More → Page Text List:** all public text in one searchable list.
- **More → Chair Report:** upload or replace the chair report PDF. It names the scenario, so it stays in the private store, never in this repo. Visitors get a "not available" page until release, then it appears on the Briefing and Rules pages. Admins can open it any time.

**Editing flow:** change things, press PREVIEW to check them, then PUBLISH. Preview opens inside the panel, shows your latest changes even if unsaved, and needs no pop-ups. Saved drafts are private and survive closing the browser.

Publishing asks you to confirm if public text contains a scenario title or a character or faction name.

**Making new text editable:** add `data-edit="page.some-key"` to the element in the page's HTML. It appears in Page Text by itself.

**The release time** is not editable in the panel, on purpose: one wrong click could reveal the scenario. See "Changing the release time".

**Security:** the username and password are **only** in Vercel environment variables. They never appear in the site code, so nobody can find them with Inspect.
- The server checks them in constant time.
- Five wrong attempts from one device lock it out for 15 minutes.
- Sessions are signed, expire after 8 hours and live only in that browser tab.
- Changing `ADMIN_SESSION_SECRET` logs everyone out.
- The lockout is per server instance, so a long random password is still your best protection.

## Committee page (`/committee.html`)

Delegates see the live caucus, timers, speakers list and directives without logging in. Timers use the server's clock, so a wrong device clock doesn't matter. Open pages check for changes every 5 seconds during a caucus and every 15 seconds otherwise, and stop while the tab is hidden.

Posting a directive needs the **delegate code**, which only stops strangers from posting. It's the `DELEGATE_CODE` environment variable. Chairs can see it in the admin Committee tab. To change it, update the variable on Vercel and redeploy. If the variable is removed, anyone can post.

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
| `DELEGATE_CODE` | code delegates enter to post directives |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | added automatically when a KV store is connected (Project → Storage) |

4. Redeploy so the variables take effect.
5. Check it: open `https://<your-site>/api/release`. Before the release time it must say `"status":"locked"` and contain nothing else.

### Preparing the content

1. Write the approved content as JSON following `docs/release-content.schema.example.json`. Keep this file **outside** the repo; `.gitignore` also blocks `crisis-content*.json`.
2. Base64-encode it:
   - macOS / Linux: `base64 -i crisis-content.json | tr -d '\n'`
   - Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("crisis-content.json"))`
3. Paste the result as the value of `CRISIS_CONTENT_B64`.

Vercel allows about 64 KB of environment variables per deployment. That is plenty for text. Put large images on a host you control and reference them by URL in the JSON; they are only loaded after release.

`CRISIS_CONTENT` (raw JSON, not base64) also works if you prefer. This only seeds the site: after the first publish from the admin panel, KV takes over and these variables are ignored.

### Changing the release time

Update **both**:

- `RELEASE_AT` on Vercel (this is what actually controls release), and
- `CONFIG.releaseAt` in `js/core/config.js` (only the countdown display, before the first server reply).

### Character pixel art after release

Each character in the JSON carries a `look` object. The sprite engine draws it as a detailed 36×50 animated fighter with automatic light, shadow and outline:

```json
"look": { "skin": "#5a3a24", "hair": { "style": "close", "color": "#120d0d" }, "facial": "mustache", "glasses": "wire",
          "outfit": { "type": "suit", "jacket": "#2a2c33", "tie": "#1a1b22" } }
```

The full list of options (hair styles, facial hair, eyewear, hats, build, props, outfits) is in `docs/release-content.schema.example.json`. Before release, every slot is a glowing silhouette with a "?". An optional `portrait` URL shows in the character's dossier.

**Default fighters:** the two chairs are built in (`DEFAULT_CHARS` in `js/game/characters.js`). They are always unlocked on the home screen and fight each other before release.

### Release sequence and arena behavior

When the server confirms release, visitors on the site see **SIGNAL ACQUIRED**. Then a **topic cutscene** shows the committee title from the content (`title`, plus `cutscene.date`, `cutscene.tagline` and `cutscene.disclaimer`). After about 7.5 seconds, or any key or click, it returns to the site. The length is `CONFIG.cutsceneMs`.

The arena runs CPU vs CPU until someone presses **▶ PLAY**. That opens full screen, counts down 3-2-1-FIGHT and gives the visitor control of the selected fighter against the CPU rival. Phones get on-screen buttons.

The chairs and the "?" silhouettes fight for real (K.O.). Released characters play the same game as a **debate battle**: hits throw words like OBJECTION!, the loser is OUT-ARGUED and the winner WINS THE FLOOR: taunts, no hits and no K.O. To make released characters fight physically too, set `CONFIG.fightAfterRelease = true` in `js/core/config.js`.

Each character's special move comes from `special` in the content JSON: `{ "name": "…", "type": "projectile | stream | wave | dash | uppercut | counter | flash", "color": "#hex" }`. Use `null` for standard moves only. Keeping these in the private content means move names can't hint at the topic.


## Analytics

Vercel Web Analytics and Speed Insights run on the public pages. See them in the Vercel dashboard under the project's Analytics and Speed Insights tabs. The admin panel, previews and demo mode are left out on purpose.

## Updating the site

- **Text, layout, styles:** edit the page's HTML or the matching CSS module, then commit and push. Vercel redeploys automatically.
- **Nav or page list:** edit `NAV` in `js/core/config.js`. The header, nav and home menu all update from it.
- **Chair bios:** edit them in the admin panel's Page Text section.
- **Chair portraits:** replace `assets/images/tamer-pixel.png` / `mutasim-pixel.png` (572×686 recommended). A labelled fallback shows if a file is missing.
- **Crisis updates:** post them in the admin panel's Post Updates section. After release, open pages show them within 30 seconds.
- **Any public text:** edit it in the admin panel's Page Text section, no code needed.
- **Number of "?" slots before release:** `CONFIG.lockedSlots` in `js/core/config.js`. It is display-only and doesn't reveal the real roster size.

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

The intro opens on an animated **first-person pixel-art scene**: you're on a 90s bedroom floor at dusk, holding a controller wired to a retro console and a big CRT TV that shows the game's title screen. Around you are a shelf of tapes, posters, a door with a jacket, a window onto the neighbourhood, a dresser with a VCR, a bed, and snacks on the rug. Pressing **POWER ON** zooms the camera into the TV, the screen flashes, and you land on the start menu. It's drawn in `js/ui/intro-scene.js`. Browsers only allow music after a tap or click, so that tap turns on sound and starts the intro music. **ENTER WITHOUT SOUND** keeps the site muted. The top bar has **MUSIC** toggle.

**iPad and phones:** the game shows on-screen controls on any touch screen, including an iPad with a keyboard attached. It goes full screen where the browser allows it, and otherwise fills the screen. Scrolling and pinch-zoom are locked during a match.

There are two harmless easter eggs. One involves a very famous cheat code.

## Testing

```
npm run test:unit    # no network needed
npm run test:local   # the full browser suite, including writes, on a local server with a fake KV
```

To try the site yourself, run `node test/local-server.js` and open http://127.0.0.1:4801/admin.html (login `local-admin` / `local-password`). It uses placeholder content and never connects to anything real. Set `LOCAL_RELEASE_AT` to a time a minute away to rehearse the release moment.

`npx playwright test` on its own runs read-only checks against the live site. Test writes only on the local server: Vercel preview deployments share the production KV store, so writing on a preview changes live data. Never put real credentials in a test file. This repo is public.

## Before you go live: checklist

- [x] `/api/release` returns `locked` with no content before the deadline.
- [x] `RELEASE_AT` on Vercel matches `CONFIG.releaseAt` in `js/core/config.js`.
- [x] The repo has no content JSON and no `.env` file: `git log --all --stat | grep -i -E "\.env|crisis-content"` shows nothing.
- [x] Chair bios replaced.
- [x] Release moment rehearsed locally with placeholder content. Don't rehearse on a preview: it would serve the real scenario from a public URL.
