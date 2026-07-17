'use strict';

// Shared test-data helper.
//
// Tests never touch real or committed data. A disposable copy of the fixtures
// is created under the OS temp dir; the server is pointed at it via the
// DATA_FILE / DESCRIPTION_DIR env vars (see playwright.config.js). Because
// server.js reads the data file on every request, calling resetData() between
// tests fully isolates them without restarting the server.

const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = path.join(os.tmpdir(), 'vibe-tracker-test-data');
const DATA_FILE = path.join(DATA_DIR, 'jobResults.json');
const DESCRIPTION_DIR = path.join(DATA_DIR, 'description');

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');
const FIXTURE_DATA_FILE = path.join(FIXTURES_DIR, 'jobResults.json');
const FIXTURE_DESCRIPTION_DIR = path.join(FIXTURES_DIR, 'description');

/** Copy the fixtures fresh into the disposable temp data dir. */
function resetData() {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DESCRIPTION_DIR, { recursive: true });
  fs.copyFileSync(FIXTURE_DATA_FILE, DATA_FILE);
  for (const name of fs.readdirSync(FIXTURE_DESCRIPTION_DIR)) {
    fs.copyFileSync(
      path.join(FIXTURE_DESCRIPTION_DIR, name),
      path.join(DESCRIPTION_DIR, name)
    );
  }
}

/** Read the current job-results data the server is operating on. */
function readData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

/** Read a site's description file, or null if it doesn't exist. */
function readDescription(site) {
  const p = path.join(DESCRIPTION_DIR, `${site}.description.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

module.exports = {
  DATA_DIR,
  DATA_FILE,
  DESCRIPTION_DIR,
  resetData,
  readData,
  readDescription,
};
