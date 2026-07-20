'use strict';

// @regression — Supplements test/eightfold-promotion.spec.js with the edges its
// suite doesn't cover:
//   1. the id generator derives the next E-id from root-keyed tenants (the
//      shared fixture keys its root tenant "acme", so nothing there proves a
//      real E8xx root tenant is scanned for the max);
//   2. promotion into an initially-empty sdetOnly — the shape the shipped
//      prospects-data/filters.json +actually+ ships with;
//   3. the promoted entry carries exactly {id, org, subdomain, domain, baseUrl}
//      and no `filters` key, and the root tenant is left untouched;
//   4. the render branch — an eightfold row swaps the category <select> for a
//      domain input, and a normal row does the opposite;
//   5. the API rejects an eightfold promotion whose `domain` field is absent
//      (the shared suite only covers a whitespace-only domain).
// Run with: npm run test:regression

const fs = require('fs');
const { test, expect } = require('@playwright/test');
const {
  resetData,
  readDraftSites,
  readSites,
  readFilters,
  DRAFT_SITES_FILE,
  FILTERS_FILE,
} = require('./helpers/data');

const EF_DRAFT = {
  id: 'D-3',
  org: 'Nvidia',
  URL: 'https://nvidia.eightfold.ai/careers',
  Provider: 'eightfold',
};

/** Append a draft entry to the disposable draft.sites.json copy. */
function seedDraft(entry) {
  const d = JSON.parse(fs.readFileSync(DRAFT_SITES_FILE, 'utf8'));
  d.Draft.push(entry);
  fs.writeFileSync(DRAFT_SITES_FILE, JSON.stringify(d, null, 2));
}

/** Overwrite the disposable filters.json copy with a specific scenario. */
function writeFilters(obj) {
  fs.writeFileSync(FILTERS_FILE, JSON.stringify(obj, null, 4));
}

// A realistic filters.json: a filtered eightfold tenant keyed by its E-id plus
// an empty sdetOnly — mirrors the shipped prospects-data/filters.json.
const ROOT_TENANT = {
  E813: {
    id: 'E813',
    org: 'Starbucks',
    subdomain: 'starbucks',
    domain: 'starbucks.com',
    baseUrl: 'https://starbucks.eightfold.ai',
    filters: { filter_include_remote: '1' },
  },
};

test.describe('@regression eightfold promotion edges', () => {
  test.beforeEach(() => {
    resetData();
    seedDraft(EF_DRAFT);
  });

  test('derives the next E-id from a root-keyed tenant, into an empty sdetOnly', async ({ page }) => {
    writeFilters({ ...ROOT_TENANT, sdetOnly: {} });

    await page.goto('/');
    await page.getByRole('button', { name: /Draft Sites/ }).click();
    await page.fill('#domain-D-3', 'nvidia.com');
    await page.locator('tr', { hasText: 'Nvidia' }).getByRole('button', { name: 'Promote' }).click();

    // Next id is E814 = max(E813 root) + 1 — proves root tenants are scanned,
    // which the shared fixture (root key "acme") cannot show.
    await expect.poll(() => Object.keys(readFilters().sdetOnly)).toEqual(['E814']);

    // Exact shape: the required fields and nothing else (no stray `filters`).
    expect(readFilters().sdetOnly.E814).toEqual({
      id: 'E814',
      org: 'Nvidia',
      subdomain: 'nvidia',
      domain: 'nvidia.com',
      baseUrl: 'https://nvidia.eightfold.ai',
    });
    expect(readFilters().sdetOnly.E814).not.toHaveProperty('filters');

    // The root filtered tenant is untouched, and sites.json is not written.
    expect(readFilters().E813).toEqual(ROOT_TENANT.E813);
    expect(readSites().Private).toHaveLength(1);
    expect(readDraftSites().map((d) => d.id)).toEqual(['D-1', 'D-2']);
  });

  test('renders a domain input for eightfold rows and a category select for the rest', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Draft Sites/ }).click();

    const efRow = page.locator('tr', { hasText: 'Nvidia' });
    await expect(efRow.locator('#domain-D-3')).toBeVisible();
    await expect(efRow.locator('#cat-D-3')).toHaveCount(0);

    const normalRow = page.locator('tr', { hasText: 'Initrode' });
    await expect(normalRow.locator('#cat-D-1')).toBeVisible();
    await expect(normalRow.locator('#domain-D-1')).toHaveCount(0);
  });

  test('POST /promoteDraftSite rejects an eightfold draft with no domain field at all', async ({ request }) => {
    writeFilters({ ...ROOT_TENANT, sdetOnly: {} });

    const res = await request.post('/promoteDraftSite', { data: { draftId: 'D-3' } });
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/domain/i);

    // Nothing moved: the draft is still pending and sdetOnly stays empty.
    expect(readDraftSites().map((d) => d.id)).toContain('D-3');
    expect(readFilters().sdetOnly).toEqual({});
  });
});
