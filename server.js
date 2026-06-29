const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// Path to job data file
// NOTE: Change this path based on your data source
const filePath = path.join(__dirname, '../prospects/test-data/jobResults.json');
// const filePath = path.join(__dirname, 'jobs.json');
const descriptionDir = path.join(__dirname, '../prospects/test-data/description');

// Middleware
app.use(express.json());
app.use(express.static('public'));

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
