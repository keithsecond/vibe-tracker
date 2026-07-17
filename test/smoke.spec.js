'use strict';

// @smoke — fast, must-always-pass checks. The app boots, serves the page,
// its read endpoints respond, and the table/stats render from the data.
// Run with: npm run test:smoke

const { test, expect } = require('@playwright/test');
const { resetData } = require('./helpers/data');

test.describe('@smoke', () => {
  test.beforeEach(() => {
    resetData();
  });

  test('page loads with the tracker heading', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Vibe Tracker/i);
    await expect(page.getByRole('heading', { name: 'Job Application Tracker' })).toBeVisible();
  });

  test('GET /jobs responds with the data shape', async ({ request }) => {
    const res = await request.get('/jobs');
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data['Status Definitions']).toBeTruthy();
    expect(data.Acme.jobs.length).toBeGreaterThan(0);
  });

  test('GET /vendors responds with a vendor list excluding Status Definitions', async ({ request }) => {
    const res = await request.get('/vendors');
    expect(res.status()).toBe(200);
    const vendors = await res.json();
    expect(Array.isArray(vendors)).toBe(true);
    expect(vendors).toContain('Acme');
    expect(vendors).not.toContain('Status Definitions');
  });

  test('the jobs table renders rows from the data', async ({ page }) => {
    await page.goto('/');
    const rows = page.locator('#jobTable tbody tr');
    await expect(rows.first()).toBeVisible();
    // Fixtures contain 4 jobs across two vendors.
    await expect(rows).toHaveCount(4);
  });

  test('the statistics line populates with a total', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#stats')).toContainText('Total: 4');
  });
});
