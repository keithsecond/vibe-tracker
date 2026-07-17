'use strict';

// @regression — full behavioral coverage of the endpoints and UI flows.
// Run with: npm run test:regression

const { test, expect } = require('@playwright/test');
const { resetData, readData, readDescription, readDraftSites, readSites } = require('./helpers/data');

test.describe('@regression', () => {
  test.beforeEach(() => {
    resetData();
  });

  // ----- Add job (UI form) -----

  test('adds a job to an existing vendor', async ({ page }) => {
    await page.goto('/');
    await page.selectOption('#vendorSelect', 'Acme');
    await page.fill('#jobID', 'A-9');
    await page.fill('#jobTitle', 'QA Lead');
    await page.fill('#jobDate', '2026-05-01');
    await page.click('#jobForm button[type="submit"]');

    // Row appears in the table...
    await expect(page.locator('#jobTable tbody tr', { hasText: 'A-9' })).toBeVisible();
    // ...and is persisted to the data file.
    await expect
      .poll(() => readData().Acme.jobs.find((j) => j.id === 'A-9')?.title)
      .toBe('QA Lead');
  });

  test('adds a job under a brand-new vendor and normalizes the URL with a trailing slash', async ({ page }) => {
    await page.goto('/');
    await page.check('#newVendorCheck');
    await page.fill('#newVendorName', 'Initech');
    await page.fill('#vendorURL', 'https://initech.example.com'); // no trailing slash
    await page.fill('#jobID', 'I-1');
    await page.fill('#jobTitle', 'Release Engineer');
    await page.fill('#jobDate', '2026-05-02');
    await page.click('#jobForm button[type="submit"]');

    await expect
      .poll(() => readData().Initech?.URL)
      .toBe('https://initech.example.com/');
    expect(readData().Initech.jobs[0]).toMatchObject({ id: 'I-1', title: 'Release Engineer', status: '0' });
  });

  test('rejects a duplicate job id with an alert', async ({ page }) => {
    await page.goto('/');
    let dialogMessage = '';
    page.once('dialog', (dialog) => {
      dialogMessage = dialog.message();
      dialog.dismiss();
    });
    await page.selectOption('#vendorSelect', 'Acme');
    await page.fill('#jobID', 'A-1'); // already exists in the Acme fixture
    await page.fill('#jobTitle', 'Duplicate');
    await page.fill('#jobDate', '2026-05-03');
    await page.click('#jobForm button[type="submit"]');

    await expect.poll(() => dialogMessage).toContain('already exists');
    // No extra job was written.
    expect(readData().Acme.jobs.filter((j) => j.id === 'A-1')).toHaveLength(1);
  });

  test('POST /addJob rejects missing required fields at the API level', async ({ request }) => {
    const res = await request.post('/addJob', {
      data: { vendor: 'Acme', title: 'No id or date' },
    });
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/Missing required fields/i);
  });

  // ----- Status + decline -----

  test('updates a job status via the dropdown', async ({ page }) => {
    await page.goto('/');
    const row = page.locator('#jobTable tbody tr', { hasText: 'A-2' });
    await row.locator('select').selectOption('3'); // interviewing
    await expect
      .poll(() => readData().Acme.jobs.find((j) => j.id === 'A-2')?.status)
      .toBe('3');
  });

  test('declining a job sets status 4 and removes its description entry', async ({ page }) => {
    await page.goto('/');
    // Pre-condition: the description file has the entry we expect to be removed.
    expect(readDescription('Globex').Globex.jobs.map((j) => j['URL entity'])).toContain('G-100');

    const row = page.locator('#jobTable tbody tr', { hasText: 'G-100' });
    await row.locator('input[type="checkbox"]').check();

    await expect
      .poll(() => readData().Globex.jobs.find((j) => j.id === 'G-100')?.status)
      .toBe('4');
    await expect
      .poll(() => readDescription('Globex').Globex.jobs.map((j) => j['URL entity']))
      .toEqual(['G-200']); // G-100 removed, G-200 retained
  });

  // ----- Notes -----

  test('persists an edited note', async ({ page }) => {
    await page.goto('/');
    const notes = page.locator('#jobTable tbody tr', { hasText: 'A-1' }).locator('textarea');
    await notes.fill('called back on 2026-05-05');
    await notes.blur(); // onchange fires on blur
    await expect
      .poll(() => readData().Acme.jobs.find((j) => j.id === 'A-1')?.notes)
      .toBe('called back on 2026-05-05');
  });

  // ----- Search / filter / sort / rendering -----

  test('search box filters rows by title', async ({ page }) => {
    await page.goto('/');
    await page.fill('#searchBox', 'Platform');
    const rows = page.locator('#jobTable tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Platform Engineer');
  });

  test('site filter narrows rows to a single vendor', async ({ page }) => {
    await page.goto('/');
    await page.selectOption('#siteFilter', 'Acme');
    const rows = page.locator('#jobTable tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(page.locator('#jobTable tbody tr', { hasText: 'Globex' })).toHaveCount(0);
  });

  test('rows are ordered by status priority then date', async ({ page }) => {
    await page.goto('/');
    // Priority: reply(2) > interviewing(3) > new(0) > applied(1)
    // => G-100, G-200, A-1, A-2
    const ids = await page.locator('#jobTable tbody tr td:nth-child(3)').allInnerTexts();
    expect(ids.map((s) => s.trim())).toEqual(['G-100', 'G-200', 'A-1', 'A-2']);
  });

  test('shows a NEW badge only on new (status 0) jobs', async ({ page }) => {
    await page.goto('/');
    const newRow = page.locator('#jobTable tbody tr', { hasText: 'A-1' });
    await expect(newRow.locator('.badge')).toHaveText('NEW');
    const appliedRow = page.locator('#jobTable tbody tr', { hasText: 'A-2' });
    await expect(appliedRow.locator('.badge')).toHaveCount(0);
  });

  test('dark mode toggle persists across reload', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).not.toHaveClass(/dark/);
    await page.getByRole('button', { name: /Dark Mode/ }).click();
    await expect(page.locator('body')).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator('body')).toHaveClass(/dark/);
  });

  // ----- Draft sites -----

  test('GET /draftSites responds with the pending draft entries', async ({ request }) => {
    const res = await request.get('/draftSites');
    expect(res.status()).toBe(200);
    const drafts = await res.json();
    expect(drafts.map((d) => d.id)).toEqual(['D1', 'D2']);
  });

  test('draft sites section lists drafts and reflects the count badge', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#draftCount')).toHaveText('2');
    await page.getByRole('button', { name: /Draft Sites/ }).click();
    const rows = page.locator('#draftTable tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('NewCo');
  });

  test('promoting a draft site moves it into sites.json under the chosen category', async ({ page }) => {
    await page.goto('/');
    // Wait for the page's own background loadDraftSites() to settle before
    // toggling the panel, so its fetch doesn't race the one triggered below.
    await expect(page.locator('#draftCount')).toHaveText('2');
    await page.getByRole('button', { name: /Draft Sites/ }).click();
    // toggleDraftSection() re-fetches and re-renders the panel; wait for that
    // render to land before acting, so it can't overwrite the post-promote one.
    await expect(page.locator('#draftTable tbody tr')).toHaveCount(2);
    await page.locator('#cat-D1').selectOption('Private');
    await page.locator('#draftTable tbody tr', { hasText: 'NewCo' }).getByRole('button', { name: 'Promote' }).click();

    await expect(page.locator('#draftTable tbody tr')).toHaveCount(1);
    await expect
      .poll(() => readDraftSites().Draft.map((d) => d.id))
      .toEqual(['D2']);
    await expect
      .poll(() => readSites().Private.map((s) => s.id))
      .toEqual(['P001', 'P002']);
    expect(readSites().Private[1]).toMatchObject({ org: 'NewCo', URL: 'https://newco.example.com/careers', Provider: 'Greenhouse' });
  });

  test('POST /promoteDraftSite rejects an invalid category', async ({ request }) => {
    const res = await request.post('/promoteDraftSite', {
      data: { draftId: 'D1', category: 'NotACategory' },
    });
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/Invalid category/i);
  });

  test('dismissing a draft site removes it without promoting', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#draftCount')).toHaveText('2');
    await page.getByRole('button', { name: /Draft Sites/ }).click();
    await expect(page.locator('#draftTable tbody tr')).toHaveCount(2);
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#draftTable tbody tr', { hasText: 'Beta Inc' }).getByRole('button', { name: 'Dismiss' }).click();

    await expect(page.locator('#draftTable tbody tr')).toHaveCount(1);
    await expect
      .poll(() => readDraftSites().Draft.map((d) => d.id))
      .toEqual(['D1']);
    expect(readSites().Private).toHaveLength(1); // unchanged
  });
});
