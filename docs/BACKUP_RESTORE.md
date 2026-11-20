# Backup and restore

## What is backed up, and when

- The whole store database: products, stock lots, bills, payments, returns, shifts, purchases, customers, settings and the audit log.
- **Automatically**: the first time the program starts each day, and every time a shift is closed.
- **Manually**: Settings → Backups → *Back up now*, or `Backup_Now.bat`.
- Every copy is made with SQLite's online-backup method, which is safe while billing continues, and then checked with
  `PRAGMA integrity_check` before it is kept.
- The last 30 automatic backups are kept (Settings → Backups). Manual backups are never deleted automatically.
- If **Settings → Backups → second folder** is set (USB drive or a shared folder on another PC), every automatic backup is
  also copied there. A failure to copy is written to the audit log, and billing continues.

Location: `%LOCALAPPDATA%\MadhuramPOS\store\backups\madhuram-store-YYYYMMDD-HHMMSS-*.sqlite3`

**At least once a week, copy the latest backup to something that leaves the shop** (USB drive taken home, or cloud storage).
A backup on the same PC does not survive a stolen or failed PC.

![Backups](img/36-backups.jpg)

## Check a backup (restore test without touching the live data)

Settings → Backups → **Check contents** on any file. This opens the backup read-only, as a separate database, and shows the
integrity result, the last bill number and total, the stock on hand, and the last shift's float, expected and counted cash.
Compare these with the live screens. Do this once a month.

`Backup_Now.bat` does the same for a fresh backup.

## Restore (recovery procedure)

Use this when the PC's database is damaged or a wrong action must be undone.

1. **Stop billing.** Close the `Start_Store.bat` window. Make sure no Madhuram window is still open.
2. Choose the backup: normally the newest file, or the one just before the problem. Check it first as above if the program
   still opens.
3. Double-click **`Restore_Backup.bat`**, drag the backup file into the window, press Enter and type `YES`.
   - The backup is checked again.
   - The current database is **kept**, renamed `madhuram-before-restore-YYYYMMDD-HHMMSS.sqlite3`. Nothing is deleted.
   - The backup is copied into place.
4. Start `Start_Store.bat`. Check:
   - the **last bill number** in Sales & Returns;
   - stock of a few items you know (Products → item → stock lots);
   - **Cash Closing**: the last shift's figures.
5. Anything sold after the backup was taken is not in the restored data. Re-enter those bills from the paper receipts, or
   receive/adjust stock with a stocktake.

On a new PC: install as in [WINDOWS_SETUP.md](WINDOWS_SETUP.md), run `Setup_Windows.bat`, then restore as above. You do not
need to create the owner again, because the backup contains the staff logins.

Command-line equivalents (from the program folder, with `set MPC_MODE=store`):

```bat
.venv\Scripts\python.exe manage.py verify_backup "C:\path\to\backup.sqlite3"
.venv\Scripts\python.exe manage.py restore_backup "C:\path\to\backup.sqlite3"
```

## Tested

`scripts/run_acceptance.py` closes a shift, makes a backup through the web screen, restores it into a **separate** database
folder with `restore_backup`, and compares the last bill, every stock balance and the shift totals: they matched
([ACCEPTANCE_RESULTS.md](ACCEPTANCE_RESULTS.md), test 10). This has not yet been tried on the shop's Windows PC; do one restore
drill there before going live.

## Practice data

The practice database (`…\MadhuramPOS\demo\`) is separate and has its own backups. Deleting the `demo` folder and running
`Try_Demo.bat` builds fresh practice data. The `seed_demo` command refuses to run against the store database.
