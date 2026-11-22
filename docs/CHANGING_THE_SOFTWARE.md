# Changing the software later

The program is yours: the full source code is in your GitHub repository
(`homexzero-pixel/madhuram-pazhamudhir-cholai`). There is no licence fee and no lock-in. It is written in **Python (Django)**,
one of the most common languages, so any Python developer can work on it.

## Three ways to make changes

| Way | Good for | Cost |
|---|---|---|
| **Settings screens** in the program | Shop name, GSTIN, invoice prefix, footer, loyalty, receipt width, scale labels, WhatsApp on/off and message, backups, staff and roles, offers | Free, no programming |
| **Claude Code** (what built this) | New features and changes described in plain words, e.g. "add a supplier-wise reorder list" | Your Claude plan |
| **A local Python / Django developer** | Same, or work on site with the hardware | Their fee |

Whoever changes it should:
1. Work on a copy: a new **branch** in GitHub, never directly on the shop PC.
2. Run the automated checks: `MPC_MODE=test python manage.py test` (50 tests) and `python scripts/run_acceptance.py`.
3. Try it with the practice data (`Try_Demo.bat`) before the shop uses it.
4. Give you a new `Madhuram_Store_System.zip`.

## Installing an update at the shop

1. After closing time, run `Backup_Now.bat` (both backups) and close `Start_Store.bat`.
2. Replace the program folder with the new one (keep `.venv` if it is there). **Your data is not in the program folder**; it stays in
   `%LOCALAPPDATA%\MadhuramPOS\store\`.
3. Run `Setup_Windows.bat`. It updates the database structure automatically.
4. Start `Start_Store.bat` and check the last bill, a few stock figures and Settings → Backups.

## Where things are (for a developer)

| Part | Folder |
|---|---|
| Billing counter screen and keys | `templates/sales/pos.html`, `static/js/pos.js`, `sales/api.py`, `sales/services.py` |
| WhatsApp bills | `sales/whatsapp.py` (message and links), `static/js/whatsapp.js` |
| Quick add products | `catalog/quick.py`, `static/js/quickadd.js` |
| Products, import, labels | `catalog/` |
| Stock lots and ledger | `inventory/` |
| Purchases and suppliers | `purchasing/` |
| Reports and dashboard | `reports/` |
| Backups | `core/backup.py`, `Setup_Backups.bat` |
| Colours and look | `static/css/app.css` (the colours are at the top) |
| Settings fields | `core/models.py` (`StoreSettings`) |
| Database tables | [SCHEMA.md](SCHEMA.md) |
