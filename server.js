const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Path to job data file
// NOTE: Override DATA_FILE / DESCRIPTION_DIR to point at a different data source
// (e.g. disposable fixtures during tests). Defaults preserve production behavior.
const filePath = process.env.DATA_FILE || path.join(__dirname, '../prospects/test-data/jobResults.json');
// const filePath = path.join(__dirname, 'jobs.json');
const descriptionDir = process.env.DESCRIPTION_DIR || path.join(__dirname, '../prospects/test-data/description');
const draftSitesPath = process.env.DRAFT_SITES_FILE || path.join(__dirname, '../prospects/test-data/draft.sites.json');
const sitesPath = process.env.SITES_FILE || path.join(__dirname, '../prospects/test-data/sites.json');
const filtersPath = process.env.FILTERS_FILE || path.join(__dirname, '../prospects/test-data/filters.json');
const blockedSitesPath = process.env.BLOCKED_SITES_FILE || path.join(__dirname, '../prospects/test-data/blocked.sites.json');

// Middleware
app.use(express.json());
app.use(express.static('public'));

// ============================================
// HELPERS
// ============================================

const CATEGORY_PREFIX = {
  'Private': 'P',
  'Public': 'I',
  'Universities': 'U',
  'Sites': 'S',
  'Recruiters': 'R',
  'Employers': 'E'
};

// Canonicalize a board URL for identity comparison, matching the normaliser in
// prospects/pages/googleDiscoveryWriter.ts so a URL blocked here is recognized
// there: strip a trailing `/careers` and any trailing slash.
const canon = (u) => String(u || '').replace(/\/careers\/?$/, '').replace(/\/$/, '');

function nextBlockedId(existing) {
  let max = 0;
  for (const e of existing) {
    const m = /^B(\d+)$/.exec((e && e.id) || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `B${String(max + 1).padStart(4, '0')}`;
}

// Record a demoted site in blocked.sites.json so googleDiscovery never
// re-drafts it (design §7.1). Deduplicated by canonical URL; tolerates and
// creates a missing file. Reused by both dismiss-a-draft and (in §7.2)
// delete-a-site via the `source` argument.
function blockSite(entry, source) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(blockedSitesPath, 'utf8'));
  } catch {
    data = { Blocked: [] };
  }
  if (!Array.isArray(data.Blocked)) data.Blocked = [];

  const target = canon(entry.URL);
  if (data.Blocked.some((b) => canon(b.URL) === target)) return false; // already blocked

  data.Blocked.push({
    id: nextBlockedId(data.Blocked),
    org: entry.org,
    URL: entry.URL,
    Provider: entry.Provider,
    blockedAt: new Date().toISOString().slice(0, 10),
    source,
  });
  fs.writeFileSync(blockedSitesPath, JSON.stringify(data, null, 2));
  return true;
}

// Atomic single-file JSON write: serialize to a temp sibling then rename over
// the target. rename(2) is atomic on POSIX, so a crash mid-write can never
// leave a half-written file (design §6.5 — guard the blast radius of the
// multi-file delete). All shared JSON is 2-space.
function atomicWriteJson(file, obj) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

// Normalize a name for tolerant identity comparison, mirroring
// `Utilities.getSiteJobIds` (trim + case-insensitive). Used only for *lookup*
// (which results/description belong to a site), never as a primary key — acting
// on a site keys on its `id` (design §6.6, DATA-AUDIT Standardbots case).
const normName = (s) => String(s || '').trim().toLowerCase();

// Resolve a registry site by its `id`, across sites.json (all categories) and
// filters.json Eightfold tenants (root + `sdetOnly`) — the D2.2 scope. Returns
// a descriptor with a normalized `{ org, URL, Provider }` block suitable for
// blockSite (Eightfold has no `URL`; its `baseUrl` is the canonical identity),
// or null when no id matches.
function resolveRegistrySite(siteId, sitesData, filtersData) {
  for (const category of Object.keys(CATEGORY_PREFIX)) {
    const arr = sitesData[category];
    if (!Array.isArray(arr)) continue;
    const index = arr.findIndex((e) => e && e.id === siteId);
    if (index !== -1) {
      const entry = arr[index];
      return {
        scope: 'sites',
        category,
        index,
        org: entry.org,
        lookupName: entry.org,
        block: { org: entry.org, URL: entry.URL, Provider: entry.Provider },
      };
    }
  }
  const scan = (container, scope) => {
    for (const key of Object.keys(container || {})) {
      if (scope === 'filters-root' && key === 'sdetOnly') continue;
      const t = container[key];
      if (t && t.id === siteId) {
        return {
          scope,
          key,
          org: t.org || key,
          lookupName: t.org || key,
          block: { org: t.org || key, URL: t.baseUrl, Provider: 'Eightfold' },
        };
      }
    }
    return null;
  };
  return scan(filtersData, 'filters-root') || scan(filtersData.sdetOnly, 'filters-sdetonly');
}

// Find the jobResults vendor key whose `Site || key` matches `name` under the
// tolerant matcher (trim-exact first, then trim + case-insensitive), or null.
function matchVendorKey(jobResults, name) {
  const target = String(name || '').trim();
  const keys = Object.keys(jobResults).filter((k) => k !== 'Status Definitions');
  const exact = keys.find((k) => String(jobResults[k].Site || k).trim() === target);
  if (exact) return exact;
  const ci = normName(target);
  return keys.find((k) => normName(jobResults[k].Site || k) === ci) || null;
}

// Find the description file whose stem matches any of the candidate names under
// the tolerant matcher, returning its absolute path or null. Handles the
// name-mismatch hazard (§2.6): the registry org, the jobResults key, and the
// filename stem are not guaranteed identical.
function findDescriptionFile(candidates) {
  let files;
  try {
    files = fs.readdirSync(descriptionDir);
  } catch {
    return null;
  }
  const wanted = candidates.filter(Boolean).map((c) => String(c).trim());
  const wantedCi = wanted.map(normName);
  for (const file of files) {
    const m = /^(.*)\.description\.json$/.exec(file);
    if (!m) continue;
    const stem = m[1].trim();
    if (wanted.includes(stem) || wantedCi.includes(normName(stem))) {
      return path.join(descriptionDir, file);
    }
  }
  return null;
}

function generateNextSiteId(category, entries) {
  const prefix = CATEGORY_PREFIX[category];
  if (!prefix) throw new Error(`Unknown category: ${category}`);

  const firstMatch = entries.find(e => e.id && e.id.startsWith(prefix));
  const padWidth = firstMatch ? firstMatch.id.slice(prefix.length).length : 3;

  const nums = entries
    .filter(e => e.id && e.id.startsWith(prefix))
    .map(e => parseInt(e.id.slice(prefix.length), 10))
    .filter(n => !isNaN(n));

  const maxNum = nums.length > 0 ? Math.max(...nums) : 0;
  return prefix + String(maxNum + 1).padStart(padWidth, '0');
}

// Eightfold sites live in filters.json (not sites.json) and use the `E8xx` id
// range. Scan every `E`-prefixed id across the root filtered tenants and the
// `sdetOnly` object, then return the next id preserving the numeric width.
function generateNextEightfoldId(filtersData) {
  const ids = [
    ...Object.keys(filtersData).filter((k) => k !== 'sdetOnly'),
    ...Object.keys(filtersData.sdetOnly || {}),
  ].filter((id) => /^E\d+$/.test(id));

  const padWidth = ids.length > 0 ? ids[0].slice(1).length : 3;
  const nums = ids.map((id) => parseInt(id.slice(1), 10)).filter((n) => !isNaN(n));
  const maxNum = nums.length > 0 ? Math.max(...nums) : 0;
  return 'E' + String(maxNum + 1).padStart(padWidth, '0');
}

// Derive the eightfold subdomain and canonical baseUrl from a draft URL such as
// `https://nvidia.eightfold.ai/careers` → { subdomain: 'nvidia',
// baseUrl: 'https://nvidia.eightfold.ai' }. The `domain` is operator-supplied.
function deriveEightfoldFields(url) {
  const subdomain = new URL(url).hostname.split('.')[0];
  return { subdomain, baseUrl: `https://${subdomain}.eightfold.ai` };
}

// ============================================
// GET ENDPOINTS
// ============================================

/**
 * GET /jobs
 * Fetch all job data from the data file
 */
app.get('/jobs', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load jobs' });
  }
});

/**
 * GET /vendors
 * Fetch all vendor/site names
 */
app.get('/vendors', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const vendors = Object.keys(data).filter(vendor => vendor !== 'Status Definitions');
    res.json(vendors);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load vendors' });
  }
});

/**
 * GET /draftSites
 * Fetch all pending entries from draft.sites.json
 */
app.get('/draftSites', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(draftSitesPath, 'utf8'));
    res.json(data.Draft || []);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load draft sites' });
  }
});

/**
 * GET /sites
 * Grouped registry for the Manage Sites panel: sites.json categories, Eightfold
 * tenants from filters.json (root + sdetOnly, per D2.2), and orphan vendors —
 * jobResults keys with no registry entry (DATA-AUDIT §7.2), which a
 * registry-driven delete can't otherwise reach.
 */
app.get('/sites', (req, res) => {
  try {
    const sitesData = JSON.parse(fs.readFileSync(sitesPath, 'utf8'));
    const filtersData = JSON.parse(fs.readFileSync(filtersPath, 'utf8'));

    const categories = {};
    const registryNames = new Set();
    for (const category of Object.keys(CATEGORY_PREFIX)) {
      const arr = Array.isArray(sitesData[category]) ? sitesData[category] : [];
      categories[category] = arr;
      for (const e of arr) registryNames.add(normName(e.org));
    }

    const eightfold = [];
    const collectEightfold = (container, scope) => {
      for (const key of Object.keys(container || {})) {
        if (scope === 'root' && key === 'sdetOnly') continue;
        const t = container[key];
        if (!t || !t.id) continue;
        eightfold.push({ id: t.id, org: t.org || key, subdomain: t.subdomain, baseUrl: t.baseUrl, scope });
        registryNames.add(normName(t.org || key));
      }
    };
    collectEightfold(filtersData, 'root');
    collectEightfold(filtersData.sdetOnly, 'sdetOnly');

    // Orphans: a jobResults vendor with no registry name match (tolerant).
    const orphans = [];
    try {
      const jobResults = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      for (const key of Object.keys(jobResults)) {
        if (key === 'Status Definitions') continue;
        const name = jobResults[key].Site || key;
        if (!registryNames.has(normName(name))) {
          orphans.push({ key, jobs: Array.isArray(jobResults[key].jobs) ? jobResults[key].jobs.length : 0 });
        }
      }
    } catch { /* no jobResults yet — no orphans to surface */ }

    res.json({ categories, eightfold, orphans });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load sites' });
  }
});

// ============================================
// POST ENDPOINTS
// ============================================

/**
 * POST /addJob
 * Add a new job to a vendor's job list
 * Body: { vendor, newVendor, vendorURL, id, title, date, notes, link }
 */
app.post('/addJob', (req, res) => {
  try {
    const { vendor, newVendor, vendorURL, id, title, date, notes = '', link = '' } = req.body;

    // Validate required fields
    if (!id || !title || !date) {
      return res.json({ success: false, message: 'Missing required fields: id, title, date' });
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let vendorKey = vendor;

    // ============ CREATE NEW VENDOR IF NEEDED ============
    if (vendor === 'NEW_VENDOR') {
      if (!newVendor || !vendorURL) {
        return res.json({ success: false, message: 'Missing vendor info' });
      }

      // Ensure vendor URL has trailing slash
      let finalURL = vendorURL;
      if (!finalURL.endsWith('/')) {
        finalURL = finalURL + '/';
      }

      vendorKey = newVendor;

      if (!data[vendorKey]) {
        data[vendorKey] = {
          Site: newVendor,
          URL: finalURL,
          jobs: []
        };
      }
    }

    // ============ VALIDATE VENDOR EXISTS ============
    if (!data[vendorKey]) {
      return res.json({ success: false, message: 'Vendor not found' });
    }

    // ============ PREVENT DUPLICATE JOB ============
    const jobExists = data[vendorKey].jobs.some(job => job.id === id);
    if (jobExists) {
      return res.json({ success: false, message: 'Job already exists' });
    }

    // ============ ADD JOB ============
    data[vendorKey].jobs.push({
      id,
      title,
      status: '0',
      date,
      notes,
      link
    });

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /updateStatus
 * Update a job's status
 * Body: { site, jobId, status }
 */
app.post('/updateStatus', (req, res) => {
  try {
    const { site, jobId, status } = req.body;

    if (!site || !jobId || !status) {
      return res.json({ success: false, message: 'Missing required fields' });
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    if (!data[site]) {
      return res.json({ success: false, message: 'Site not found' });
    }

    const job = data[site].jobs.find(j => j.id === jobId);

    if (job) {
      job.status = status;
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

      // Declined: remove the matching job's description from prospects-data
      if (status === '4') {
        const descriptionPath = path.join(descriptionDir, `${site}.description.json`);
        if (fs.existsSync(descriptionPath)) {
          const descriptionData = JSON.parse(fs.readFileSync(descriptionPath, 'utf8'));
          if (descriptionData[site] && Array.isArray(descriptionData[site].jobs)) {
            descriptionData[site].jobs = descriptionData[site].jobs.filter(
              j => j['URL entity'] !== jobId
            );
            fs.writeFileSync(descriptionPath, JSON.stringify(descriptionData, null, 2));
          }
        }
      }

      res.json({ success: true });
    } else {
      res.json({ success: false, message: 'Job not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /updateNotes
 * Update a job's notes
 * Body: { site, jobId, notes }
 */
app.post('/updateNotes', (req, res) => {
  try {
    const { site, jobId, notes } = req.body;

    if (!site || !jobId) {
      return res.json({ success: false, message: 'Missing required fields' });
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    if (!data[site]) {
      return res.json({ success: false, message: 'Site not found' });
    }

    const job = data[site].jobs.find(j => j.id === jobId);

    if (job) {
      job.notes = notes;
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      res.json({ success: true });
    } else {
      res.json({ success: false, message: 'Job not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /promoteDraftSite
 * Promote a draft entry out of draft.sites.json:
 *   - Eightfold drafts land in filters.json under the `sdetOnly` object (no
 *     category; the operator supplies `domain`). Body: { draftId, domain }
 *   - Every other provider lands in sites.json under a category.
 *     Body: { draftId, category }
 */
app.post('/promoteDraftSite', (req, res) => {
  try {
    const { draftId, category, domain } = req.body;

    if (!draftId) {
      return res.json({ success: false, message: 'Missing required field: draftId' });
    }

    const draftData = JSON.parse(fs.readFileSync(draftSitesPath, 'utf8'));
    const draftIndex = draftData.Draft.findIndex(e => e.id === draftId);
    if (draftIndex === -1) {
      return res.json({ success: false, message: 'Draft entry not found' });
    }
    const entry = draftData.Draft[draftIndex];

    // ============ EIGHTFOLD → filters.json sdetOnly ============
    if (String(entry.Provider).toLowerCase() === 'eightfold') {
      if (!domain || !String(domain).trim()) {
        return res.json({ success: false, message: 'Missing required field: domain' });
      }

      const filtersData = JSON.parse(fs.readFileSync(filtersPath, 'utf8'));
      if (!filtersData.sdetOnly) filtersData.sdetOnly = {};

      const newId = generateNextEightfoldId(filtersData);
      const { subdomain, baseUrl } = deriveEightfoldFields(entry.URL);

      draftData.Draft.splice(draftIndex, 1);
      filtersData.sdetOnly[newId] = {
        id: newId,
        org: entry.org,
        subdomain,
        domain: String(domain).trim(),
        baseUrl,
      };

      fs.writeFileSync(draftSitesPath, JSON.stringify(draftData, null, 2));
      fs.writeFileSync(filtersPath, JSON.stringify(filtersData, null, 2));

      return res.json({ success: true, newId });
    }

    // ============ EVERYTHING ELSE → sites.json category ============
    if (!category) {
      return res.json({ success: false, message: 'Missing required field: category' });
    }
    if (!CATEGORY_PREFIX[category]) {
      return res.json({ success: false, message: 'Invalid category' });
    }

    const sitesData = JSON.parse(fs.readFileSync(sitesPath, 'utf8'));
    const targetArray = sitesData[category] || [];
    const newId = generateNextSiteId(category, targetArray);

    draftData.Draft.splice(draftIndex, 1);
    if (!sitesData[category]) sitesData[category] = [];
    sitesData[category].push({ id: newId, org: entry.org, URL: entry.URL, Provider: entry.Provider });

    fs.writeFileSync(draftSitesPath, JSON.stringify(draftData, null, 2));
    fs.writeFileSync(sitesPath, JSON.stringify(sitesData, null, 2));

    res.json({ success: true, newId });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /dismissDraftSite
 * Remove a draft entry without promoting it to sites.json.
 * Body: { draftId }
 */
app.post('/dismissDraftSite', (req, res) => {
  try {
    const { draftId } = req.body;

    if (!draftId) {
      return res.json({ success: false, message: 'Missing required field: draftId' });
    }

    const draftData = JSON.parse(fs.readFileSync(draftSitesPath, 'utf8'));
    const draftIndex = draftData.Draft.findIndex(e => e.id === draftId);

    if (draftIndex === -1) {
      return res.json({ success: false, message: 'Draft entry not found' });
    }

    // Dismiss == demote == block: record the site before removing the draft so
    // googleDiscovery never re-drafts it (§7.1). Deduplicated by canonical URL.
    const draft = draftData.Draft[draftIndex];
    const blocked = blockSite({ org: draft.org, URL: draft.URL, Provider: draft.Provider }, 'dismiss');

    draftData.Draft.splice(draftIndex, 1);
    fs.writeFileSync(draftSitesPath, JSON.stringify(draftData, null, 2));

    res.json({ success: true, blocked });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /deleteSite
 * Remove a registered site (by `siteId`) or an orphan vendor (by `orphanKey`)
 * and everything derived from it (design §7.2):
 *   - the registry entry (sites.json category, or filters.json root/sdetOnly);
 *   - its jobResults.json vendor block (tolerant match, §2.6/§6.3);
 *   - its description/<stem>.description.json file (tolerant stem match);
 *   - then blockSite(entry, 'delete') so googleDiscovery never re-drafts it
 *     (D2.3) — skipped for orphans, which have no canonical URL to block.
 * Resolution and mutation key on `id` (§6.6); org/Site is a tolerant lookup
 * only. Writes are atomic + transactional: any failure rolls every touched
 * file back to its prior state (§6.5). Responds with a per-artifact summary so
 * partial cleanups are visible rather than silent.
 * Body: { siteId } | { orphanKey }
 */
app.post('/deleteSite', (req, res) => {
  const { siteId, orphanKey } = req.body || {};
  if (!siteId && !orphanKey) {
    return res.json({ success: false, message: 'Missing required field: siteId or orphanKey' });
  }

  // Snapshot-and-restore transaction over every file we might touch.
  const snapshots = new Map();
  const snap = (file) => {
    if (!snapshots.has(file)) {
      snapshots.set(file, fs.existsSync(file) ? fs.readFileSync(file) : null);
    }
  };
  const restore = () => {
    for (const [file, buf] of snapshots) {
      if (buf === null) {
        if (fs.existsSync(file)) fs.rmSync(file, { force: true });
      } else {
        fs.writeFileSync(file, buf);
      }
    }
  };

  try {
    let jobResults;
    try {
      jobResults = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      jobResults = {};
    }

    // ============ ORPHAN VENDOR (no registry entry) ============
    if (orphanKey && !siteId) {
      const key = jobResults[orphanKey] ? orphanKey : matchVendorKey(jobResults, orphanKey);
      if (!key) {
        return res.json({ success: false, message: 'Orphan vendor not found' });
      }
      const descFile = findDescriptionFile([key]);

      try {
        snap(filePath);
        delete jobResults[key];
        atomicWriteJson(filePath, jobResults);

        if (descFile) {
          snap(descFile);
          fs.rmSync(descFile);
        }
      } catch (err) {
        restore();
        throw err;
      }

      return res.json({
        success: true,
        org: key,
        summary: {
          registry: 'n/a',
          jobResults: 'yes',
          description: descFile ? 'yes' : 'absent',
          blocked: 'n/a',
        },
      });
    }

    // ============ REGISTERED SITE (by id) ============
    const sitesData = JSON.parse(fs.readFileSync(sitesPath, 'utf8'));
    const filtersData = JSON.parse(fs.readFileSync(filtersPath, 'utf8'));

    const site = resolveRegistrySite(siteId, sitesData, filtersData);
    if (!site) {
      return res.json({ success: false, message: 'Site not found' });
    }

    const vendorKey = matchVendorKey(jobResults, site.lookupName);
    const descFile = findDescriptionFile([vendorKey, site.org, site.lookupName]);

    let blocked;
    try {
      // 1. Registry entry.
      const registryFile = site.scope === 'sites' ? sitesPath : filtersPath;
      snap(registryFile);
      if (site.scope === 'sites') {
        sitesData[site.category].splice(site.index, 1);
        atomicWriteJson(sitesPath, sitesData);
      } else if (site.scope === 'filters-root') {
        delete filtersData[site.key];
        atomicWriteJson(filtersPath, filtersData);
      } else {
        delete filtersData.sdetOnly[site.key];
        atomicWriteJson(filtersPath, filtersData);
      }

      // 2. jobResults vendor block (tolerant match).
      if (vendorKey) {
        snap(filePath);
        delete jobResults[vendorKey];
        atomicWriteJson(filePath, jobResults);
      }

      // 3. Description file (tolerant stem match).
      if (descFile) {
        snap(descFile);
        fs.rmSync(descFile);
      }

      // 4. Block so discovery never re-drafts it (D2.3).
      snap(blockedSitesPath);
      blocked = blockSite(site.block, 'delete');
    } catch (err) {
      restore();
      throw err;
    }

    res.json({
      success: true,
      org: site.org,
      summary: {
        registry: 'yes',
        jobResults: vendorKey ? 'yes' : 'absent',
        description: descFile ? 'yes' : 'absent',
        blocked,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║    Vibe Tracker Server Started         ║
║    http://localhost:${PORT}         ║
╚════════════════════════════════════════╝
  `);
});
