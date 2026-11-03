// @ts-check
const { test, expect } = require('@playwright/test');

// Never hard-code credentials here: this repository is public.
const ADMIN_USER = process.env.E2E_ADMIN_USER;
const ADMIN_PASS = process.env.E2E_ADMIN_PASS;
// Tests that change stored data only run with E2E_ALLOW_WRITES=1. Point E2E_BASE_URL
// at a disposable environment first: preview deployments share the production KV store.
const ALLOW_WRITES = !!process.env.E2E_ALLOW_WRITES;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Log in via the admin page and return the page object (already on dashboard). */
async function adminLogin(page) {
  await page.goto('/admin.html');
  await expect(page.locator('[data-admin-login]')).toBeVisible();
  await page.fill('#adm-user', ADMIN_USER);
  await page.fill('#adm-pass', ADMIN_PASS);
  await page.click('button[type="submit"]');
  // Dashboard becomes visible, login form hides
  await expect(page.locator('[data-admin-dash]')).toBeVisible({ timeout: 15_000 });
}

/** Open a section of the control room. */
async function openPanel(page, name) {
  await page.locator(`[data-panel="${name}"]`).click();
}
/** Log in and open one tab of the scenario editor. */
async function openTab(page, tab) {
  await adminLogin(page);
  await openPanel(page, 'content');
  await page.locator(`[data-editor-tabs] [data-tab="${tab}"]`).click();
}

// ─── Public Site ──────────────────────────────────────────────────────────────

test.describe('Public site', () => {

  test('homepage loads with FORMA branding and nav', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/FORMA MUN/i);
    // Nav should contain key page labels
    const nav = page.locator('nav, [role="navigation"], header');
    await expect(nav.first()).toBeVisible();
    // Core nav items should appear somewhere on the page
    for (const label of ['HOME', 'UPDATES', 'RULES', 'CHAIRS']) {
      await expect(page.getByText(label).first()).toBeVisible();
    }
  });

  test('COMMITTEE nav link exists and leads to committee page', async ({ page }) => {
    await page.goto('/');
    // Verify the link is present in the nav before navigating
    const link = page.getByRole('link', { name: /committee/i }).first();
    await expect(link).toBeVisible();
    // Navigate directly — the intro dialog canvas intercepts pointer events on the homepage
    await page.goto('/committee.html');
    await expect(page).toHaveURL(/committee/);
    await expect(page.getByText('COMMITTEE', { exact: false }).first()).toBeVisible();
  });

  test('all standard nav pages return 200', async ({ page }) => {
    const pages = [
      '/index.html', '/briefing.html', '/characters.html', '/factions.html',
      '/timeline.html', '/updates.html', '/locations.html', '/rules.html',
      '/intel.html', '/chairs.html', '/committee.html'
    ];
    for (const path of pages) {
      const resp = await page.goto(path);
      expect(resp.status(), `${path} should return 200`).toBe(200);
    }
  });

  test('release API returns locked status', async ({ request }) => {
    const resp = await request.get('/api/release');
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.status).toBe('locked');
    expect(data.releaseAt).toContain(process.env.E2E_LOCAL ? '2099' : '2027');
  });

  test('site loads without JavaScript errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(errors.filter(e => !e.includes('favicon')), `JS errors: ${errors.join(', ')}`).toHaveLength(0);
  });

});

// ─── Committee page ───────────────────────────────────────────────────────────

test.describe('Committee page', () => {

  test('loads with all expected sections', async ({ page }) => {
    await page.goto('/committee.html');
    // Use role-based locators to avoid strict-mode ambiguity (the lead paragraph also contains these words)
    await expect(page.getByRole('heading', { name: 'CAUCUS STATUS' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'PUBLIC DIRECTIVES' })).toBeVisible();
    await expect(page.locator('#caucus-empty')).toBeVisible();
  });

  test('the delegate desk asks for a login code', async ({ page }) => {
    await page.goto('/committee.html');
    await expect(page.locator('#desk-code')).toBeVisible();
    await page.locator('#desk-login').click();
    await expect(page.locator('[data-desk-msg]')).toHaveText('ENTER YOUR CODE');
  });

  test('committee API returns valid JSON with idle caucus', async ({ request }) => {
    const resp = await request.get('/api/committee');
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    expect(data.ok).toBe(true);
    expect(data.caucus).toBeDefined();
    expect(data.caucus.status).toBe('idle');
    expect(Array.isArray(data.directives)).toBe(true);
  });

});

// ─── Admin page ───────────────────────────────────────────────────────────────

test.describe('Admin — login flow', () => {
  test.skip(!ADMIN_PASS, 'set E2E_ADMIN_USER and E2E_ADMIN_PASS');

  test('admin.html loads with login form', async ({ page }) => {
    await page.goto('/admin.html');
    await expect(page.locator('[data-admin-login]')).toBeVisible();
    await expect(page.locator('#adm-user')).toBeVisible();
    await expect(page.locator('#adm-pass')).toBeVisible();
  });

  test('wrong credentials show error message', async ({ page }) => {
    await page.goto('/admin.html');
    await page.fill('#adm-user', 'admin');
    await page.fill('#adm-pass', 'wrongpassword');
    await page.click('button[type="submit"]');
    const msg = page.locator('[data-login-msg]');
    await expect(msg).toHaveText(/WRONG USERNAME OR PASSWORD|INVALID/i, { timeout: 10_000 });
    await expect(msg).toHaveClass(/bad/);
  });

  test('correct credentials log in and show dashboard', async ({ page }) => {
    await page.goto('/admin.html');
    await page.fill('#adm-user', ADMIN_USER);
    await page.fill('#adm-pass', ADMIN_PASS);
    await page.click('button[type="submit"]');
    await expect(page.locator('[data-admin-dash]')).toBeVisible({ timeout: 15_000 });
    // Login panel should be hidden
    await expect(page.locator('[data-admin-login]')).toBeHidden();
  });

  test('dashboard shows release date and content status', async ({ page }) => {
    await adminLogin(page);
    await openPanel(page, 'overview');
    await expect(page.locator('[data-a="release"]')).toContainText(process.env.E2E_LOCAL ? '2099' : '2027');
    // Content health (OK or INVALID)
    const contentEl = page.locator('[data-a="content"]');
    await expect(contentEl).toBeVisible();
  });

});

test.describe('Admin — content editor', () => {
  test.skip(!ADMIN_PASS, 'set E2E_ADMIN_USER and E2E_ADMIN_PASS');

  test('content editor section is visible after login', async ({ page }) => {
    await adminLogin(page);
    await openPanel(page, 'content');
    await expect(page.locator('[data-admin-editor]')).toBeVisible();
    // Editor tabs bar should be rendered
    await expect(page.locator('[data-editor-tabs]')).toBeVisible();
  });

  test('all editor tabs are present', async ({ page }) => {
    await adminLogin(page);
    await openPanel(page, 'content');
    const tabs = ['GENERAL', 'CHARACTERS', 'FACTIONS', 'TIMELINE', 'LOCATIONS', 'INTEL', 'RESOURCES'];
    for (const tab of tabs) {
      await expect(page.locator('[data-editor-tabs]').getByRole('button', { name: tab })).toBeVisible();
    }
  });

  test('POST UPDATES section shows the update form', async ({ page }) => {
    await adminLogin(page);
    await openPanel(page, 'updates');
    await expect(page.locator('[data-update-post]')).toBeVisible();
  });

  test('GENERAL tab shows title field', async ({ page }) => {
    await openTab(page, 'general');
    await expect(page.locator('[data-editor-body]').getByText('TITLE', { exact: true }).first()).toBeVisible();
  });

  test('can type in the title field', async ({ page }) => {
    await openTab(page, 'general');
    const titleInput = page.locator('[data-editor-body] input[type="text"]').first();
    await titleInput.fill('OPERATION PLAYWRIGHT TEST');
    expect(await titleInput.inputValue()).toBe('OPERATION PLAYWRIGHT TEST');
    await expect(page.locator('[data-editor-status]')).toHaveText('UNSAVED CHANGES');
  });

  for (const [tab, label] of [['characters', /ADD CHARACTER/], ['factions', /ADD FACTION/], ['timeline', /ADD EVENT/], ['locations', /ADD LOCATION/], ['intel', /ADD DOSSIER/], ['resources', /ADD RESOURCE/]]) {
    test(`${tab} tab can add an item`, async ({ page }) => {
      await openTab(page, tab);
      await expect(page.getByRole('button', { name: label })).toBeVisible();
    });
  }

  test('COMMITTEE section loads', async ({ page }) => {
    await adminLogin(page);
    await openPanel(page, 'committee');
    await expect(page.locator('[data-committee-body]')).toContainText(/CAUCUS|KV/);
  });

  test('every form field has an id or a name', async ({ page }) => {
    await openTab(page, 'characters');
    await page.locator('.ed-fold summary').first().click();
    for (const panel of ['content', 'updates', 'committee', 'report']) {
      await openPanel(page, panel);
      await page.waitForTimeout(500);
      const unnamed = await page.locator('input, textarea, select').evaluateAll((els) => els.filter((e) => !e.id && !e.name).length);
      expect(unnamed, panel).toBe(0);
    }
  });

  test('PAGE TEXT section lists every page with editable text', async ({ page }) => {
    await adminLogin(page);
    await openPanel(page, 'site');
    await expect(page.locator('[data-site-body] .ed-fold')).toHaveCount(11);
  });
});

test.describe('Admin — running a committee', () => {
  test.skip(!ADMIN_PASS, 'set E2E_ADMIN_USER and E2E_ADMIN_PASS');
  test.skip(!process.env.E2E_LOCAL, 'changes committee data, so it only runs on the local server');
  test.describe.configure({ mode: 'serial' });

  const body = (page) => page.locator('[data-committee-body]');
  async function openCommittee(page) {
    await adminLogin(page);
    await openPanel(page, 'committee');
    await expect(page.locator('[data-comm-tab="run"]')).toBeVisible();
  }
  /** Starts from a clean moderated caucus, whatever an earlier test left behind. */
  async function freshCaucus(page) {
    page.on('dialog', (d) => d.accept());
    await openCommittee(page);
    await page.locator('[data-comm-tab="run"]').click();
    await page.evaluate(() => window.FORMA.Admin.comm.send('control', { op: 'clear' }));
    await page.evaluate(() => window.FORMA.Admin.comm.pull(true));
    await page.getByRole('button', { name: 'SET UP CAUCUS' }).click();
    await expect(page.locator('[data-comm-start]')).toBeVisible();
  }
  const pasteSpeakers = async (page, text) => {
    await page.locator('[data-paste-open]').click();
    await page.locator('[data-paste-box]').fill(text);
    await page.getByRole('button', { name: 'ADD TO QUEUE' }).click();
  };
  const rows = (page) => page.locator('[data-comm-queue] [data-speaker-row]');

  test('the draft buttons are hidden, because this section saves itself', async ({ page }) => {
    await openCommittee(page);
    await expect(page.locator('[data-editor-publish]')).toBeHidden();
    await openPanel(page, 'content');
    await expect(page.locator('[data-editor-publish]')).toBeVisible();
  });

  test('a pasted list is cleaned up, counted, and duplicates are skipped', async ({ page }) => {
    await freshCaucus(page);
    await page.locator('[data-paste-open]').click();
    await page.locator('[data-paste-box]').fill('1. Germany\n2) France\n• Japan\n- Brazil\n\nGermany\n7\tKenya\tNairobi\nItaly\r\nSpain\nChile\nPeru');
    await expect(page.locator('[data-paste-count]')).toHaveText('9 NEW');
    await page.getByRole('button', { name: 'ADD TO QUEUE' }).click();
    await expect(rows(page)).toHaveCount(9);
    await expect(rows(page).first()).toContainText('1. Germany');
    await expect(rows(page).nth(4)).toContainText('5. Kenya');
    await page.locator('[data-paste-open]').click();
    await page.locator('[data-paste-box]').fill('Germany, Canada; Egypt');
    await expect(page.locator('[data-paste-count]')).toHaveText('2 NEW · 1 ALREADY THERE');
    await page.getByRole('button', { name: 'ADD TO QUEUE' }).click();
    await expect(rows(page)).toHaveCount(11);
    await expect(body(page)).toContainText('SPEAKERS QUEUE (11)');
  });

  test('a full caucus runs from start to end, and a wrong NEXT can be undone', async ({ page }) => {
    await freshCaucus(page);
    await pasteSpeakers(page, 'Alpha\nBravo\nCharlie');
    await expect(rows(page)).toHaveCount(3);
    await page.locator('[data-comm-start]').click();
    await expect(page.locator('[data-comm-speaker-clock]')).toHaveText(/^0[01]:\d\d$/);
    await expect(rows(page).first().locator('.speaker-badge')).toHaveText('SPEAKING');
    await expect(page.locator('[data-comm-up-next]')).toHaveText('Up next: Bravo');

    await page.locator('[data-comm-main]').click();                       // the wrong press
    await expect(rows(page).nth(1).locator('.speaker-badge')).toHaveText('SPEAKING');
    await page.locator('[data-speak-now="Alpha"]').click();               // back to Alpha
    await expect(rows(page).first().locator('.speaker-badge')).toHaveText('SPEAKING');
    await expect(rows(page).nth(1).locator('.speaker-badge')).toHaveText('WAITING');

    await page.getByRole('button', { name: 'PAUSE' }).click();
    await expect(body(page)).toContainText('PAUSED');
    await expect(page.locator('[data-comm-main]')).toHaveText(/RESUME/);
    await page.locator('[data-comm-main]').click();

    await page.locator('[data-comm-main]').click();
    await page.locator('[data-comm-main]').click();
    await expect(rows(page).nth(2).locator('.speaker-badge')).toHaveText('SPEAKING');
    await expect(page.locator('[data-comm-main]')).toHaveText(/FINISH SPEAKER/);
    await page.locator('[data-comm-main]').click();
    await expect(page.locator('[data-comm-main]')).toHaveCount(0);

    await page.locator('[data-comm-end]').click();
    await expect(page.locator('[data-comm-summary]')).toContainText('3 speakers heard');
    await page.locator('[data-comm-reopen]').click();                     // a mistaken end
    await expect(page.locator('[data-comm-clock]')).toBeVisible();
    await page.locator('[data-comm-end]').click();
    await page.locator('[data-comm-new]').click();
    await expect(page.getByRole('button', { name: 'SET UP CAUCUS' })).toBeVisible();
  });

  test('time running out is shown, and more time can be added', async ({ page }) => {
    await freshCaucus(page);
    await pasteSpeakers(page, 'Solo');
    await page.locator('[data-comm-start]').click();
    await expect(page.locator('[data-comm-speaker-clock]')).toBeVisible();
    await page.evaluate(() => {                                            // jump the clock a long way forward
      const A = window.FORMA.Admin;
      A.clockOffset += 3600000;
    });
    await expect(page.locator('[data-comm-speaker-clock]')).toHaveText('TIME UP');
    await expect(page.locator('[data-comm-clock]')).toHaveText('TIME UP');
    await page.evaluate(() => { window.FORMA.Admin.clockOffset -= 3600000; });
    await page.getByRole('button', { name: '+30 SEC SPEAKER' }).click();
    await expect(page.locator('[data-comm-speaker-clock]')).toHaveText(/^01:[0-3]\d$/);
  });

  test('delegates: paste, roll call, rename, tap to add', async ({ page }) => {
    await freshCaucus(page);
    await page.locator('[data-comm-tab="delegates"]').click();
    await page.locator('[data-add-delegates]').click();
    await page.locator('[data-paste-box]').fill('Oman, Qatar, Kuwait');
    await page.getByRole('button', { name: 'SAVE DELEGATES' }).click();
    await expect(page.locator('[data-delegate-row="Oman"]')).toBeVisible();
    await expect(page.locator('[data-comm-present]')).toContainText(/\d+ \/ \d+/);

    await page.locator('[data-toggle="Qatar"]').click();
    await expect(page.locator('[data-toggle="Qatar"]')).toHaveText('ABSENT');

    await page.locator('[data-rename="Kuwait"]').click();
    const box = page.locator('[data-delegate-row="Kuwait"] input');
    await box.fill('State of Kuwait');
    await box.press('Enter');
    await expect(page.locator('[data-delegate-row="State of Kuwait"]')).toBeVisible();

    await page.locator('[data-comm-tab="run"]').click();
    await page.locator('[data-add-speaker="Oman"]').click();
    await expect(page.locator('[data-speaker-row="Oman"]')).toBeVisible();
    await expect(page.locator('[data-add-speaker="Oman"]')).toBeDisabled();

    await page.locator('[data-add-all-present]').click();
    await expect(page.locator('[data-speaker-row="State of Kuwait"]')).toBeVisible();
    await expect(page.locator('[data-speaker-row="Qatar"]')).toHaveCount(0);   // absent

    await page.locator('[data-comm-search]').fill('qat');
    await page.locator('[data-comm-search]').press('Enter');
    await expect(page.locator('[data-speaker-row="Qatar"]')).toBeVisible();
    await expect(page.locator('[data-comm-search]')).toBeFocused();

    await page.locator('[data-comm-start]').click();                       // Oman is first
    await expect(page.locator('[data-comm-clock]')).toBeVisible();
    await page.locator('[data-comm-tab="delegates"]').click();
    await expect(page.locator('[data-delegate-row="Oman"]')).toContainText('SPOKE 1');

    await page.evaluate(async () => {                                      // clean up for reruns
      const C = window.FORMA.Admin.comm;
      for (const d of C.delegates.slice()) await C.send('delegate', { op: 'remove', id: d.id });
    });
  });

  test('fast tapping loses nothing', async ({ page }) => {
    await freshCaucus(page);
    await page.evaluate(() => {
      const C = window.FORMA.Admin.comm;
      for (let i = 0; i < 12; i++) C.addSpeakers(['Fast ' + i]);
    });
    await expect(rows(page)).toHaveCount(12);
  });

  test('a second tab picks up changes, and typing survives the refresh', async ({ page, context }) => {
    await freshCaucus(page);
    const token = await page.evaluate(() => sessionStorage.getItem('forma:adminToken'));
    const other = await context.newPage();
    await other.addInitScript((t) => { sessionStorage.setItem('forma:adminToken', t); sessionStorage.setItem('forma:adminPanel', '"committee"'); }, token);
    await other.goto('/admin.html');
    await expect(other.locator('[data-comm-start]')).toBeVisible();
    const search = other.locator('[data-comm-search]');
    await search.fill('half-typed');
    await search.focus();
    await page.evaluate(() => window.FORMA.Admin.comm.addSpeakers(['From first tab']));
    await expect(rows(page)).toHaveCount(1);
    await other.evaluate(() => window.FORMA.Admin.comm.pull());
    await expect(search).toHaveValue('half-typed');                        // not redrawn while typing
    await expect(other.locator('[data-speaker-row]')).toHaveCount(0);
    await search.fill('');
    await search.blur();
    await other.evaluate(() => window.FORMA.Admin.comm.pull());
    await expect(other.locator('[data-speaker-row="From first tab"]')).toBeVisible();
    await other.close();
  });

  test('an expired session goes to the login screen', async ({ page }) => {
    await freshCaucus(page);
    await page.evaluate(() => sessionStorage.setItem('forma:adminToken', JSON.stringify('not-a-real-token')));
    await page.evaluate(() => window.FORMA.Admin.comm.addSpeakers(['Nobody']));
    await expect(page.locator('[data-admin-login]')).toBeVisible();
    await expect(page.locator('[data-login-msg]')).toHaveText(/SESSION EXPIRED/);
  });

  test('old public directives can be found and deleted only after confirming', async ({ page, request }) => {
    const old = { id: 'dir_old', delegation: 'Testland', text: 'Findable directive', time: new Date().toISOString() };
    await request.post('http://127.0.0.1:4803/', { data: ['HSET', 'crisis:directives:v2', old.id, JSON.stringify(old)] });
    await openCommittee(page);
    await page.locator('[data-comm-tab="directives"]').click();
    const card = body(page).locator('.comm-dir-card', { hasText: 'Findable directive' });
    await expect(card).toBeVisible();
    await page.once('dialog', (d) => d.dismiss());
    await card.locator('.ed-del').click();
    await expect(card).toBeVisible();
    await page.once('dialog', (d) => d.accept());
    await card.locator('.ed-del').click();
    await expect(card).toHaveCount(0);
  });
});

test.describe('Admin — Crisis Room', () => {
  test.skip(!ADMIN_PASS, 'set E2E_ADMIN_USER and E2E_ADMIN_PASS');
  test.skip(!process.env.E2E_LOCAL, 'changes committee data, so it only runs on the local server');
  test.describe.configure({ mode: 'serial' });

  const body = (page) => page.locator('[data-crisis-body]');
  async function openRoom(page, name = 'Sara') {
    await adminLogin(page);
    await openPanel(page, 'crisis');
    await page.locator('[data-chair-name]').fill(name);
    await page.locator('[data-chair-save]').click();
    await expect(page.locator('[data-crisis-tab="live"]')).toBeVisible();
  }

  test('asks who is using it, and the draft buttons stay hidden', async ({ page }) => {
    await adminLogin(page);
    await openPanel(page, 'crisis');
    await expect(body(page)).toContainText('WHO IS USING THIS?');
    await page.locator('[data-chair-save]').click();
    await expect(page.locator('[data-crisis-tab="live"]')).toHaveCount(0);       // a name is required
    await page.locator('[data-chair-name]').fill('Sara');
    await page.locator('[data-chair-name]').press('Enter');
    await expect(body(page)).toContainText('Using this as Sara');
    await expect(page.locator('[data-editor-publish]')).toBeHidden();
    await expect(page.locator('[data-a="preview"]')).toBeHidden();
  });

  test('a chair note reaches the feed with the chair name, and only once', async ({ page }) => {
    await openRoom(page);
    const text = 'Note ' + Date.now();
    await page.locator('[data-crisis-note]').fill(text);
    await page.locator('[data-crisis-note-add]').dblclick();
    const row = page.locator('[data-crisis-feed] li', { hasText: text });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Sara');
    await expect(page.locator('[data-crisis-note]')).toHaveValue('');
  });

  test('a caucus run from the Committee tab shows here under the right name', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    await openRoom(page, 'Omar');
    await page.evaluate(() => window.FORMA.Admin.comm.send('control', { op: 'clear' }));
    await page.locator('[data-crisis-open-committee]').click();
    await expect(page.locator('[data-panel-id="committee"]')).toBeVisible();
    await page.locator('[data-comm-tab="run"]').click();
    await page.getByRole('button', { name: 'SET UP CAUCUS' }).click();
    await page.locator('[data-comm-start]').click();
    await expect(page.locator('[data-comm-clock]')).toBeVisible();
    await openPanel(page, 'crisis');
    await expect(page.locator('[data-crisis-caucus]')).toHaveText('MODERATED CAUCUS LIVE');
    await expect(page.locator('[data-crisis-clock]')).toHaveText(/^\d\d:\d\d$/);
    const row = page.locator('[data-crisis-feed] li', { hasText: 'Caucus started' }).first();
    await expect(row).toContainText('Omar');
    await page.evaluate(() => window.FORMA.Admin.comm.send('control', { op: 'stop' }));
  });

  test('a second chair sees changes without refreshing, and typing is kept', async ({ page, context }) => {
    await openRoom(page, 'Sara');
    const token = await page.evaluate(() => sessionStorage.getItem('forma:adminToken'));
    const other = await context.newPage();
    await other.addInitScript((t) => {
      sessionStorage.setItem('forma:adminToken', t);
      sessionStorage.setItem('forma:adminPanel', '"crisis"');
      sessionStorage.setItem('forma:chairName', '"Omar"');
    }, token);
    await other.goto('/admin.html');
    await expect(other.locator('[data-crisis-feed]')).toBeVisible();
    await other.locator('[data-crisis-note]').fill('half-typed');
    const text = 'From Sara ' + Date.now();
    await page.locator('[data-crisis-note]').fill(text);
    await page.locator('[data-crisis-note-add]').click();
    await expect(other.locator('[data-crisis-note]')).toHaveValue('half-typed');
    await other.locator('[data-crisis-note]').fill('');
    await other.locator('[data-crisis-note]').blur();
    await expect(other.locator('[data-crisis-feed] li', { hasText: text })).toBeVisible({ timeout: 12_000 });
    await other.close();
  });

  test('the full log opens and pages back', async ({ page }) => {
    await openRoom(page);
    await page.evaluate(async () => {
      const R = window.FORMA.Admin.crisis;
      for (let i = 0; i < 55; i++) await R.send('note', { text: 'Log filler ' + i });
    });
    await page.locator('[data-crisis-tab="log"]').click();
    await expect(page.locator('[data-crisis-log] li')).toHaveCount(50);
    await page.locator('[data-crisis-more]').click();
    await expect(page.locator('[data-crisis-log] li').nth(50)).toBeVisible();
    await page.locator('[data-crisis-tab="live"]').click();
  });

  test('losing the connection is shown, not hidden', async ({ page, context }) => {
    await openRoom(page);
    await context.route('**/api/crisis**', (route) => route.abort());
    await expect(page.locator('[data-crisis-offline]')).toBeVisible({ timeout: 12_000 });
    await context.unroute('**/api/crisis**');
    await expect(page.locator('[data-crisis-offline]')).toHaveCount(0, { timeout: 12_000 });
  });
});

test.describe('Crisis Room — a full session', () => {
  test.skip(!ADMIN_PASS, 'set E2E_ADMIN_USER and E2E_ADMIN_PASS');
  test.skip(!process.env.E2E_LOCAL, 'changes committee data, so it only runs on the local server');
  test.describe.configure({ mode: 'serial' });

  const send = (page, action, body) => page.evaluate(([a, b]) => window.FORMA.Admin.crisis.send(a, b), [action, body]);
  async function chair(page) {
    page.on('dialog', (d) => d.accept());
    await adminLogin(page);
    await openPanel(page, 'crisis');
    await page.locator('[data-chair-name]').fill('Sara');
    await page.locator('[data-chair-save]').click();
    await expect(page.locator('[data-crisis-tab="motions"]')).toBeVisible();
  }
  const tab = (page, name) => page.locator(`[data-crisis-tab="${name}"]`).click();
  /** Delegates log in only after release, so this waits for the fake store's rehearsal switch. */
  async function logIn(page, code) {
    await page.goto('/committee.html');
    await page.locator('#desk-code').fill(code);
    await page.locator('#desk-login').click();
  }
  const run = Date.now().toString(36);
  const names = [`Ada ${run}`, `Bo ${run}`, `Cy ${run}`];
  let codes = {};

  test('chairs add delegates, make codes and link factions', async ({ page }) => {
    await chair(page);
    await page.evaluate(async (list) => {
      const C = window.FORMA.Admin.comm;
      await C.send('control', { op: 'clear' });
      for (const d of (await C.send('delegate', { op: 'all-present' })).delegates || []) await C.send('delegate', { op: 'remove', id: d.id });
      await C.send('delegate', { op: 'add', names: list });
    }, names);
    await page.evaluate(() => window.FORMA.Admin.crisis.pull());
    await tab(page, 'people');
    await page.locator('[data-codes-make]').click();
    await expect(page.locator('[data-codes-fresh]')).toBeVisible();
    for (const name of names) codes[name] = (await page.locator(`[data-code="${name}"] .comm-code`).textContent()).trim();
    expect(Object.values(codes).every((c) => /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(c))).toBe(true);
    const ids = await page.evaluate(() => window.FORMA.Admin.crisis.state.people);
    for (const p of ids) await send(page, 'person-set', { id: p.id, faction: p.name.startsWith('Ada') ? 'Red Team' : 'Blue Team', character: '' });
    await page.reload();
    await tab(page, 'people');
    await expect(page.locator(`[data-person="${names[0]}"]`)).toContainText('HAS CODE');
  });

  test('a motion goes from proposal to vote to a caucus on the Committee tab', async ({ page }) => {
    await chair(page);
    await tab(page, 'motions');
    await page.locator('[data-motion-proposer]').fill(names[0]);
    await page.locator('[data-motion-topic]').fill('Harbour talks');
    await page.locator('[data-motion-add]').click();
    const row = page.locator('[data-motion]', { hasText: 'Harbour talks' }).first();
    await row.locator('[data-motion-in-order]').click();
    await row.locator('[data-motion-vote]').click();
    await expect(page.locator('[data-vote-open]')).toContainText('3 voters');
    await page.locator('[data-vote-count="for"]').fill('2');
    await page.locator('[data-vote-count="against"]').fill('1');
    await page.locator('[data-vote-close]').click();
    await expect(page.locator('[data-vote]').first()).toContainText('PASSED');
    await page.locator('[data-motion]', { hasText: 'Harbour talks' }).first().locator('[data-motion-carry]').click();
    await expect(page.locator('[data-panel-id="committee"]')).toBeVisible();
    await expect(page.locator('[data-comm-start]')).toBeVisible();
    await expect(page.locator('[data-committee-body]')).toContainText('Harbour talks');
  });

  test('before release a delegate code is refused', async ({ page }) => {
    test.skip(!codes[names[0]], 'needs the codes from the first test');
    await logIn(page, codes[names[0]]);
    await expect(page.locator('[data-desk-msg]')).toHaveText('LOGIN OPENS AT RELEASE');
  });

  test('a busy moment is retried for the chair without any fuss', async ({ page }) => {
    await chair(page);
    let calls = 0;
    await page.route('**/api/crisis?action=note*', (route) => (calls++ ? route.continue()
      : route.fulfill({ status: 409, contentType: 'application/json', body: '{"ok":false,"code":"busy"}' })));
    const saved = await page.evaluate(() => window.FORMA.Admin.crisis.send('note', { text: 'Retry check' }));
    expect(calls).toBe(2);
    expect(saved.ok).toBe(true);
  });

  test('the projector shows only public information', async ({ page, context }) => {
    await chair(page);
    await page.evaluate(() => window.FORMA.Admin.crisis.send('note', { text: 'PRIVATE CHAIR NOTE' }));
    await send(page, 'session-set', { number: 2, phase: 'Formal debate', banner: 'Welcome back' });
    await page.evaluate(() => window.FORMA.Admin.comm.send('control', { op: 'start' }));
    const screen = await context.newPage();
    await screen.goto('/projector.html');
    await expect(screen.locator('[data-proj-session]')).toContainText('SESSION 2');
    await expect(screen.locator('[data-proj-banner]')).toHaveText('Welcome back');
    await expect(screen.locator('[data-proj-clock]')).toHaveText(/^\d\d:\d\d$/);
    await expect(screen.locator('main')).toContainText('Harbour talks');
    await expect(screen.locator('main')).not.toContainText('PRIVATE CHAIR NOTE');
    await expect(screen.locator('[data-proj-link]')).toHaveText('LIVE');
    await page.evaluate(() => window.FORMA.Admin.comm.send('control', { op: 'stop' }));
    await screen.close();
  });
});

test.describe('Admin — edit site and preview', () => {
  test.skip(!ADMIN_PASS, 'set E2E_ADMIN_USER and E2E_ADMIN_PASS');

  const frameOf = (page, box) => page.frameLocator(`${box} iframe`);

  test('EDIT SITE opens first and shows a real page', async ({ page }) => {
    await adminLogin(page);
    await expect(page.locator('[data-panel-id="edit"]')).toBeVisible();
    await expect(frameOf(page, '[data-vis-frame]').locator('main')).toBeVisible();
  });

  test('moving between pages keeps the content', async ({ page }) => {
    await adminLogin(page);
    await page.locator('[data-vis-page="rules.html"]').click();
    await expect(frameOf(page, '[data-vis-frame]').locator('main h1')).toContainText('RULES');
    await page.locator('[data-vis-page="briefing.html"]').click();
    await expect(frameOf(page, '[data-vis-frame]').locator('[data-release-status]').first()).toHaveText('DECLASSIFIED');
  });

  test('clicking public text edits it, and preview shows it unsaved', async ({ page }) => {
    await adminLogin(page);
    await page.locator('[data-vis-page="rules.html"]').click();
    const lead = frameOf(page, '[data-vis-frame]').locator('.lead');
    await expect(lead).toHaveAttribute('data-vedit', 'site');
    await lead.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Edited by clicking');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-editor-status]')).toHaveText('UNSAVED CHANGES');
    await page.locator('[data-a="preview"]').click();
    const frame = frameOf(page, '[data-prev-frame]');
    await frame.locator('#site-nav a', { hasText: 'RULES' }).click();
    await expect(frame.locator('.lead')).toHaveText('Edited by clicking');
    await page.locator('[data-prev-close]').click();
    await expect(page.locator('[data-preview-overlay]')).toBeHidden();
  });

  test('clicking scenario text edits the content everywhere it appears', async ({ page }) => {
    await adminLogin(page);
    await page.locator('[data-vis-page="briefing.html"]').click();
    const title = frameOf(page, '[data-vis-frame]').locator('[data-vedit="scenario"]').first();
    await title.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('New scenario text');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-editor-status]')).toHaveText('UNSAVED CHANGES');
    const found = await page.evaluate(() => JSON.stringify(window.FORMA.Admin.content).includes('New scenario text'));
    expect(found).toBe(true);
  });

  test('Esc cancels an edit', async ({ page }) => {
    await adminLogin(page);
    await page.locator('[data-vis-page="rules.html"]').click();
    const lead = frameOf(page, '[data-vis-frame]').locator('.lead');
    const before = await lead.textContent();
    await lead.click();
    await page.keyboard.type('x');
    await page.keyboard.press('Escape');
    await expect(lead).toHaveText(before);
  });

  test('links in the editor switch page instead of leaving it', async ({ page }) => {
    await adminLogin(page);
    await frameOf(page, '[data-vis-frame]').locator('main a[href^="characters"], main a[href^="chairs"]').first().click();
    await expect(page.locator('[data-vis-page].active')).toHaveText(/CHARACTERS|CHAIRS/);
  });

  test('preview opens in the panel with no new tab, and plays the reveal', async ({ page, context }) => {
    await adminLogin(page);
    const tabs = context.pages().length;
    await page.locator('[data-a="preview"]').click();
    const frame = frameOf(page, '[data-prev-frame]');
    await expect(frame.locator('[data-release-status]').first()).toHaveText('DECLASSIFIED');
    expect(context.pages().length).toBe(tabs);
    await page.locator('[data-prev-reveal]').click();
    await frame.locator('.release-fx').click();
    await expect(frame.locator('.cutscene')).toBeVisible();
  });

  test('preview stays on across links inside the frame', async ({ page }) => {
    await adminLogin(page);
    await page.locator('[data-a="preview"]').click();
    const frame = frameOf(page, '[data-prev-frame]');
    await frame.locator('#site-nav a', { hasText: 'BRIEFING' }).click();
    await expect(frame.locator('main h1')).toContainText('BRIEFING');
    await expect(frame.locator('[data-release-status]').first()).toHaveText('DECLASSIFIED');
  });

  test('BEFORE RELEASE shows the locked site', async ({ page }) => {
    await adminLogin(page);
    await page.locator('[data-a="preview"]').click();
    await page.locator('[data-prev-view="before"]').click();
    const frame = frameOf(page, '[data-prev-frame]');
    await expect(frame.locator('main')).toBeVisible();
    await expect(frame.locator('[data-release-status]').first()).toHaveText('LOCKED');
    await expect(page.locator('[data-prev-reveal]')).toBeHidden();
  });

  test('a page named like the frame gets no content without a login', async ({ page }) => {
    await page.goto('/briefing.html');
    await page.evaluate(() => { window.name = 'forma-embed'; });
    await page.reload();
    await expect(page.locator('main')).toContainText('STAND BY');
    await expect(page.locator('[data-release-status]').first()).not.toHaveText('DECLASSIFIED');
  });

  test('saved draft opens in a new tab with the preview bar', async ({ page, context }) => {
    await adminLogin(page);
    await page.locator('[data-a="preview"]').click();
    const [tab] = await Promise.all([context.waitForEvent('page'), page.locator('[data-prev-newtab]').click()]);
    await expect(tab.locator('[data-preview-bar]')).toBeVisible();
    await expect(tab.locator('[data-release-status]').first()).toHaveText('DECLASSIFIED');
    await tab.locator('[data-preview-exit]').click();
    await expect(tab.locator('[data-preview-bar]')).toHaveCount(0);
  });

  test('without a login, preview shows no content', async ({ page }) => {
    await page.goto('/briefing.html?preview=1');
    await expect(page.locator('.preview-label')).toContainText('NEEDS A LOGIN');
    await expect(page.locator('[data-release-status]').first()).not.toHaveText('DECLASSIFIED');
  });
});

test.describe('Admin — saving and publishing', () => {
  test.skip(!ADMIN_PASS || !ALLOW_WRITES, 'writes data: local server only (npm run test:local)');

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { window.confirm = () => true; });
  });

  test('a draft reloads after sign-in and can be discarded', async ({ page }) => {
    await openTab(page, 'general');
    await page.locator('[data-editor-body] input[type="text"]').first().fill('E2E DRAFT TITLE');
    await page.locator('[data-editor-save]').click();
    await expect(page.locator('[data-editor-status]')).toContainText('DRAFT SAVED');
    await page.reload();
    await expect(page.locator('[data-a="draft-banner"]')).toContainText('DRAFT LOADED');
    await page.locator('[data-discard-draft]').click();
    await expect(page.locator('[data-a="draft-banner"]')).toBeEmpty();
  });

  test('an update can be posted and deleted', async ({ page }) => {
    await adminLogin(page);
    await openPanel(page, 'updates');
    const body = page.locator('[data-updates-body]');
    await body.getByPlaceholder('Short update headline…').fill('E2E update');
    await page.locator('[data-update-post]').click();
    await expect(body).toContainText('E2E update');
    await body.locator('.ed-card', { hasText: 'E2E update' }).locator('[data-update-delete]').click();
    await expect(body).not.toContainText('E2E update');
  });

  test('published page text appears for visitors, then can be restored', async ({ page, browser }) => {
    await adminLogin(page);
    await openPanel(page, 'site');
    const body = page.locator('[data-site-body]');
    await body.locator('input[type=search]').fill('Roll call');
    await body.locator('textarea').first().fill('**Roll call.** E2E edited text');
    await page.locator('[data-editor-publish]').click();
    await expect(page.locator('[data-editor-status]')).toContainText('PUBLISHED');
    const visitor = await (await browser.newContext({ baseURL: page.url().replace(/\/admin.*/, '') })).newPage();
    await visitor.goto('/rules.html');
    await expect(visitor.locator('main')).toContainText('E2E edited text');
    await visitor.context().close();
    await openPanel(page, 'overview');
    await page.locator('[data-a="restore"]').click();
    await openPanel(page, 'content');
    await expect(page.locator('[data-editor-status]')).toContainText('SAME AS PUBLISHED');
  });
});

test.describe('Map, fighters and countdown', () => {
  test.skip(!ADMIN_PASS, 'set E2E_ADMIN_USER and E2E_ADMIN_PASS');
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  const previewLocations = async (page, image) => {
    await adminLogin(page);
    await page.evaluate((src) => {
      const A = window.FORMA.Admin;
      A.content.map = Object.assign({}, A.content.map, { image: src });
      A.content.locations = [{ id: 'one', name: 'Place', type: 'SITE', x: 50, y: 50 }];
    }, image);
    await page.locator('[data-a="preview"]').click();
    const frame = page.frameLocator('[data-prev-frame] iframe');
    await frame.locator('#site-nav a', { hasText: 'LOCATIONS' }).click();
    await expect(frame.locator('.map .pin')).toHaveCount(1);
    return frame;
  };

  test('an embedded PNG shows as the map', async ({ page }) => {
    const frame = await previewLocations(page, PNG);
    await expect(frame.locator('img.map-image')).toHaveAttribute('src', PNG);
  });

  test('embedded data that is not a PNG is refused', async ({ page }) => {
    const frame = await previewLocations(page, 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==');
    await expect(frame.locator('img.map-image')).toHaveCount(0);
  });

  test('a location symbol shows on its pin and in its details', async ({ page }) => {
    await adminLogin(page);
    await page.evaluate((src) => {
      window.FORMA.Admin.content.locations = [{ id: 'one', name: 'Place', type: 'SITE', x: 50, y: 50, icon: src, symbol: 'THE SYMBOL', symbolNote: 'Why it matters' }];
    }, PNG);
    await page.locator('[data-a="preview"]').click();
    const frame = page.frameLocator('[data-prev-frame] iframe');
    await frame.locator('#site-nav a', { hasText: 'LOCATIONS' }).click();
    await frame.locator('.map .pin.has-icon').click();
    await expect(frame.locator('.loc-symbol')).toContainText('THE SYMBOL');
    await expect(frame.locator('.map-wrap', { has: frame.locator('.pin.has-icon') })).not.toContainText('[object');
  });

  test('content can add pixel art to a fighter, and bad art is ignored', async ({ page }) => {
    await page.goto('/characters.html');
    const result = await page.evaluate(() => {
      const F = window.FORMA;
      const look = { skin: '#c68a5c', hair: { style: 'close', color: '#1c1530' }, outfit: { type: 'suit', jacket: '#2a2c33', tie: '#1a1b22' } };
      const data = (key, extra) => F.Sprite.toCanvas({ key, name: key, look: { ...look, ...extra } }, { scale: 1 }).toDataURL();
      return { art: data('plain', {}) !== data('art', { overlay: [[14, 2, 6, 6, '#ffffff']] }), bad: data('plain2', {}) === data('bad', { overlay: [[1, 2], 'x', [1, 2, 3, 4, 'red']] }) };
    });
    expect(result).toEqual({ art: true, bad: true });
  });

  test('countdown digits fit inside their boxes at every width', async ({ page }) => {
    for (const width of [1920, 1440, 1100, 820, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const file of ['/briefing.html', '/index.html']) {
        await page.goto(file);
        await page.waitForTimeout(400);
        // The local server's far-future date gives a five-digit day count; measure a real one.
        const worst = await page.locator('.cd-box').evaluateAll((boxes) => Math.max(...boxes.map((b) => {
          b.querySelector('.cd-num').textContent = '888';
          const n = b.querySelector('.cd-num').getBoundingClientRect(), r = b.getBoundingClientRect();
          return Math.max(r.left - n.left, n.right - r.right);
        })));
        expect(worst, file + ' at ' + width).toBeLessThanOrEqual(-1);
      }
    }
  });
});

test.describe('Admin — chair report', () => {
  test.skip(!ADMIN_PASS || !ALLOW_WRITES, 'writes data: local server only (npm run test:local)');

  test('upload, stay locked for visitors, then remove', async ({ page, request }) => {
    await page.addInitScript(() => { window.confirm = () => true; });
    await adminLogin(page);
    await openPanel(page, 'report');
    const body = Buffer.concat([Buffer.from('%PDF-1.7 '), Buffer.alloc(700000, 65)]);
    await page.locator('#report-file').setInputFiles({ name: 'report.pdf', mimeType: 'application/pdf', buffer: body });
    await expect(page.locator('[data-report-state]')).toContainText('ON THE SITE', { timeout: 15_000 });
    expect((await request.get('/api/report')).status()).toBe(404);
    await page.locator('[data-report-remove]').click();
    await expect(page.locator('[data-report-state]')).toHaveCount(0);
  });

  test('the report shows in after-release views and opens for an admin', async ({ page }) => {
    await page.addInitScript(() => { window.confirm = () => true; });
    await adminLogin(page);
    await openPanel(page, 'report');
    const body = Buffer.concat([Buffer.from('%PDF-1.7 '), Buffer.alloc(5000, 65)]);
    await page.locator('#report-file').setInputFiles({ name: 'report.pdf', mimeType: 'application/pdf', buffer: body });
    await expect(page.locator('[data-report-state]')).toContainText('ON THE SITE', { timeout: 15_000 });

    await page.locator('[data-a="preview"]').click();
    const frame = page.frameLocator('[data-prev-frame] iframe');
    await frame.locator('#site-nav a', { hasText: 'BRIEFING' }).click();
    const button = frame.locator('[data-chair-report]');
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('href', /^blob:/);
    // This test browser has no PDF viewer, so check the file the link points at.
    const file = await button.evaluate(async (link) => { const b = await (await fetch(link.href)).blob(); return { type: b.type, size: b.size }; });
    expect(file).toEqual({ type: 'application/pdf', size: body.length });

    await frame.locator('#site-nav a', { hasText: 'RULES' }).click();
    await expect(frame.locator('a', { hasText: 'Chair Report' })).toBeVisible();

    await page.locator('[data-prev-view="before"]').click();
    await frame.locator('#site-nav a', { hasText: 'BRIEFING' }).click();
    await expect(frame.locator('[data-chair-report]')).toHaveCount(0);

    await page.locator('[data-prev-close]').click();
    await openPanel(page, 'report');
    await page.locator('[data-report-remove]').click();
    await expect(page.locator('[data-report-state]')).toHaveCount(0);
  });

  test('a file that is not a PDF is refused', async ({ page }) => {
    await adminLogin(page);
    await openPanel(page, 'report');
    await page.locator('#report-file').setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf') });
    await expect(page.locator('[data-report-msg]')).toHaveText('THAT FILE IS NOT A PDF');
  });
});

test.describe('Analytics', () => {
  test('nothing loads off Vercel, so local copies stay quiet', async ({ page }) => {
    test.skip(!process.env.E2E_LOCAL, 'local server only');
    const hits = [];
    page.on('request', (r) => { if (r.url().includes('/_vercel/')) hits.push(r.url()); });
    await page.goto('/index.html');
    await page.waitForTimeout(800);
    expect(hits).toEqual([]);
  });
});

test.describe('Effects', () => {
  test('there is no effects button, and old or device settings cannot lower effects', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await context.addInitScript(() => { try { localStorage.setItem('forma:fxLow', 'true'); } catch (e) {} });
    const page = await context.newPage();
    await page.goto('/briefing.html');
    await expect(page.getByRole('button', { name: /^FX/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^MUSIC/ })).toBeVisible();
    expect(await page.evaluate(() => window.FORMA.Settings.lowMotion)).toBe(false);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.glitch')).animationDuration)).not.toBe('0.001s');
    await context.close();
  });
});

test.describe('Admin — session', () => {
  test.skip(!ADMIN_PASS, 'set E2E_ADMIN_USER and E2E_ADMIN_PASS');

  test('LOGOUT clears session and shows login form', async ({ page }) => {
    await adminLogin(page);
    await page.locator('[data-a="logout"]').click();
    await expect(page.locator('[data-admin-login]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-admin-dash]')).toBeHidden();
  });
});
