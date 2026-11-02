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

  test('directive form is present', async ({ page }) => {
    await page.goto('/committee.html');
    await expect(page.locator('#dir-delegation')).toBeVisible();
    await expect(page.locator('#dir-text')).toBeVisible();
    await expect(page.locator('#dir-submit')).toBeVisible();
  });

  test('submitting without delegation name shows error', async ({ page }) => {
    await page.goto('/committee.html');
    await page.locator('#dir-text').fill('Test directive text');
    await page.locator('#dir-submit').click();
    await expect(page.locator('#dir-msg')).toHaveText(/ENTER YOUR DELEGATION NAME/i);
  });

  test('submitting without text shows error', async ({ page }) => {
    await page.goto('/committee.html');
    await page.locator('#dir-delegation').fill('Germany');
    await page.locator('#dir-submit').click();
    await expect(page.locator('#dir-msg')).toHaveText(/WRITE YOUR DIRECTIVE/i);
  });

  test('submitting with both fields submits directive successfully', async ({ page }) => {
    test.skip(!ALLOW_WRITES, 'posts a real directive');
    await page.goto('/committee.html');
    await page.locator('#dir-delegation').fill('Germany');
    await page.locator('#dir-text').fill('We propose immediate ceasefire negotiations.');
    await page.locator('#dir-code').fill('local-code');
    await page.locator('#dir-submit').click();
    await expect(page.locator('#dir-msg')).toHaveText(/DIRECTIVE SUBMITTED/i, { timeout: 10_000 });
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

  test('PAGE TEXT section lists every page with editable text', async ({ page }) => {
    await adminLogin(page);
    await openPanel(page, 'site');
    await expect(page.locator('[data-site-body] .ed-fold')).toHaveCount(11);
  });
});

test.describe('Admin — preview', () => {
  test.skip(!ADMIN_PASS, 'set E2E_ADMIN_USER and E2E_ADMIN_PASS');

  async function openPreview(page, context) {
    const [tab] = await Promise.all([context.waitForEvent('page'), page.locator('[data-a="preview"]').click()]);
    await tab.waitForURL(/preview=1/);
    await expect(tab.locator('[data-preview-bar]')).toBeVisible();
    await expect(tab.locator('.preview-label')).toContainText(/PREVIEW ·/);
    return tab;
  }

  test('preview stays on across nav links and reloads, and the token leaves the URL', async ({ page, context }) => {
    await adminLogin(page);
    const tab = await openPreview(page, context);
    expect(tab.url()).not.toContain('at=');
    await tab.locator('#site-nav a', { hasText: 'BRIEFING' }).click();
    await tab.waitForURL(/briefing/);
    await expect(tab.locator('.preview-label')).toContainText(/PREVIEW ·/);
    await tab.reload();
    await expect(tab.locator('[data-release-status]').first()).toHaveText('DECLASSIFIED');
  });

  test('PLAY REVEAL plays the opening', async ({ page, context }) => {
    await adminLogin(page);
    const tab = await openPreview(page, context);
    await tab.locator('[data-preview-reveal]').click();
    await expect(tab.locator('.release-fx')).toBeVisible();
    await tab.locator('.release-fx').click();
    await expect(tab.locator('.cutscene')).toBeVisible();
  });

  test('EXIT returns to the public site', async ({ page, context }) => {
    await adminLogin(page);
    const tab = await openPreview(page, context);
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
    await expect(page.locator('[data-editor-status]')).toContainText('SAME AS PUBLISHED');
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
