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

**Snapshot:** `prospects-data@003cce2` ("update 1 8.3"), audited **2026-08-03**.

---

## Summary

| Population | Count |
|---|---|
| Registry entries (`sites.json` + Eightfold `filters.json`) | 187 |
| `jobResults` vendor keys | 140 |
| Description files | 135 |
| Exact matches | 125 |
| **Case-insensitive-only matches (§2.6)** | **1** |
| **Orphaned `jobResults` vendors (§7.2)** | **14** (106 jobs) |
| Registry entries with no results yet | 63 |
| Description files not in registry | 10 |
| Description files with no `jobResults` | 5 |
| `jobResults` with no description file | 7 |
| Within-file orphan entries (`URL entity` ∦ any job id) | 11 / 25 |
| Duplicate org names in registry | 1 |

**Headline:** the tolerant matcher folds **case only**, not punctuation or
whitespace — so its practical rescue surface is a **single** row (§2.6). The
real hazard is the **14 orphan vendors** (§7.2), and 3 of them prove the point
concretely: they were in the registry two weeks ago, were removed since, and
their results were left stranded (below).

---

## §2.6 — case-insensitive / trim-only matches (1)

| `jobResults` key/Site | Registry org | id / source | jobs |
|---|---|---|---|
| `symetra` | `Symetra` | `E812` / `filters.json` root | 1 |

The doc's illustrative example (`Ten Mile Square Tecnologies` vs
`TenMileSquareTechnologies`) would **not** match under this matcher — the
spaces differ and the matcher is not punctuation-insensitive. Case-folding is a
real but tiny surface; do not over-invest tests here.

---

## §7.2 — orphaned `jobResults` vendors (14, ~106 jobs)

No registry entry matches these (exact or case-insensitive), so they are
**unreachable by a delete keyed on `sites.json`/`filters.json`**. Three classes:

### A. De-registered — the §7.2 hazard, already realized (3, 54 jobs)

These orgs were in the **2026-07-22** registry (`sites.json`) and have since
been **removed from the registry while their `jobResults` (and description)
data was left behind** — the exact failure a naive delete-site would cause.

| `jobResults` key | jobs | Was | Now |
|---|---:|---|---|
| `Encora` | 20 | `E052` (Employers) | gone from registry, 20 jobs stranded |
| `Sonyinteractiveentertainmentglobal` | 20 | `E029` (Employers) | gone, 20 jobs stranded |
| `Cerebras` | 14 | `E068` (Employers) | gone, 14 jobs stranded |

### B. Never registered — real sites scraped, never added (10, 51 jobs)

| `jobResults` key | jobs | Provider |
|---|---:|---|
| `Nvidia` | 23 | Eightfold (`nvidia.eightfold.ai`) |
| `SATechnologiesInc4` | 14 | SmartRecruiters |
| `Softtek` | 6 | Eightfold (`softtek.eightfold.ai`) |
| `Therapy Notes` *(Site `therapynotes.com`)* | 2 | Workable |
| `Hemmersbach` | 1 | company site |
| `VedaProf` | 1 | company site |
| `nttdata` | 1 | (no URL) |
| `caci` | 1 | (no URL) |
| `libertymutual` | 1 | (no URL) |
| `Knit Ai` | 1 | Ashby |

Only reachable if the delete UI also lists **orphan vendors** (jobResults keys
with no registry entry).

### C. Mis-keyed (1)

- `greenhouse.io` (1 job) — **provider-domain leak**: the writer captured the
  bare board domain instead of the board slug (`job-boards.greenhouse.io/ttcglobal`).
  A data bug; flagged for cleanup, not fixed here.

---

## §7.2 — description-file orphans

**Description files not in the registry (10)** — the 3 de-registered orgs plus
the B-class unregistered ones with description files: `Cerebras`, `Encora`,
`Knit Ai`, `Nvidia`, `SATechnologiesInc4`, `Softtek`,
`Sonyinteractiveentertainmentglobal`, `caci`, `libertymutual`, `nttdata`.

**Description files with no `jobResults` at all (5)** — all *in* the registry;
their jobs aged out or were declined (note PR #4 already stripped status-4
descriptions upstream), leaving the file behind: `360ITProfessionals1`,
`ArtechInformationSystemLLC`, `TechVedika`, `Trueml`, `VRProIT`. These are the
D3.6 / D3.4 case — the backfill stamps them run-date (no join available), and
the 30-day purge (§7.3) reaps them.

**Within-file orphan entries (11 / 25)** — entries whose `"URL entity"` matches
no job id in the mapped vendor: `Sonyinteractiveentertainmentglobal` (5/5),
`SamsungSDSA` (4/4), `Alvin ISD` (1/1), `Tuesdayhealth` (1/1). Undatable by
join → the D3.6 backfill stamps them run-date → they purge normally thereafter.

---

## Data-integrity flag (beyond the doc)

**Duplicate registry org name:** `Standardbots` appears twice — `E014` and
`E067`, both in `sites.Employers`. The reverse-lookup keeps only the **first**
(`E014`), so any `Standardbots` results/description silently resolve to `E014`;
deleting `E067` by org would be ambiguous. **Delete/block must key on `id`, not
org**, and registration should reject duplicate org names.

---

## Note on the `r001` / Burnett consolidation

An earlier pass in this session (against stale 2026-07-22 data) merged three
representations of registry `R001` *Burnett Specialists* — keys `r001`
(site-id leak, 21 jobs) and `Burnett` (1 job) — into a single canonical
`Burnett Specialists` block. On refreshing to `origin/main`, **upstream had
already made the identical consolidation** (`Burnett Specialists`, 22 jobs), so
that redundant commit was dropped. No action needed; recorded here for history.

---

## Implications for the features

1. **§7.2 delete needs an orphan-vendor path — and this is not hypothetical.**
   Three orgs (54 jobs) were de-registered in the last two weeks with their
   results stranded. A registry-only delete cannot reach the 14 orphan vendors
   or their 10 description files. The "Manage Sites" panel should also surface
   `jobResults` keys with no registry entry as deletable.
2. **Key on `id`, never org.** The `Standardbots` duplicate and the
   `r001` / `greenhouse.io` mis-keys show org/Site is not a safe primary key.
   Delete and block should resolve by `id` and treat org/Site as a tolerant
   secondary lookup only.
3. **§7.3 purge fixtures come free.** The 5 description-without-jobResults files
   and the 11 within-file orphan entries are ready-made cases for the D3.6
   backfill + 30-day purge tests.
4. **Case-folding is nearly a non-issue** (1 row). Test it, but the risk lives
   in orphans and duplicates.
