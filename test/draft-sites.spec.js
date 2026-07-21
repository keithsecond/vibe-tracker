'use strict';

// @regression — Draft Sites promotion: reviewing draft.sites.json entries,
// promoting them into sites.json, or dismissing them.
// Run with: npm run test:regression

const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { resetData, readDraftSites, readSites, DRAFT_SITES_FILE } = require('./helpers/data');

test.describe('@regression', () => {
  test.beforeEach(() => {
    resetData();
  });

  test('GET /draftSites returns the pending draft entries', async ({ request }) => {
    const res = await request.get('/draftSites');
    expect(res.status()).toBe(200);
    const drafts = await res.json();
    expect(drafts.map((d) => d.id)).toEqual(['D-1', 'D-2']);
  });

  // Regression: a 0-byte or missing draft.sites.json is a valid "no drafts"
  // state (fresh data dir, or every draft already promoted/dismissed). It must
  // not 500 — that broke the front end's initial load so the app wouldn't
  // launch its Draft Sites panel.
  test('GET /draftSites returns [] when draft.sites.json is empty', async ({ request }) => {
    fs.writeFileSync(DRAFT_SITES_FILE, '');
    const res = await request.get('/draftSites');
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test('GET /draftSites returns [] when draft.sites.json is missing', async ({ request }) => {
    fs.rmSync(DRAFT_SITES_FILE, { force: true });
    const res = await request.get('/draftSites');
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test('the app still loads and shows a 0 count with an empty draft.sites.json', async ({ page }) => {
    fs.writeFileSync(DRAFT_SITES_FILE, '');
    await page.goto('/');
    await expect(page.locator('#draftCount')).toHaveText('0');
    await page.getByRole('button', { name: /Draft Sites/ }).click();
    await expect(page.locator('#draftSection')).toBeVisible();
    await expect(page.locator('#draftContent')).toContainText('No draft sites remaining');
  });

  test('promoting/dismissing against an empty draft.sites.json reports not-found instead of erroring', async ({ request }) => {
    fs.writeFileSync(DRAFT_SITES_FILE, '');
    const promote = await request.post('/promoteDraftSite', { data: { draftId: 'D-1', category: 'Private' } });
    expect(promote.status()).toBe(200);
    expect(await promote.json()).toMatchObject({ success: false, message: expect.stringMatching(/not found/i) });

    const dismiss = await request.post('/dismissDraftSite', { data: { draftId: 'D-1' } });
    expect(dismiss.status()).toBe(200);
    expect(await dismiss.json()).toMatchObject({ success: false, message: expect.stringMatching(/not found/i) });
  });

  test('opening the Draft Sites section renders pending entries with a count badge', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#draftCount')).toHaveText('2');
    await page.getByRole('button', { name: /Draft Sites/ }).click();
    const rows = page.locator('#draftTable tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Initrode');
  });

  test('promoting a draft site moves it into sites.json under the chosen category with a new id', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#draftCount')).toHaveText('2');
    await page.getByRole('button', { name: /Draft Sites/ }).click();
    await page.selectOption('#cat-D-1', 'Private');
    await page.locator('tr', { hasText: 'Initrode' }).getByRole('button', { name: 'Promote' }).click();

    await expect(page.locator('#draftTable tbody tr')).toHaveCount(1);
    await expect.poll(() => readDraftSites().map((d) => d.id)).toEqual(['D-2']);
    await expect.poll(() => readSites().Private?.map((s) => s.id)).toEqual(['P001', 'P002']);
    expect(readSites().Private[1]).toMatchObject({
      org: 'Initrode',
      URL: 'https://initrode.example.com/careers/',
      Provider: 'Greenhouse',
    });
  });

  test('opening the panel does not show an interactive table until the re-fetch resolves (regression for #7)', async ({ page }) => {
    await page.route('**/draftSites', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.continue();
    });

    await page.goto('/');
    await expect(page.locator('#draftCount')).toHaveText('2');

    await page.getByRole('button', { name: /Draft Sites/ }).click();
    // toggleDraftSection() re-fetches /draftSites on every open. Previously the
    // panel was made visible synchronously, before that fetch resolved, so the
    // stale-but-interactive table from the initial load was exposed while a
    // re-render was in flight — a selection made in that window could be
    // silently wiped out by the pending re-render. The panel must now stay
    // hidden until the fetch (and re-render) has completed.
    await expect(page.locator('#draftSection')).toBeHidden();
    await expect(page.locator('#draftSection')).toBeVisible();

    // Once visible, the table is stable: a selection made right away survives
    // and promotion succeeds.
    await page.selectOption('#cat-D-1', 'Private');
    await page.locator('tr', { hasText: 'Initrode' }).getByRole('button', { name: 'Promote' }).click();

    await expect(page.locator('#draftTable tbody tr')).toHaveCount(1);
    await expect.poll(() => readSites().Private?.map((s) => s.id)).toEqual(['P001', 'P002']);
  });

  test('promoting without selecting a category alerts and makes no changes', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#draftCount')).toHaveText('2');
    await page.getByRole('button', { name: /Draft Sites/ }).click();
    let dialogMessage = '';
    page.once('dialog', (dialog) => {
      dialogMessage = dialog.message();
      dialog.dismiss();
    });
    await page.locator('tr', { hasText: 'Initrode' }).getByRole('button', { name: 'Promote' }).click();

    await expect.poll(() => dialogMessage).toContain('select a category');
    expect(readDraftSites().map((d) => d.id)).toEqual(['D-1', 'D-2']);
  });

  test('POST /promoteDraftSite rejects an unknown category', async ({ request }) => {
    const res = await request.post('/promoteDraftSite', {
      data: { draftId: 'D-1', category: 'NotACategory' },
    });
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/Invalid category/i);
  });

  test('POST /promoteDraftSite rejects an unknown draft id', async ({ request }) => {
    const res = await request.post('/promoteDraftSite', {
      data: { draftId: 'nope', category: 'Private' },
    });
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/not found/i);
  });

  test('dismissing a draft site removes it without adding it to sites.json', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#draftCount')).toHaveText('2');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /Draft Sites/ }).click();
    await page.locator('tr', { hasText: 'Umbrella' }).getByRole('button', { name: 'Dismiss' }).click();

    await expect.poll(() => readDraftSites().map((d) => d.id)).toEqual(['D-1']);
    expect(readSites().Private).toHaveLength(1); // unchanged
  });

  test('POST /dismissDraftSite rejects an unknown draft id', async ({ request }) => {
    const res = await request.post('/dismissDraftSite', { data: { draftId: 'nope' } });
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/not found/i);
  });
});
