'use strict';

// @regression — §7.1 block file: dismissing a draft site records it in
// blocked.sites.json (source "dismiss") so googleDiscovery never re-drafts it.
// Deduplicated by canonical URL; the file is created if absent.
//
// The fixture seeds two prior blocks (B0001 Globex via dismiss, B0002 Soylent
// via delete), so these tests also cover appending past existing entries and
// deduping against them.

const fs = require('fs');
const { test, expect } = require('@playwright/test');
const {
  resetData,
  readDraftSites,
  readBlockedSites,
  BLOCKED_SITES_FILE,
  DRAFT_SITES_FILE,
} = require('./helpers/data');

test.describe('@regression', () => {
  test.beforeEach(() => {
    resetData();
  });

  test('dismissing a draft appends it to blocked.sites.json with source "dismiss"', async ({ request }) => {
    const res = await request.post('/dismissDraftSite', { data: { draftId: 'D-2' } });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.blocked).toBe(true);

    // draft removed
    expect(readDraftSites().map((d) => d.id)).toEqual(['D-1']);

    // appended after the two seeded entries, with the next B-id
    const blocked = readBlockedSites();
    expect(blocked).toHaveLength(3);
    const added = blocked.find((b) => b.org === 'Umbrella');
    expect(added).toMatchObject({
      id: 'B0003',
      org: 'Umbrella',
      URL: 'https://umbrella.example.com/jobs/',
      Provider: 'Lever',
      source: 'dismiss',
    });
    expect(added.blockedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('re-dismissing the same canonical URL does not duplicate the block entry', async ({ request }) => {
    // Two drafts whose URLs canonicalize to the same thing (trailing /careers[/]).
    fs.writeFileSync(DRAFT_SITES_FILE, JSON.stringify({
      Draft: [
        { id: 'D-1', org: 'Dup', URL: 'https://dup.example.com/careers/', Provider: 'ashby' },
        { id: 'D-2', org: 'Dup', URL: 'https://dup.example.com/careers', Provider: 'ashby' },
      ],
    }));

    const first = await (await request.post('/dismissDraftSite', { data: { draftId: 'D-1' } })).json();
    expect(first.blocked).toBe(true);
    const second = await (await request.post('/dismissDraftSite', { data: { draftId: 'D-2' } })).json();
    expect(second.success).toBe(true);
    expect(second.blocked).toBe(false); // already blocked by canonical URL

    const blocked = readBlockedSites();
    expect(blocked.filter((b) => b.org === 'Dup')).toHaveLength(1);
    expect(blocked).toHaveLength(3); // 2 seeded + 1 Dup
  });

  test('dismissing a site whose canonical URL is already blocked is a no-op', async ({ request }) => {
    // A draft that canonicalizes onto the seeded Globex block.
    fs.writeFileSync(DRAFT_SITES_FILE, JSON.stringify({
      Draft: [
        { id: 'D-1', org: 'Globex', URL: 'https://globex.example.com/careers/', Provider: 'greenhouse' },
      ],
    }));

    const body = await (await request.post('/dismissDraftSite', { data: { draftId: 'D-1' } })).json();
    expect(body.success).toBe(true);
    expect(body.blocked).toBe(false);
    expect(readBlockedSites()).toHaveLength(2); // unchanged
  });

  test('dismissing creates blocked.sites.json when it is absent', async ({ request }) => {
    fs.rmSync(BLOCKED_SITES_FILE, { force: true });

    const res = await request.post('/dismissDraftSite', { data: { draftId: 'D-1' } });
    expect((await res.json()).success).toBe(true);

    const blocked = readBlockedSites();
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({ id: 'B0001', org: 'Initrode', source: 'dismiss' });
  });

  test('dismissing an unknown draft id neither blocks nor errors the block file', async ({ request }) => {
    const res = await request.post('/dismissDraftSite', { data: { draftId: 'nope' } });
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(readBlockedSites()).toHaveLength(2); // seeded entries untouched
  });
});
