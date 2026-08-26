'use strict';

// @regression — Manage Sites: deleting a registered site (design §7.2) removes
// its registry entry, its jobResults vendor block, and its description file,
// then blocks it (source: "delete", D2.3) so discovery never re-drafts it.
// Also covers Eightfold tenants (root + sdetOnly, D2.2), orphan vendors
// (jobResults keys with no registry entry, DATA-AUDIT §7.2 — NOT re-blocked),
// tolerant name-matching (§2.6), and the typed-confirmation UI.
// Run with: npm run test:regression

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
  resetData,
  readData,
  readSites,
  readFilters,
  readBlockedSites,
  readDescription,
  SITES_FILE,
  FILTERS_FILE,
  DATA_FILE,
  DESCRIPTION_DIR,
} = require('./helpers/data');

const TODAY = new Date().toISOString().slice(0, 10);

/** Merge patches into the disposable copies before a request. */
function patchSites(mutate) {
  const d = JSON.parse(fs.readFileSync(SITES_FILE, 'utf8'));
  mutate(d);
  fs.writeFileSync(SITES_FILE, JSON.stringify(d, null, 2));
}
function patchFilters(mutate) {
  const d = JSON.parse(fs.readFileSync(FILTERS_FILE, 'utf8'));
  mutate(d);
  fs.writeFileSync(FILTERS_FILE, JSON.stringify(d, null, 2));
}
function patchJobResults(mutate) {
  const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  mutate(d);
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
}
function writeDescription(stem, obj) {
  fs.writeFileSync(path.join(DESCRIPTION_DIR, `${stem}.description.json`), JSON.stringify(obj, null, 2));
}
function descriptionExists(stem) {
  return fs.existsSync(path.join(DESCRIPTION_DIR, `${stem}.description.json`));
}

test.describe('@regression manage sites', () => {
  test.beforeEach(() => {
    resetData();
  });

  // ---- GET /sites -----------------------------------------------------------

  test('GET /sites groups categories, Eightfold tenants, and orphan vendors', async ({ request }) => {
    const res = await request.get('/sites');
    expect(res.status()).toBe(200);
    const data = await res.json();

    expect(data.categories.Private.map((s) => s.id)).toEqual(['P001']);

    // Eightfold: the fixture root tenant (id acmeTenant) + the sdetOnly E001.
    const eightfoldIds = data.eightfold.map((e) => e.id).sort();
    expect(eightfoldIds).toEqual(['E001', 'acmeTenant']);
    expect(data.eightfold.find((e) => e.id === 'E001')).toMatchObject({ org: 'ExistingCo', scope: 'sdetOnly' });

    // Globex is in jobResults + has a description file but is in no registry.
    expect(data.orphans).toEqual([{ key: 'Globex', jobs: 2 }]);
  });

  // ---- Delete a registered site --------------------------------------------

  test('deleting a registered site removes registry + jobResults and blocks it (description absent)', async ({ request }) => {
    // Acme (P001) has a jobResults block but no description file in the fixture.
    const res = await request.post('/deleteSite', { data: { siteId: 'P001' } });
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      org: 'Acme',
      summary: { registry: 'yes', jobResults: 'yes', description: 'absent', blocked: true },
    });

    expect(readSites().Private).toEqual([]);
    expect(readData().Acme).toBeUndefined();

    const blocked = readBlockedSites().Blocked;
    expect(blocked).toHaveLength(3); // 2 seeded + Acme
    expect(blocked[2]).toEqual({
      id: 'B0003',
      org: 'Acme',
      URL: 'https://acme.example.com/careers/',
      Provider: 'Greenhouse',
      blockedAt: TODAY,
      source: 'delete',
    });
  });

  test('deleting a site removes all three artifacts when a description file exists', async ({ request }) => {
    patchSites((d) => {
      d.Public = [{ id: 'I999', org: 'Wayne', URL: 'https://wayne.example.com/careers', Provider: 'Lever' }];
    });
    patchJobResults((d) => {
      d.Wayne = { Site: 'Wayne', URL: 'https://wayne.example.com/careers', jobs: [{ id: 'W-1', title: 'QA', status: '0', date: '2026-04-01' }] };
    });
    writeDescription('Wayne', { Wayne: { jobs: [{ 'URL entity': 'W-1' }] } });

    const res = await request.post('/deleteSite', { data: { siteId: 'I999' } });
    expect(await res.json()).toEqual({
      success: true,
      org: 'Wayne',
      summary: { registry: 'yes', jobResults: 'yes', description: 'yes', blocked: true },
    });

    expect(readSites().Public).toEqual([]);
    expect(readData().Wayne).toBeUndefined();
    expect(descriptionExists('Wayne')).toBe(false);
    expect(readBlockedSites().Blocked.some((b) => b.org === 'Wayne' && b.source === 'delete')).toBe(true);
  });

  test('tolerant matching folds case when the registry org differs from the jobResults/description key (§2.6)', async ({ request }) => {
    patchSites((d) => {
      d.Public = [{ id: 'I999', org: 'CaseCo', URL: 'https://caseco.example.com/careers', Provider: 'Ashby' }];
    });
    patchJobResults((d) => {
      // key differs only by case — the tolerant matcher must still find it.
      d.caseco = { jobs: [{ id: 'C-1', title: 'SDET', status: '0', date: '2026-04-01' }] };
    });
    writeDescription('caseco', { caseco: { jobs: [{ 'URL entity': 'C-1' }] } });

    const res = await request.post('/deleteSite', { data: { siteId: 'I999' } });
    expect(await res.json()).toMatchObject({
      success: true,
      summary: { registry: 'yes', jobResults: 'yes', description: 'yes', blocked: true },
    });
    expect(readData().caseco).toBeUndefined();
    expect(descriptionExists('caseco')).toBe(false);
  });

  test('a registry entry with no results or description still deletes and reports the misses', async ({ request }) => {
    patchSites((d) => {
      d.Recruiters = [{ id: 'R999', org: 'LonelyReg', URL: 'https://lonely.example.com', Provider: 'ADP' }];
    });

    const res = await request.post('/deleteSite', { data: { siteId: 'R999' } });
    expect(await res.json()).toEqual({
      success: true,
      org: 'LonelyReg',
      summary: { registry: 'yes', jobResults: 'absent', description: 'absent', blocked: true },
    });
    expect(readSites().Recruiters).toEqual([]);
  });

  // ---- Eightfold tenants (D2.2) ---------------------------------------------

  test('deleting an Eightfold sdetOnly tenant removes it from filters.json and blocks its baseUrl', async ({ request }) => {
    const res = await request.post('/deleteSite', { data: { siteId: 'E001' } });
    expect(await res.json()).toEqual({
      success: true,
      org: 'ExistingCo',
      summary: { registry: 'yes', jobResults: 'absent', description: 'absent', blocked: true },
    });

    expect(readFilters().sdetOnly.E001).toBeUndefined();
    const blocked = readBlockedSites().Blocked;
    expect(blocked[blocked.length - 1]).toMatchObject({
      org: 'ExistingCo',
      URL: 'https://existingco.eightfold.ai',
      Provider: 'Eightfold',
      source: 'delete',
    });
  });

  test('deleting a root-level Eightfold tenant removes it from filters.json root', async ({ request }) => {
    patchFilters((d) => {
      d.E900 = { id: 'E900', org: 'RootCo', subdomain: 'rootco', domain: 'rootco.com', baseUrl: 'https://rootco.eightfold.ai', filters: {} };
    });

    const res = await request.post('/deleteSite', { data: { siteId: 'E900' } });
    expect(await res.json()).toMatchObject({ success: true, org: 'RootCo' });

    expect(readFilters().E900).toBeUndefined();
    expect(readBlockedSites().Blocked.some((b) => b.URL === 'https://rootco.eightfold.ai')).toBe(true);
  });

  // ---- Orphan vendors (DATA-AUDIT §7.2) -------------------------------------

  test('deleting an orphan vendor removes results + description but does NOT block it', async ({ request }) => {
    const before = readBlockedSites().Blocked.length; // fixture seeds 2

    const res = await request.post('/deleteSite', { data: { orphanKey: 'Globex' } });
    expect(await res.json()).toEqual({
      success: true,
      org: 'Globex',
      summary: { registry: 'n/a', jobResults: 'yes', description: 'yes', blocked: 'n/a' },
    });

    expect(readData().Globex).toBeUndefined();
    expect(descriptionExists('Globex')).toBe(false);
    // Orphans have no canonical URL to block — the block file is untouched.
    expect(readBlockedSites().Blocked).toHaveLength(before);
  });

  // ---- Error paths ----------------------------------------------------------

  test('deleting an unknown site id is a reported no-op', async ({ request }) => {
    const res = await request.post('/deleteSite', { data: { siteId: 'ZZZ999' } });
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/not found/i);
    expect(readSites().Private.map((s) => s.id)).toEqual(['P001']); // untouched
  });

  test('deleting an unknown orphan key is a reported no-op', async ({ request }) => {
    const res = await request.post('/deleteSite', { data: { orphanKey: 'DoesNotExist' } });
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/not found/i);
  });

  test('POST /deleteSite with no id is rejected', async ({ request }) => {
    const res = await request.post('/deleteSite', { data: {} });
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/missing/i);
  });

  // ---- UI --------------------------------------------------------------------

  test('the Manage Sites badge counts every deletable row on load', async ({ page }) => {
    await page.goto('/');
    // 1 Private (Acme) + 2 Eightfold (acmeTenant, E001) + 1 orphan (Globex).
    await expect(page.locator('#manageCount')).toHaveText('4');
  });

  test('opening the panel awaits the re-fetch before revealing (matches Draft #7 guard)', async ({ page }) => {
    await page.route('**/sites', async (route) => {
      await new Promise((r) => setTimeout(r, 300));
      await route.continue();
    });

    await page.goto('/');
    await page.getByRole('button', { name: /Manage Sites/ }).click();
    await expect(page.locator('#manageSection')).toBeHidden();
    await expect(page.locator('#manageSection')).toBeVisible();
    await expect(page.locator('tr', { hasText: 'P001' })).toContainText('Acme');
  });

  test('deleting a site through the typed-confirmation dialog removes it from the table', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Manage Sites/ }).click();
    await expect(page.locator('#manageSection')).toBeVisible();

    await page.locator('tr', { hasText: 'P001' }).getByRole('button', { name: 'Delete' }).click();

    const deleteBtn = page.locator('#confirmDeleteBtn');
    await expect(page.locator('#confirmModal')).toHaveClass(/open/);
    await expect(deleteBtn).toBeDisabled();

    await page.fill('#confirmInput', 'Acm'); // partial — still disabled
    await expect(deleteBtn).toBeDisabled();

    await page.fill('#confirmInput', 'Acme'); // exact — enabled
    await expect(deleteBtn).toBeEnabled();
    await deleteBtn.click();

    await expect(page.locator('#confirmModal')).not.toHaveClass(/open/);
    await expect.poll(() => readSites().Private).toEqual([]);
    await expect.poll(() => readData().Acme).toBeUndefined();
    // The Private group disappears once empty.
    await expect(page.locator('tr', { hasText: 'P001' })).toHaveCount(0);
  });
});
