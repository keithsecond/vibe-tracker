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
 * Move a draft entry into a target category in sites.json.
 * Body: { draftId, category }
 */
app.post('/promoteDraftSite', (req, res) => {
  try {
    const { draftId, category } = req.body;

    if (!draftId || !category) {
      return res.json({ success: false, message: 'Missing required fields: draftId, category' });
    }
    if (!CATEGORY_PREFIX[category]) {
      return res.json({ success: false, message: 'Invalid category' });
    }

    const draftData = JSON.parse(fs.readFileSync(draftSitesPath, 'utf8'));
    const sitesData = JSON.parse(fs.readFileSync(sitesPath, 'utf8'));

    const draftIndex = draftData.Draft.findIndex(e => e.id === draftId);
    if (draftIndex === -1) {
      return res.json({ success: false, message: 'Draft entry not found' });
    }

    const entry = draftData.Draft[draftIndex];
    const targetArray = sitesData[category] || [];
    const newId = generateNextSiteId(category, targetArray);

    draftData.Draft.splice(draftIndex, 1);
    if (!sitesData[category]) sitesData[category] = [];
    sitesData[category].push({ id: newId, org: entry.org, URL: entry.URL, Provider: entry.Provider });

    fs.writeFileSync(draftSitesPath, JSON.stringify(draftData, null, 2));
    fs.writeFileSync(sitesPath, JSON.stringify(sitesData, null, 4));

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

    draftData.Draft.splice(draftIndex, 1);
    fs.writeFileSync(draftSitesPath, JSON.stringify(draftData, null, 2));

    res.json({ success: true });
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
