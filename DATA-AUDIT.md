# prospects-data — Data Integrity Audit

Companion to `DESIGN.md`. Enumerates the concrete data hazards the block /
delete / purge features (§7.1–7.3) must survive, so their tests can be built
from real cases rather than invented ones.

**Regenerate:**

```bash
# from the vibe-tracker checkout (auto-detects ../prospects/test-data or ../prospects-data)
node scripts/data-audit.mjs
DATA_DIR=../prospects-data node scripts/data-audit.mjs      # explicit
AUDIT_JSON=audit.json node scripts/data-audit.mjs           # also emit machine-readable JSON
```

**Methodology.** Registry = every entry in `sites.json` (all categories) plus
every Eightfold tenant in `filters.json` (root + `sdetOnly`). A `jobResults`
vendor is matched to the registry exactly as `Utilities.getSiteJobIds` does:
**trim-exact first, then trim + case-insensitive**, on `entry.Site || key`.
Description files match by filename stem.

Snapshot date: **2026-08-03** (after the `r001` remediation below).

---

## Summary

| Population | Count |
|---|---|
| Registry entries (`sites.json` + Eightfold `filters.json`) | 199 |
| `jobResults` vendor keys | 135 |
| Description files | 131 |
| Exact matches | 123 |
| **Case-insensitive-only matches (§2.6)** | **1** |
| **Orphaned `jobResults` vendors (§7.2)** | **11** |
| Registry entries with no results yet | 76 |
| Description files not in registry | 7 |
| Description files with no `jobResults` | 7 |
| `jobResults` with no description file | 9 |
| Within-file orphan entries (`URL entity` ∦ any job id) | 5 / 243 |
| Duplicate org names in registry | 1 |

**Headline:** the tolerant matcher folds **case only**, not punctuation or
whitespace — so its practical rescue surface is a **single** row (§2.6). The
real hazard is the **11 orphan vendors** (§7.2): they exist in `jobResults`
(and often `description/`) but not in the registry, so a registry-driven
`/deleteSite` can never reach them.

---

## §2.6 — case-insensitive / trim-only matches (1)

| `jobResults` key/Site | Registry org | id / source | jobs |
|---|---|---|---|
| `symetra` | `Symetra` | `E812` / `filters.json` root | 1 |

The doc's illustrative example (`Ten Mile Square Tecnologies` vs
`TenMileSquareTechnologies`) would **not** match under this matcher — the
spaces differ and the matcher is not punctuation-insensitive — and neither
string is in the current data. Case-folding is a real but tiny surface.

---

## §7.2 — orphaned `jobResults` vendors (11)

No registry entry matches these (exact or case-insensitive), so they are
**unreachable by a delete keyed on `sites.json`/`filters.json`**. ~52 jobs are
stranded across the 11.

| `jobResults` key | jobs | Provider (from URL) | Why orphaned |
|---|---:|---|---|
| `Nvidia` | 23 | `nvidia.eightfold.ai` | Unregistered Eightfold tenant |
| `SATechnologiesInc4` | 14 | SmartRecruiters | Unregistered tenant |
| `Softtek` | 6 | `softtek.eightfold.ai` | Unregistered Eightfold tenant |
| `Therapy Notes` *(Site `therapynotes.com`)* | 2 | Workable | Unregistered |
| `Hemmersbach` | 1 | company site | Unregistered |
| `VedaProf` | 1 | company site | Unregistered |
| `greenhouse.io` | 1 | `job-boards.greenhouse.io/ttcglobal` | **Provider-domain leak** — org slug lost, keyed on the bare board domain |
| `nttdata` | 1 | (no URL) | Unregistered slug |
| `caci` | 1 | (no URL) | Unregistered slug |
| `libertymutual` | 1 | (no URL) | Unregistered slug |
| `Knit Ai` | 1 | `jobs.ashbyhq.com/knit-ai` | Unregistered Ashby tenant |

Two shapes matter for design:

- **Genuinely unregistered** (9) — real sites that scraped jobs but were never
  added to the registry. Only reachable if the delete UI also lists
  *orphan vendors* (jobResults keys with no registry entry).
- **Mis-keyed** (`greenhouse.io`) — the writer captured the provider domain
  instead of the board slug. A data bug, not a matching gap; flagged for a
  future cleanup, not fixed here.

---

## §7.2 — description-file orphans

**Description files not in the registry (7)** — all also have orphan
`jobResults`, so they delete together with their B-type vendors:
`caci`, `Knit Ai`, `libertymutual`, `nttdata`, `Nvidia`, `SATechnologiesInc4`,
`Softtek`.

**Description files with no `jobResults` at all (7)** — all *in* the registry;
their jobs have aged out or been declined, leaving the description behind:
`360ITProfessionals1`, `ArtechInformationSystemLLC`,
`Sonyinteractiveentertainmentglobal`, `TechVedika`, `Trueml`, `Tuesdayhealth`,
`VRProIT`. These are exactly the D3.6 / D3.4 case — the backfill stamps them
with the run date (no join available), and the 30-day purge (§7.3) then reaps
them.

**Within-file orphan entries (5 / 243)** — description entries whose
`"URL entity"` matches no job id in the mapped vendor:
`SamsungSDSA` (4/4, all stale) and `symetra` (1/2). Undatable by join → the
D3.6 backfill stamps them run-date → they purge normally thereafter.

---

## Data-integrity flag (beyond the doc)

**Duplicate registry org name:** `Standardbots` appears twice —
`E014` and `E067`, both in `sites.Employers`. The reverse-lookup
(`reverseOrgs`) keeps only the **first** (`E014`), so any `Standardbots`
results/description silently resolve to `E014`; deleting `E067` by org would be
ambiguous. **Delete/block must key on `id`, not org**, and registration should
reject duplicate org names.

---

## Remediation log

- **2026-08-03 — `r001` mis-key consolidated.** `jobResults` held three
  representations of registry `R001` *Burnett Specialists*: key `r001`
  (`Site:"r001"`, a site-id leak, 21 jobs, orphaned) and key `Burnett`
  (`Site:"Burnett Specialists"`, resolved, 1 job), plus the registry entry.
  Merged both into a single canonical `Burnett Specialists` block (key = Site =
  registry org, 22 unique jobs, 0 id overlap). Renaming `r001` alone would have
  created a *second* key resolving to `R001`; merging avoided that. This dropped
  the orphan count from 12 → 11. (`prospects-data`, validates against
  `jobResults.schema.json`.)

---

## Implications for the features

1. **§7.2 delete needs an orphan-vendor path.** A registry-only delete cannot
   reach the 11 orphan vendors (or their 7 description files). The "Manage
   Sites" panel should also surface `jobResults` keys with no registry entry as
   deletable, or those artifacts persist forever.
2. **Key on `id`, never org.** The `Standardbots` duplicate and the
   `r001` / `greenhouse.io` mis-keys show org/Site is not a safe primary key.
   Delete and block should resolve by `id` and treat org/Site as a tolerant
   secondary lookup only.
3. **§7.3 purge fixtures come free.** The 7 description-without-jobResults files
   and the 5 within-file orphan entries are ready-made cases for the D3.6
   backfill + 30-day purge tests.
4. **Case-folding is nearly a non-issue** (1 row). Test it, but do not
   over-invest — orphans and duplicates are where the risk lives.
