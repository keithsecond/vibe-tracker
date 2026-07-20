'use strict';

// @regression — Eightfold draft promotion: Eightfold-provider drafts route to
// filters.json under the `sdetOnly` object (keyed by domain, not category),
// while every other provider keeps promoting into sites.json.
// Run with: npm run test:regression

const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { resetData, readDraftSites, readSites, readFilters, DRAFT_SITES_FILE } = require('./helpers/data');

/** Append an Eightfold-provider draft entry to draft.sites.json. */
function addEightfoldDraft() {
  const draftData = JSON.parse(fs.readFileSync(DRAFT_SITES_FILE, 'utf8'));
  draftData.Draft.push({
    id: 'D-3',
    org: 'Nvidia',
    URL: 'https://nvidia.eightfold.ai/careers',
    Provider: 'Eightfold',
  });
  fs.writeFileSync(DRAFT_SITES_FILE, JSON.stringify(draftData, null, 2));
}

test.describe('@regression', () => {
  test.beforeEach(() => {
    resetData();
    addEightfoldDraft();
  });

  test('promoting an Eightfold draft moves it into filters.json sdetOnly with a derived subdomain/baseUrl', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#draftCount')).toHaveText('3');
    await page.getByRole('button', { name: /Draft Sites/ }).click();
    await page.locator(`#domain-D-3`).fill('nvidia.com');
    await page.locator('tr', { hasText: 'Nvidia' }).getByRole('button', { name: 'Promote' }).click();

    await expect(page.locator('#draftTable tbody tr')).toHaveCount(2);
    await expect.poll(() => readDraftSites().map((d) => d.id)).toEqual(['D-1', 'D-2']);
    await expect.poll(() => readFilters().sdetOnly?.E002).toBeTruthy();
    expect(readFilters().sdetOnly.E002).toMatchObject({
      id: 'E002',
      org: 'Nvidia',
      subdomain: 'nvidia',
      domain: 'nvidia.com',
      baseUrl: 'https://nvidia.eightfold.ai',
    });
    // sites.json is untouched by an Eightfold promotion.
    expect(readSites().Private).toHaveLength(1);
  });

  test('promoting an Eightfold draft without a domain alerts and makes no changes', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Draft Sites/ }).click();
    let dialogMessage = '';
    page.once('dialog', (dialog) => {
      dialogMessage = dialog.message();
      dialog.dismiss();
    });
    await page.locator('tr', { hasText: 'Nvidia' }).getByRole('button', { name: 'Promote' }).click();

    await expect.poll(() => dialogMessage).toContain('enter a domain');
    expect(readDraftSites().map((d) => d.id)).toEqual(['D-1', 'D-2', 'D-3']);
    expect(readFilters().sdetOnly.E002).toBeUndefined();
  });

  test('POST /promoteDraftSite rejects an Eightfold draft with a blank domain', async ({ request }) => {
    const res = await request.post('/promoteDraftSite', {
      data: { draftId: 'D-3', domain: '   ' },
    });
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/domain/i);
  });
});
