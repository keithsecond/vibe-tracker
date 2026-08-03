'use strict';

// @regression — Dismissing a draft site now demotes it into blocked.sites.json
// (design §7.1) so googleDiscovery never re-drafts it. Covers:
//   1. the file is created from scratch (no fixture ships one) with a B0001 id;
//   2. ids increment past existing (and non-conforming) entries;
//   3. dedup by canonical URL — a re-dismiss of an equivalent URL is a no-op;
//   4. canon() strips a trailing `/careers` and a trailing slash, either alone
//      or together, so those variants are recognized as the same site;
//   5. a `Blocked` field that isn't an array (malformed pre-existing file) is
//      recovered rather than throwing;
//   6. sibling data (the other draft, sites.json) is left untouched.
// Run with: npm run test:regression

const fs = require('fs');
const { test, expect } = require('@playwright/test');
const {
  resetData,
  readDraftSites,
  readSites,
  readBlockedSites,
  DRAFT_SITES_FILE,
  BLOCKED_SITES_FILE,
} = require('./helpers/data');

/** Append a draft entry to the disposable draft.sites.json copy. */
function seedDraft(entry) {
  const d = JSON.parse(fs.readFileSync(DRAFT_SITES_FILE, 'utf8'));
  d.Draft.push(entry);
  fs.writeFileSync(DRAFT_SITES_FILE, JSON.stringify(d, null, 2));
}

/** Overwrite the disposable blocked.sites.json copy with a specific scenario. */
function writeBlocked(obj) {
  fs.writeFileSync(BLOCKED_SITES_FILE, JSON.stringify(obj, null, 2));
}

const TODAY = new Date().toISOString().slice(0, 10);

test.describe('@regression blocked sites', () => {
  test.beforeEach(() => {
    resetData();
  });

  test('dismissing a draft creates blocked.sites.json and records the site', async ({ request }) => {
    expect(readBlockedSites()).toBeNull(); // no fixture ships one

    const res = await request.post('/dismissDraftSite', { data: { draftId: 'D-1' } });
    const body = await res.json();
    expect(body).toEqual({ success: true, blocked: true });

    expect(readBlockedSites()).toEqual({
      Blocked: [
        {
          id: 'B0001',
          org: 'Initrode',
          URL: 'https://initrode.example.com/careers/',
          Provider: 'Greenhouse',
          blockedAt: TODAY,
          source: 'dismiss',
        },
      ],
    });

    // Sibling data is untouched: the other draft survives, sites.json is unwritten.
    expect(readDraftSites().map((d) => d.id)).toEqual(['D-2']);
    expect(readSites().Private).toHaveLength(1);
  });

  test('dismissing two drafts with distinct URLs assigns incrementing B#### ids', async ({ request }) => {
    await request.post('/dismissDraftSite', { data: { draftId: 'D-1' } });
    await request.post('/dismissDraftSite', { data: { draftId: 'D-2' } });

    expect(readBlockedSites().Blocked.map((b) => b.id)).toEqual(['B0001', 'B0002']);
  });

  test('the next id skips a non-conforming existing id and uses the max real B#### id', async ({ request }) => {
    writeBlocked({
      Blocked: [
        { id: 'B0007', org: 'Stale', URL: 'https://stale.example.com', Provider: 'ADP', blockedAt: '2020-01-01', source: 'dismiss' },
        { id: 'not-an-id', org: 'Junk', URL: 'https://junk.example.com', Provider: 'ADP', blockedAt: '2020-01-01', source: 'dismiss' },
      ],
    });

    const res = await request.post('/dismissDraftSite', { data: { draftId: 'D-1' } });
    const body = await res.json();
    expect(body).toEqual({ success: true, blocked: true });

    const ids = readBlockedSites().Blocked.map((b) => b.id);
    expect(ids).toEqual(['B0007', 'not-an-id', 'B0008']);
  });

  test('dismissing a draft whose canonical URL is already blocked is a deduped no-op', async ({ request }) => {
    // Pre-block a variant URL that canonicalizes to the same value as D-1's
    // ("https://initrode.example.com/careers/" -> "https://initrode.example.com").
    writeBlocked({
      Blocked: [
        {
          id: 'B0001',
          org: 'Initrode',
          URL: 'https://initrode.example.com',
          Provider: 'Greenhouse',
          blockedAt: '2020-01-01',
          source: 'delete',
        },
      ],
    });

    const res = await request.post('/dismissDraftSite', { data: { draftId: 'D-1' } });
    const body = await res.json();
    expect(body).toEqual({ success: true, blocked: false });

    // No duplicate was appended — still exactly the pre-seeded entry.
    expect(readBlockedSites().Blocked).toHaveLength(1);
    expect(readBlockedSites().Blocked[0]).toEqual({
      id: 'B0001',
      org: 'Initrode',
      URL: 'https://initrode.example.com',
      Provider: 'Greenhouse',
      blockedAt: '2020-01-01',
      source: 'delete',
    });

    // The draft is still removed even though blocking was a no-op.
    expect(readDraftSites().map((d) => d.id)).toEqual(['D-2']);
  });

  test('canon() treats a bare trailing slash (no /careers) as equivalent for dedup', async ({ request }) => {
    seedDraft({ id: 'D-4', org: 'Umbrella Mirror', URL: 'https://umbrella.example.com/jobs', Provider: 'Lever' });
    // D-2's URL is "https://umbrella.example.com/jobs/" (trailing slash only, no
    // /careers) — canon() must strip that trailing slash too, not just /careers.
    await request.post('/dismissDraftSite', { data: { draftId: 'D-2' } });

    const res = await request.post('/dismissDraftSite', { data: { draftId: 'D-4' } });
    const body = await res.json();
    expect(body).toEqual({ success: true, blocked: false });
    expect(readBlockedSites().Blocked).toHaveLength(1);
  });

  test('canon() treats a bare /careers (no trailing slash) as equivalent for dedup', async ({ request }) => {
    seedDraft({ id: 'D-4', org: 'Initrode Mirror', URL: 'https://initrode.example.com/careers', Provider: 'Greenhouse' });
    // D-1's URL is "https://initrode.example.com/careers/" (/careers with a
    // trailing slash) — both forms must canonicalize to the same value.
    await request.post('/dismissDraftSite', { data: { draftId: 'D-1' } });

    const res = await request.post('/dismissDraftSite', { data: { draftId: 'D-4' } });
    const body = await res.json();
    expect(body).toEqual({ success: true, blocked: false });
    expect(readBlockedSites().Blocked).toHaveLength(1);
  });

  test('a genuinely different URL for the same org is not deduped', async ({ request }) => {
    seedDraft({ id: 'D-4', org: 'Initrode', URL: 'https://initrode.example.com/other-board', Provider: 'Greenhouse' });
    await request.post('/dismissDraftSite', { data: { draftId: 'D-1' } });

    const res = await request.post('/dismissDraftSite', { data: { draftId: 'D-4' } });
    const body = await res.json();
    expect(body).toEqual({ success: true, blocked: true });
    expect(readBlockedSites().Blocked).toHaveLength(2);
  });

  test('a malformed blocked.sites.json (Blocked not an array) is recovered rather than throwing', async ({ request }) => {
    writeBlocked({ Blocked: 'not-an-array' });

    const res = await request.post('/dismissDraftSite', { data: { draftId: 'D-1' } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, blocked: true });

    expect(readBlockedSites().Blocked).toEqual([
      {
        id: 'B0001',
        org: 'Initrode',
        URL: 'https://initrode.example.com/careers/',
        Provider: 'Greenhouse',
        blockedAt: TODAY,
        source: 'dismiss',
      },
    ]);
  });
});
