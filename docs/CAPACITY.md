# Capacity test: how much the counter PC can handle

**Question:** running free on the counter PC, with two backups, how far can the system go?
**Method:** a copy of the practice database was filled with **one full year of a busy shop**:
- **400 bills a day × 365 days = 146,000 bills**;
- 6 lines per bill = 876,000 bill lines, plus the matching stock moves, lot allocations and audit entries;
- 20,005 products.

The real program then ran on it (Waitress server, real HTTP requests, real checkouts that deduct stock) and was measured.
The bills were synthetic copies of real practice bills. Tested 22 November 2026 on the development machine (Linux, 4 cores).
**A typical shop PC is slower, so allow about 2–3× for the times below.**

## Results after one busy year

| Measure | Result | Comfortable limit |
|---|---|---|
| Database size | **586 MB** | Many GB; SQLite has no practical limit here |
| Scan a barcode (HTTP, median / worst) | **24 ms / 66 ms** | Under 300 ms feels instant |
| Checkout (save bill, stock, payment) | **33 ms / 49 ms** | — |
| Scan / checkout **while a backup runs** | **20 ms / 26 ms** (no slow-down) | — |
| Owner dashboard | 235 ms | — |
| Daily sales report | 94 ms | — |
| Sales list / Backups page | 19 ms / 13 ms | — |
| Make + check + compress a backup | **19 s**, in the background | — |
| Compressed backup file | **110 MB** (5.3× smaller) | — |
| Copy to Google Drive folder + SHA-256 check | 0.2 s (then Google uploads in the background) | — |
| Restore check of a backup | 11 s | — |

Barcode lookup alone, at 20,000 SKUs: 0.44 ms (from the earlier acceptance run).

## What this means for Madhuram

| Shop size | Database after 1 year | Backup file | Google Drive (6 GB budget) holds |
|---|---|---|---|
| 150 bills/day | ≈ 220 MB | ≈ 40 MB | ≈ 150 backups: all the retention tiers (≈ 100 files) |
| 400 bills/day | ≈ 590 MB | ≈ 110 MB | ≈ 55 backups: the last 2 days, every day for about 6 weeks |
| 400 bills/day, year 2 (estimate) | ≈ 1.2 GB | ≈ 220 MB | ≈ 27 backups: every day for about 3 weeks |

- **Speed is not the limit.** Billing stayed at about 20–35 ms per action on a full busy year, and backups do not slow it down.
  Years of data are fine.
- **Google Drive space is the limit that matters**, and it is handled: the budget removes the oldest Drive copies first, and the newest
  3 are always kept. The PC keeps the full history (20 GB budget).
- **Internet use:** hourly backups stay on the PC. Google Drive gets about 3 copies a day (start-up, shift close, 21:30), so at
  400 bills/day after a year, that is about 330 MB of upload a day. Google Drive for desktop resumes uploads after an outage. On a
  slow or metered connection, set Google Drive's upload limit (Drive for desktop → Settings → Bandwidth).

## Built-in tuning for a long, smooth run

- SQLite in WAL mode, `synchronous=FULL` (no lost bills after a power cut), foreign keys, an immediate write lock on every save, and
  indexes on every lookup and report column.
- At every start: `PRAGMA quick_check` (a corruption warning is shown at once), `PRAGMA optimize` (fresh query statistics), and a WAL
  checkpoint so the log file does not grow.
- Hourly backups only when something changed (no empty copies overnight).
- Waitress with 8 threads; the backup runs in its own thread or process and never holds the write lock.

## Recommendations (all free)

1. **Use an SSD** in the counter PC. This matters more than CPU or RAM; 4 GB RAM is enough.
2. **A UPS (battery backup)** for the PC. The database survives power cuts, but a UPS prevents half-printed bills and disk wear.
3. Keep at least **30 GB free** on drive C:.
4. Sign Google Drive in with **the shop's own Google account**, with 2-step verification on.
5. Once a month: Settings → Backups → *Check contents* on the newest file, and look in drive.google.com → *Madhuram backups*.
6. If the shop grows beyond about 1,000 bills a day, or Drive space gets tight after 2–3 years, start a fresh database each financial
   year and keep the old one read-only. This is not built yet, and is not needed at current sizes.

## Re-running the test

The fill and benchmark scripts are small, one-off tools: clone real bills into a copy of a database, then time scans, checkouts and
pages over HTTP while `manage.py auto_backup` runs. Never run them against the store database.
