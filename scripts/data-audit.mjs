#!/usr/bin/env node
/**
 * data-audit.mjs — integrity audit of the prospects-data JSON contract.
 *
 * Surfaces the two hazard classes the block/delete/purge features (DESIGN.md
 * §7.1–7.3) must survive:
 *   - §2.6 case-insensitive / trim-only org matches (tolerant-lookup rescues)
 *   - §7.2 orphans: jobResults vendors, description files, and within-file
 *     entries that a registry-driven delete can never reach.
 *
 * Matching mirrors Utilities.getSiteJobIds exactly: trim-exact, then
 * trim + case-insensitive, on (entry.Site || key).
 *
 * Usage:
 *   node scripts/data-audit.mjs                 # auto-detect data dir
 *   DATA_DIR=../prospects-data node scripts/data-audit.mjs
 *   AUDIT_JSON=audit.json node scripts/data-audit.mjs   # also emit JSON
 */
import { readFile, readdir, writeFile, stat } from 'fs/promises';
import path from 'path';

// ── locate the data dir (env override, else first sibling checkout that exists) ──
async function resolveDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  const here = path.dirname(new URL(import.meta.url).pathname);
  const candidates = [
    path.resolve(here, '../../prospects/test-data'), // server.js sibling-checkout convention
    path.resolve(here, '../../prospects-data'),      // direct data-repo checkout
  ];
  for (const c of candidates) {
    try { if ((await stat(path.join(c, 'jobResults.json'))).isFile()) return c; } catch { /* next */ }
  }
  throw new Error('Could not find jobResults.json. Set DATA_DIR explicitly.');
}

const DATA = await resolveDataDir();
const j = async (f) => JSON.parse(await readFile(path.join(DATA, f), 'utf-8'));
const norm = (s) => String(s || '').trim();
const lc = (s) => norm(s).toLowerCase();

const sites = await j('sites.json');
const filters = await j('filters.json');
const jobResults = await j('jobResults.json');
const descFiles = (await readdir(path.join(DATA, 'description')))
  .filter((f) => f.endsWith('.description.json'));

// ── registry = sites.json categories + eightfold tenants (filters.json) ──
const registry = [];
for (const [cat, arr] of Object.entries(sites))
  if (Array.isArray(arr)) for (const e of arr)
    registry.push({ id: e.id, org: e.org, Provider: e.Provider, source: `sites.${cat}` });
for (const [k, v] of Object.entries(filters)) {
  if (k === 'sdetOnly')
    for (const sv of Object.values(v)) registry.push({ id: sv.id, org: sv.org, Provider: 'eightfold', source: 'filters.sdetOnly' });
  else registry.push({ id: v.id, org: v.org, Provider: 'eightfold', source: 'filters.root' });
}

const reverseOrgsTrim = new Map();
for (const r of registry) if (!reverseOrgsTrim.has(norm(r.org))) reverseOrgsTrim.set(norm(r.org), r.id);

const jrKeys = Object.keys(jobResults).filter((k) => k !== 'Status Definitions');
const jrSiteName = (key) => norm((jobResults[key] && jobResults[key].Site) || key);

function matchJrToRegistry(key) {
  const siteName = jrSiteName(key);
  if (!siteName) return { kind: 'empty' };
  if (reverseOrgsTrim.has(siteName)) return { kind: 'exact', id: reverseOrgsTrim.get(siteName) };
  for (const r of registry) if (lc(r.org) === lc(siteName)) return { kind: 'ci', reg: r };
  return { kind: 'none' };
}

const exactMatches = [], ciMatches = [], orphanJr = [];
for (const key of jrKeys) {
  const m = matchJrToRegistry(key);
  const jobCount = Array.isArray(jobResults[key]?.jobs) ? jobResults[key].jobs.length : 0;
  if (m.kind === 'exact') exactMatches.push({ key, jobCount });
  else if (m.kind === 'ci') ciMatches.push({ key, siteName: jrSiteName(key), id: m.reg.id, regOrg: m.reg.org, source: m.reg.source, jobCount });
  else if (m.kind === 'none') orphanJr.push({ key, siteName: jrSiteName(key), jobCount });
}

const jrByTrim = new Set(jrKeys.map((k) => jrSiteName(k)));
const jrByLc = new Map(jrKeys.map((k) => [lc(jrSiteName(k)), k]));
const regNoResults = registry.filter((r) => !jrByTrim.has(norm(r.org)) && !jrByLc.has(lc(r.org)));

const descStem = (f) => f.replace(/\.description\.json$/, '');
const orphanDescNoReg = [], orphanDescNoJr = [];
for (const f of descFiles) {
  const stem = descStem(f);
  const inReg = registry.some((r) => lc(r.org) === lc(stem));
  const inJr = jrByLc.has(lc(stem));
  if (!inReg) orphanDescNoReg.push({ f, inJr });
  if (!inJr) orphanDescNoJr.push({ f, inReg });
}

// within-file orphan entries (URL entity with no matching jobResults id)
let descEntriesTotal = 0, descEntriesOrphan = 0;
const filesWithOrphanEntries = [];
for (const f of descFiles) {
  const stem = descStem(f);
  const jrKey = jrByTrim.has(norm(stem)) ? jrKeys.find((k) => jrSiteName(k) === norm(stem)) : jrByLc.get(lc(stem));
  if (!jrKey) continue;
  const ids = new Set((jobResults[jrKey]?.jobs || []).map((x) => String(x.id)));
  let content;
  try { content = JSON.parse(await readFile(path.join(DATA, 'description', f), 'utf-8')); } catch { continue; }
  let orphanHere = 0, totalHere = 0;
  for (const block of Object.values(content))
    for (const e of block?.jobs || []) { totalHere++; if (!ids.has(String(e['URL entity']))) orphanHere++; }
  descEntriesTotal += totalHere; descEntriesOrphan += orphanHere;
  if (orphanHere) filesWithOrphanEntries.push({ f, orphanHere, totalHere });
}

const descStemsLc = new Set(descFiles.map((f) => lc(descStem(f))));
const jrNoDesc = jrKeys.filter((k) => !descStemsLc.has(lc(jrSiteName(k))));

const orgGroups = new Map();
for (const r of registry) { const key = lc(r.org); (orgGroups.get(key) || orgGroups.set(key, []).get(key)).push(r); }
const dupOrgs = [...orgGroups.values()].filter((v) => v.length > 1);

// ── report ──
const rule = (n = 70) => '─'.repeat(n);
const p = (...a) => console.log(...a);
p('\n' + rule(), '\nDATA AUDIT —', DATA, '\n' + rule());
p(`registry entries: ${registry.length}   jobResults keys: ${jrKeys.length}   description files: ${descFiles.length}`);

p('\n' + rule() + `\n§2.6  CASE-INSENSITIVE / TRIM-ONLY MATCHES  (${ciMatches.length})\n` + rule());
ciMatches.forEach((m) => p(`  jr:"${m.siteName}"  ⇄  reg:"${m.regOrg}" [${m.id} ${m.source}]  (${m.jobCount} jobs)`));
if (!ciMatches.length) p('  (none)');

p('\n' + rule() + `\n§7.2  ORPHANED jobResults VENDORS  (${orphanJr.length})  — unreachable by registry-driven delete\n` + rule());
orphanJr.sort((a, b) => b.jobCount - a.jobCount).forEach((o) => p(`  "${o.siteName}"${o.key !== o.siteName ? ` (key="${o.key}")` : ''}  (${o.jobCount} jobs)`));
if (!orphanJr.length) p('  (none)');

p('\n' + rule() + `\n§7.2  DESCRIPTION FILES not in registry  (${orphanDescNoReg.length})\n` + rule());
orphanDescNoReg.forEach((o) => p(`  ${o.f}  ${o.inJr ? '(has jobResults)' : '(no jobResults either)'}`));
if (!orphanDescNoReg.length) p('  (none)');

p('\n' + rule() + `\n§7.2  DESCRIPTION FILES with no jobResults  (${orphanDescNoJr.length})\n` + rule());
orphanDescNoJr.forEach((o) => p(`  ${o.f}  ${o.inReg ? '(in registry)' : '(not in registry)'}`));
if (!orphanDescNoJr.length) p('  (none)');

p('\n' + rule() + `\nWITHIN-FILE ORPHAN ENTRIES  ${descEntriesOrphan}/${descEntriesTotal} in ${filesWithOrphanEntries.length} files\n` + rule());
filesWithOrphanEntries.sort((a, b) => b.orphanHere - a.orphanHere).forEach((o) => p(`  ${o.f}: ${o.orphanHere}/${o.totalHere}`));
if (!filesWithOrphanEntries.length) p('  (none)');

p('\n' + rule() + `\nDUPLICATE ORG NAMES in registry  (${dupOrgs.length})  — reverse-lookup collision\n` + rule());
dupOrgs.forEach((arr) => p(`  "${arr[0].org}" ×${arr.length}: ${arr.map((r) => `${r.id}/${r.source}`).join(', ')}`));
if (!dupOrgs.length) p('  (none)');

p('\n' + rule() + '\nSUMMARY\n' + rule());
p(`  exact matches:                 ${exactMatches.length}`);
p(`  case-insensitive-only (§2.6):  ${ciMatches.length}`);
p(`  orphaned jobResults (§7.2):    ${orphanJr.length}`);
p(`  registry with no results:      ${regNoResults.length}`);
p(`  desc files not in registry:    ${orphanDescNoReg.length}`);
p(`  desc files with no jobResults: ${orphanDescNoJr.length}`);
p(`  jobResults with no desc file:  ${jrNoDesc.length}`);
p(`  within-file orphan entries:    ${descEntriesOrphan}/${descEntriesTotal}`);
p(`  duplicate registry org names:  ${dupOrgs.length}\n`);

if (process.env.AUDIT_JSON) {
  const out = {
    generatedAt: new Date().toISOString(), dataDir: DATA,
    counts: {
      registry: registry.length, jrKeys: jrKeys.length, descFiles: descFiles.length,
      exact: exactMatches.length, ci: ciMatches.length, orphanJr: orphanJr.length,
      regNoResults: regNoResults.length, orphanDescNoReg: orphanDescNoReg.length,
      orphanDescNoJr: orphanDescNoJr.length, jrNoDesc: jrNoDesc.length,
      descEntriesOrphan, descEntriesTotal, dupOrgs: dupOrgs.length,
    },
    ciMatches, orphanJr, orphanDescNoReg, orphanDescNoJr, jrNoDesc,
    regNoResults: regNoResults.map((r) => ({ id: r.id, org: r.org, source: r.source })),
    filesWithOrphanEntries,
    dupOrgs: dupOrgs.map((arr) => arr.map((r) => ({ id: r.id, org: r.org, source: r.source }))),
  };
  await writeFile(process.env.AUDIT_JSON, JSON.stringify(out, null, 2));
  p(`wrote ${process.env.AUDIT_JSON}`);
}
