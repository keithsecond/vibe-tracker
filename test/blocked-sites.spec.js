'use strict';

// @regression — Dismissing a draft site demotes it into blocked.sites.json
// (design §7.1) so googleDiscovery never re-drafts it.
//
// The fixture seeds two prior blocks (B0001 Globex via dismiss, B0002 Soylent
// via delete), like the other fixtures, so the common path here is *appending
// to an existing file*. Covers:
//   1. append past the seeded entries with the next B#### id;
//   2. ids increment past the seeded max (and skip non-conforming ids);
//   3. dedup by canonical URL — a re-dismiss of an equivalent URL is a no-op;
//   4. canon() strips a trailing `/careers` and a trailing slash, either alone
//      or together, so those variants are recognized as the same site;
//   5. a `Blocked` field that isn't an array (malformed file) is recovered;
//   6. an unknown draft id is a no-op that leaves the block file untouched;
//   7. the file is still created from scratch (B0001) when it is absent;
//   8. sibling data (the other draft, sites.json) is left untouched.
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
// The two ids the fixture ships with (see test/fixtures/blocked.sites.json).
const SEED_IDS = ['B0001', 'B0002'];

test.describe('@regression blocked sites', () => {
  test.beforeEach(() => {
    resetData();
  });

  test('dismissing a draft appends it to the existing blocked.sites.json with the next id', async ({ request }) => {
    expect(readBlockedSites().Blocked.map((b) => b.id)).toEqual(SEED_IDS); // fixture ships two prior blocks

    const res = await request.post('/dismissDraftSite', { data: { draftId: 'D-1' } });
    const body = await res.json();
    expect(body).toEqual({ success: true, blocked: true });

    const blocked = readBlockedSites().Blocked;
    expect(blocked).toHaveLength(3);
    // The seeded entries are preserved and the new one is appended with B0003.
    expect(blocked.slice(0, 2).map((b) => b.id)).toEqual(SEED_IDS);
    expect(blocked[2]).toEqual({
      id: 'B0003',
      org: 'Initrode',
      URL: 'https://initrode.example.com/careers/',
      Provider: 'Greenhouse',
      blockedAt: TODAY,
      source: 'dismiss',
    });

    // Sibling data is untouched: the other draft survives, sites.json is unwritten.
    expect(readDraftSites().map((d) => d.id)).toEqual(['D-2']);
    expect(readSites().Private).toHaveLength(1);
  });

  test('successive dismissals get incrementing B#### ids past the seeded max', async ({ request }) => {
    await request.post('/dismissDraftSite', { data: { draftId: 'D-1' } });
    await request.post('/dismissDraftSite', { data: { draftId: 'D-2' } });

    expect(readBlockedSites().Blocked.map((b) => b.id)).toEqual(['B0001', 'B0002', 'B0003', 'B0004']);
  });

  test('the next id skips a non-conforming existing id and uses the max real B#### id', async ({ request }) => {
    // Overwrites the seed with a scenario that pins the id-generation branch.
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

    const blocked = readBlockedSites().Blocked;
    expect(blocked).toHaveLength(3); // 2 seeded + 1 Umbrella (D-4 deduped)
    expect(blocked.filter((b) => b.URL.includes('umbrella'))).toHaveLength(1);
  });

  test('canon() treats a bare /careers (no trailing slash) as equivalent for dedup', async ({ request }) => {
    seedDraft({ id: 'D-4', org: 'Initrode Mirror', URL: 'https://initrode.example.com/careers', Provider: 'Greenhouse' });
    // D-1's URL is "https://initrode.example.com/careers/" (/careers with a
    // trailing slash) — both forms must canonicalize to the same value.
    await request.post('/dismissDraftSite', { data: { draftId: 'D-1' } });

    const res = await request.post('/dismissDraftSite', { data: { draftId: 'D-4' } });
    const body = await res.json();
    expect(body).toEqual({ success: true, blocked: false });

    const blocked = readBlockedSites().Blocked;
    expect(blocked).toHaveLength(3); // 2 seeded + 1 Initrode (D-4 deduped)
    expect(blocked.filter((b) => b.URL.includes('initrode'))).toHaveLength(1);
  });

  test('a genuinely different URL for the same org is not deduped', async ({ request }) => {
    seedDraft({ id: 'D-4', org: 'Initrode', URL: 'https://initrode.example.com/other-board', Provider: 'Greenhouse' });
    await request.post('/dismissDraftSite', { data: { draftId: 'D-1' } });

    const res = await request.post('/dismissDraftSite', { data: { draftId: 'D-4' } });
    const body = await res.json();
    expect(body).toEqual({ success: true, blocked: true });

    const blocked = readBlockedSites().Blocked;
    expect(blocked).toHaveLength(4); // 2 seeded + 2 distinct Initrode boards
    expect(blocked.filter((b) => b.URL.includes('initrode'))).toHaveLength(2);
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

  test('dismissing an unknown draft id is a no-op that leaves the block file untouched', async ({ request }) => {
    const res = await request.post('/dismissDraftSite', { data: { draftId: 'does-not-exist' } });
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/not found/i);

    // blockSite() is never reached (dismiss returns early on an unknown draft),
    // so the seeded entries are untouched and both drafts survive.
    expect(readBlockedSites().Blocked.map((b) => b.id)).toEqual(SEED_IDS);
    expect(readDraftSites().map((d) => d.id)).toEqual(['D-1', 'D-2']);
  });

  test('the block file is created from scratch (B0001) when it is absent', async ({ request }) => {
    // Remove the seeded file to exercise the file-missing bootstrap path.
    fs.rmSync(BLOCKED_SITES_FILE, { force: true });
    expect(readBlockedSites()).toBeNull();

    const res = await request.post('/dismissDraftSite', { data: { draftId: 'D-1' } });
    expect(await res.json()).toEqual({ success: true, blocked: true });

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
  });
});
