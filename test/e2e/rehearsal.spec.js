// @ts-check
/**
 * A whole committee session with a chair, two delegates and the projector open at once.
 *   npm run test:rehearsal
 * Local server only, already past release, with fictional data.
 */
const { test, expect, devices } = require('@playwright/test');

test.skip(!process.env.E2E_REHEARSAL, 'run with npm run test:rehearsal');
test.describe.configure({ mode: 'serial', retries: 0 });   // the fake store keeps state, so a retry can't start clean
test.setTimeout(240_000);

const ADA = 'Ada Fictional', BO = 'Bo Fictional';

test('one full session', async ({ browser }) => {
  const chairCtx = await browser.newContext();
  const adaCtx = await browser.newContext(devices['iPhone 13']);
  const boCtx = await browser.newContext();
  const screenCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const chair = await chairCtx.newPage();
  const ada = await adaCtx.newPage();
  const bo = await boCtx.newPage();
  const screen = await screenCtx.newPage();
  const errors = [];
  for (const p of [chair, ada, bo, screen]) {
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('dialog', (d) => d.accept());
  }
  const tab = (name) => chair.locator(`[data-crisis-tab="${name}"]`).click();
  const refreshChair = () => chair.evaluate(() => window.FORMA.Admin.crisis.pull());

  await test.step('chair logs in and sets up the delegates', async () => {
    await chair.goto('/admin.html');
    await chair.fill('#adm-user', 'local-admin');
    await chair.fill('#adm-pass', 'local-password');
    await chair.click('button[type="submit"]');
    await chair.locator('[data-panel="crisis"]').click();
    await chair.locator('[data-chair-name]').fill('Head Chair');
    await chair.locator('[data-chair-save]').click();
    await chair.evaluate(async (names) => { await window.FORMA.Admin.comm.send('delegate', { op: 'add', names }); }, [ADA, BO]);
    await refreshChair();
    await tab('people');
    await chair.locator('[data-codes-make]').click();
    await expect(chair.locator('[data-codes-fresh]')).toBeVisible();
    const ids = await chair.evaluate(() => window.FORMA.Admin.crisis.state.people);
    for (const p of ids) {
      await chair.evaluate(([id, faction]) => window.FORMA.Admin.crisis.send('person-set', { id, faction, character: '' }), [p.id, p.name === ADA ? 'Red Team' : 'Blue Team']);
    }
  });

  const code = async (name) => (await chair.locator(`[data-code="${name}"] .comm-code`).textContent()).trim();
  const adaCode = await code(ADA), boCode = await code(BO);
  const logIn = async (page, value) => {
    await page.goto('/committee.html');
    await page.locator('#desk-code').fill(value);
    await page.locator('#desk-login').click();
    await expect(page.locator('[data-desk-new]')).toBeVisible();
  };

  await test.step('delegates log in, each as themselves', async () => {
    await logIn(ada, adaCode.toLowerCase());
    await logIn(bo, boCode);
    await expect(ada.locator('[data-desk-name]')).toHaveText(ADA);
    await expect(ada.locator('[data-desk-body]')).toContainText('Red Team');
    await expect(bo.locator('[data-desk-name]')).toHaveText(BO);
  });

  await test.step('a draft saves itself and survives a reload', async () => {
    await ada.locator('[data-desk-new]').click();
    await ada.locator('#desk-title').fill('Secure the fictional harbour');
    await ada.locator('#desk-objective').fill('Keep trade moving');
    await expect(ada.locator('[data-desk-saved]')).toHaveText('SAVED', { timeout: 8000 });
    await ada.reload();
    await ada.locator('[data-desk-edit="Secure the fictional harbour"]').click();
    await expect(ada.locator('#desk-objective')).toHaveValue('Keep trade moving');
  });

  await test.step('required fields are asked for, then it sends', async () => {
    await ada.locator('[data-desk-submit]').click();
    await expect(ada.locator('[data-desk-msg]')).toHaveText(/OBJECTIVE AND REQUESTED ACTIONS/);
    await ada.locator('#desk-actions').fill('Send two fictional ships');
    await ada.locator('[data-desk-submit]').click();
    await expect(ada.locator('[data-desk-directive="Secure the fictional harbour"]')).toContainText('D-001');
  });

  await test.step('chair asks for changes, and the delegate is told', async () => {
    await refreshChair();
    await tab('live');
    await expect(chair.locator('[data-crisis-tile="DIRECTIVES TO REVIEW"]')).toContainText('1');
    await tab('directives');
    await chair.locator('[data-directive-open="D-001"]').click();
    await expect(chair.locator('[data-directive-detail]')).toContainText(ADA);
    await chair.locator('[data-decide="revise"]').click();
    await expect(chair.locator('[data-directive-detail]')).toBeVisible();     // refused: no reason yet
    await chair.locator('[data-review-reason]').fill('Say which ships');
    await chair.locator('[data-decide="revise"]').click();
    await expect(ada.locator('[data-desk-edit="Secure the fictional harbour"]')).toBeVisible({ timeout: 15000 });
    await expect(ada.locator('[data-desk-body]')).toContainText('Say which ships');
  });

  await test.step('the delegate sends a second version and the chair approves it', async () => {
    await ada.locator('[data-desk-edit="Secure the fictional harbour"]').click();
    await ada.locator('#desk-actions').fill('Send the two named fictional ships');
    await expect(ada.locator('[data-desk-saved]')).toHaveText('SAVED', { timeout: 8000 });
    await ada.locator('[data-desk-submit]').click();
    await expect(ada.locator('[data-desk-directive="Secure the fictional harbour"]')).toContainText('version 2');
    await refreshChair();
    await chair.locator('[data-directive-open="D-001"]').click();
    await expect(chair.locator('main')).toContainText('Send the two named fictional ships');
    await expect(chair.locator('main')).toContainText('VERSION 1');                    // the earlier version is kept
    await chair.locator('[data-decide="approve"]').click();
    await expect(ada.locator('[data-desk-directive="Secure the fictional harbour"]')).toContainText('APPROVED', { timeout: 15000 });
  });

  await test.step('the outcome is recorded and shared', async () => {
    await chair.locator('[data-directive-group="approved"]').click();
    await chair.locator('[data-directive-open="D-001"]').click();
    await chair.locator('[data-outcome-text]').fill('One ship arrived');
    await chair.getByLabel('TELL THE DELEGATE').check();
    await expect(chair.getByLabel('TELL THE DELEGATE')).toBeChecked();
    await chair.locator('[data-outcome-save]').click();
    await expect(ada.locator('[data-desk-body]')).toContainText('Outcome: One ship arrived', { timeout: 15000 });
    await chair.locator('[data-directive-back]').click();
  });

  await test.step('Bo never sees any of Ada\'s work', async () => {
    await bo.reload();
    await expect(bo.locator('[data-desk-new]')).toBeVisible();
    await expect(bo.locator('main')).not.toContainText('harbour');
    await expect(bo.locator('main')).not.toContainText('Say which ships');
  });

  await test.step('a faction update reaches only that faction', async () => {
    await tab('crisis');
    await chair.locator('[data-event-title]').fill('Fictional storm');
    await chair.locator('[data-event-save]').click();
    await chair.locator('[data-event-approve="E-001"]').click();
    await chair.locator('[data-event-write="E-001"]').click();
    await chair.locator('[data-update-body]').fill('Only the Red Team hears this');
    await chair.locator('[data-update-who]').selectOption('faction');
    await chair.getByText('Red Team', { exact: true }).first().click();
    await chair.locator('[data-update-save]').click();
    await chair.locator('[data-update-approve="U-001"]').click();
    await chair.locator('[data-update-publish="U-001"]').click();
    await expect(ada.locator('[data-desk-message="Fictional storm"]')).toBeVisible({ timeout: 15000 });
    await bo.reload();
    await expect(bo.locator('[data-desk-new]')).toBeVisible();
    await expect(bo.locator('main')).not.toContainText('Fictional storm');
  });

  await test.step('a public update reaches the projector', async () => {
    await screen.goto('/projector.html');
    await chair.locator('[data-update-headline]').fill('Public fictional bulletin');
    await chair.locator('[data-update-body]').fill('Everyone hears this');
    await chair.locator('[data-update-save]').click();
    await chair.locator('[data-update-approve="U-002"]').click();
    await chair.locator('[data-update-publish="U-002"]').click();
    await expect(screen.locator('[data-proj-update]', { hasText: 'Public fictional bulletin' })).toBeVisible({ timeout: 10000 });
    await expect(screen.locator('main')).not.toContainText('Fictional storm');
    await expect(screen.locator('main')).not.toContainText('Say which ships');
  });

  await test.step('a private message reaches one person, with a read receipt', async () => {
    await tab('messages');
    const bos = await chair.evaluate((name) => window.FORMA.Admin.crisis.state.people.find((p) => p.name === name).id, BO);
    await chair.locator('[data-message-to]').selectOption('d:' + bos);
    await chair.locator('[data-message-subject]').fill('For Bo alone');
    await chair.locator('[data-message-body]').fill('A private word');
    await chair.locator('[data-message-send]').click();
    await expect(bo.locator('[data-desk-message="For Bo alone"]')).toBeVisible({ timeout: 15000 });
    await ada.reload();
    await expect(ada.locator('[data-desk-new]')).toBeVisible();
    await expect(ada.locator('main')).not.toContainText('For Bo alone');
    await bo.locator('[data-desk-message="For Bo alone"] summary').click();
    await expect(bo.locator('[data-desk-message="For Bo alone"]')).toContainText('A private word');
    await expect(chair.locator('[data-sent-read]')).toHaveText('READ 1 / 1', { timeout: 12000 });
  });

  await test.step('a new code logs the old session out', async () => {
    await tab('people');
    await chair.locator(`[data-code-reset="${BO}"]`).click();
    await expect(chair.locator(`[data-code="${BO}"]`)).toBeVisible();
    await bo.reload();
    await expect(bo.locator('[data-desk-msg]')).toHaveText(/LOGIN ENDED/);
  });

  await test.step('nothing overflows on a phone, and the log holds the session', async () => {
    const overflow = await ada.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
    await tab('log');
    await expect(chair.locator('[data-crisis-log]')).toContainText('Directive resubmitted');
    await expect(chair.locator('[data-crisis-log]')).toContainText('Crisis update published');
    const [file] = await Promise.all([chair.waitForEvent('download'), chair.locator('[data-archive-download]').click()]);
    expect(file.suggestedFilename()).toMatch(/^crisis-archive-.*\.json$/);
  });

  expect(errors).toEqual([]);
  await Promise.all([chairCtx.close(), adaCtx.close(), boCtx.close(), screenCtx.close()]);
});
