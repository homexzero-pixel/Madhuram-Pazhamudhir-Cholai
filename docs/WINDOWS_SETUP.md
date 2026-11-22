# Windows setup (counter PC)

Tested so far on Linux only. The steps below use standard Windows tools; run them once on the counter PC and note anything that
differs. Nothing here needs internet after setup.

## 1. Requirements

- Windows 10 or 11, 64-bit. 4 GB RAM is enough; an SSD is strongly recommended. See [CAPACITY.md](CAPACITY.md).
- A free Google account for the shop (for the Google Drive backup).
- **Python 3.12** from <https://www.python.org/downloads/windows/>. In the installer tick **"Add python.exe to PATH"** and keep
  **"py launcher"** ticked.
- Microsoft Edge (already on Windows). It is used in "app mode", which gives a full window without the address bar.

## 2. Install

**Quickest:** double-click **`Install_Madhuram.bat`**. It installs Python if needed (with Windows' `winget`), sets everything up, asks for the owner login, sets up the **two automatic backups (this PC + Google Drive)**, adds desktop shortcuts, makes the store start with Windows, and opens it. If it installs Python, it asks you to double-click it once more.

Step by step instead:


1. Copy the `Madhuram_Store_System` folder to `C:\Madhuram` (any folder without special permissions is fine).
2. Double-click **`Setup_Windows.bat`**.
   - If the folder contains `wheels\`, it installs from there with **no internet**.
   - Otherwise it downloads Django, Waitress and openpyxl once.
   - It prepares both databases: the store one and the practice one.
3. Double-click **`Create_Owner.bat`** and enter the owner's user name, password and a 4–6 digit approval PIN.

## 3. Daily use

| Launcher | What it does |
|---|---|
| `Start_Store.bat` | Starts the **real store**. Keep its black window open (you can minimise it); the billing window opens by itself. |
| `Try_Demo.bat` | Starts the **practice** database on a different port. Safe for training. |
| `Backup_Now.bat` | Makes a checked backup on this PC and in Google Drive, and shows the last bill, stock and shift it contains. |
| `Setup_Backups.bat` | Finds or installs Google Drive for desktop and creates the 21:30 nightly backup task. See [BACKUP_RESTORE.md](BACKUP_RESTORE.md). |
| `Restore_Backup.bat` | Puts a backup back. Close `Start_Store.bat` first. See [BACKUP_RESTORE.md](BACKUP_RESTORE.md). |
| `Import_Pilot_Data.bat` | One time only: brings data from the earlier pilot counter. It shows a dry run first. |

To start automatically at switch-on, put a shortcut to `Start_Store.bat` in the Startup folder (`Win+R` → `shell:startup`).

## 4. First configuration (owner)

1. **Settings → Store identity & invoices**: legal name, address, phone, GSTIN, FSSAI, invoice prefix. Have the accountant check
   these ([GST_AND_INVOICES.md](GST_AND_INVOICES.md)).
2. **Settings → Staff**: add each cashier with their own login. Give managers an approval PIN.
3. **Settings → Scanner, printer and scale**: see [HARDWARE.md](HARDWARE.md).
4. **Settings → Backups**: both cards (this PC and Google Drive) must be green. If Google Drive is red, run `Setup_Backups.bat`.
5. **Products**: verify and price the items you actually sell ([OWNER_GUIDE.md](OWNER_GUIDE.md#products)).
6. **Purchases → Receive goods**: enter opening stock with a clearly marked invoice number such as `OPENING-2026-11`.
7. **Cash Closing → Open shift** with the float, and start billing.

## Where things are

| What | Where |
|---|---|
| Store database | `%LOCALAPPDATA%\MadhuramPOS\store\madhuram.sqlite3` |
| Store backups (this PC) | `%LOCALAPPDATA%\MadhuramPOS\store\backups\` |
| Store backups (Google Drive) | `G:\My Drive\Madhuram backups\store\` |
| Backup status | `%LOCALAPPDATA%\MadhuramPOS\store\backup_status.json` |
| Practice database | `%LOCALAPPDATA%\MadhuramPOS\demo\` |
| Error log | `app.log` next to the database |
| Pilot database (if any) | `%LOCALAPPDATA%\MadhuramPOS\store\counter.sqlite` (left untouched) |

## Updating the program

Close `Start_Store.bat`, run `Backup_Now.bat`, replace the program folder (keep `.venv`), run `Setup_Windows.bat` again
(it applies database migrations), then start as usual. Data is outside the program folder and is not replaced.
