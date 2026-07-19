'use strict';

// @regression — Draft Sites promotion: reviewing draft.sites.json entries,
// promoting them into sites.json, or dismissing them.
// Run with: npm run test:regression

const { test, expect } = require('@playwright/test');
const { resetData, readDraftSites, readSites } = require('./helpers/data');

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
    // toggleDraftSection() re-fetches /draftSites and re-renders the table on
    // every open; wait for that in-flight request to settle before acting on
    // the row, otherwise the re-render can wipe out the selection below.
    await page.waitForLoadState('networkidle');
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
