# Testing guide

The standard for tests in this repo — for humans and for the automated
`claude-review` / auto-heal jobs (`.github/workflows/claude-review.yml`), which
are told to read this file before writing or reviewing tests.

Tests are Playwright specs under `test/`, tagged `@smoke` or `@regression`, run
via `npm run test:smoke` / `npm run test:regression`. Never touch real or
committed data — every test goes through the disposable-fixture harness
(`test/helpers/data.js`, see [Fixture harness](#fixture-harness)).

## Test-design rubric

When adding or updating a test for a behavior change, satisfy all of these:

1. **Cover every branch you changed.** Enumerate each conditional, guard clause,
   and early return in the changed code and add a case per branch — not just the
   happy path. Examples of branches that are easy to miss:
   - both sides of a case-insensitive comparison (e.g. `Provider === 'eightfold'`
     — test both `'eightfold'` and `'Eightfold'`);
   - each half of a compound guard (e.g. `if (!domain || !domain.trim())` — test
     the field being **absent** *and* being **whitespace-only**);
   - both arms of a rendering conditional (the element that appears **and** the
     one it replaces).
2. **Mirror fixtures on the real data shape.** Base any fixture on the canonical
   shapes in [Data shapes](#data-shapes) — do **not** invent a placeholder shape
   that happens to skip the code path under test. (A degenerate `filters.json`
   whose root tenant isn't keyed by a real `E8xx` id, for instance, will not
   exercise the id generator's root scan at all, so the test proves nothing.)
   When a value is derived from state, seed state that actually forces the
   derivation (e.g. to prove the next-id generator scans root tenants, the root
   tenant must hold the max id).
3. **Assert exactly, and assert invariants that must *not* hold.** Prefer
   `toEqual` (exact object) over `toMatchObject` (subset) for created records, so
   a stray field is caught. Explicitly assert forbidden state where it matters —
   e.g. a `sdetOnly` entry must carry **no** `filters` key
   (`expect(entry).not.toHaveProperty('filters')`).
4. **Assert what must stay untouched.** A write to one place should leave the
   rest alone — assert the sibling data (other categories, the root tenant, the
   file that shouldn't have been written) is unchanged.
5. **Wire new data files through the harness, not by guessing paths.** If the
   code reads a new data file via an env override, add it to `test/helpers/data.js`
   *and* `playwright.config.js` (mirror the existing `SITES_FILE` / `FILTERS_FILE`
   pattern). A test that lets the server fall back to a real repo path is silently
   broken.
6. **Self-review before finishing.** Re-read your diff against this list, then
   end your summary with a short **coverage report**: the branches/cases you
   covered and any you deliberately left out (with why).

## Fixture harness

`test/helpers/data.js` copies `test/fixtures/*` into a disposable temp dir and
points the server at it via env vars in `playwright.config.js`
(`DATA_FILE`, `DESCRIPTION_DIR`, `DRAFT_SITES_FILE`, `SITES_FILE`, `FILTERS_FILE`).
`server.js` re-reads its data on every request, so `resetData()` in a
`beforeEach` fully isolates tests without a restart. Readers: `readData`,
`readDraftSites`, `readSites`, `readFilters`. To seed a scenario beyond the
static fixtures, write directly to the exported `*_FILE` paths after `resetData()`
(see `test/eightfold-promotion-edges.spec.js`).

## Data shapes

The server reads four data files owned by the **`keithsecond/prospects-data`**
repo. The source of truth for their contracts is
`prospects-data/schema/*.schema.json`; representative shapes are below. The
auto-heal job only checks out `vibe-tracker`, so use these rather than inventing
shapes. (If you need live data, a read-only checkout of `keithsecond/prospects-data`
can be added to the workflow — but these committed shapes are the intended
reference so no cross-repo token is required.)

### `filters.json` — eightfold tenants (id-keyed object)

Every key except `sdetOnly` is a **filtered** tenant (carries a `filters` block,
searched by `eightfold.spec.ts`). `sdetOnly` is an object of **filter-less**
tenants (keyword-searched by `sdetSearch.spec.ts`) — same fields **minus**
`filters`. Ids use the `E8xx` range; the next id is `max(E-id across root keys +
sdetOnly keys) + 1`. The shipped file has `sdetOnly: {}`.

```jsonc
{
  "E810": {
    "id": "E810", "org": "Twilio", "subdomain": "twilio",
    "domain": "twilio.com", "baseUrl": "https://twilio.eightfold.ai",
    "filters": { "filter_job_location": "remote - us", "filter_seniority": ["1", "2"] }
  },
  "sdetOnly": {
    // promoted, filter-less; may be empty {}
    "E814": {
      "id": "E814", "org": "Nvidia", "subdomain": "nvidia",
      "domain": "nvidia.com", "baseUrl": "https://nvidia.eightfold.ai"
    }
  }
}
```

### `draft.sites.json` — pending discoveries

```jsonc
{ "Draft": [ { "id": "D0013", "org": "Hawkeyeinnovations",
              "URL": "https://jobs.ashbyhq.com/hawkeyeinnovations", "Provider": "ashby" } ] }
```
`Provider: "eightfold"` drafts promote into `filters.json` `sdetOnly` (operator
supplies `domain`); all other providers promote into a `sites.json` category.

### `sites.json` — curated sites (category-keyed arrays)

Categories: `Private`, `Public`, `Universities`, `Sites`, `Recruiters`,
`Employers` (id prefixes `P/I/U/S/R/E`).

```jsonc
{ "Private": [ { "id": "P005", "org": "St. Stephens", "URL": "https://…", "Provider": "ADP" } ] }
```

### `jobResults.json`

Object with a required `Status Definitions` map (codes `0`–`4`) plus one key per
vendor; each vendor has `Site`, `URL`, and a `jobs` array. See
`prospects-data/schema/jobResults.schema.json`.
