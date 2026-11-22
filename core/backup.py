"""Two independent backups, both checked:

1. **System backup** on this PC: `%LOCALAPPDATA%\\MadhuramPOS\\store\\backups\\`
2. **Google Drive backup**: a verified copy in the Google Drive for desktop folder
   (`My Drive\\Madhuram backups\\`), which Google uploads to the cloud by itself.

Each backup is a consistent snapshot taken with SQLite's online-backup API while billing continues,
checked with PRAGMA integrity_check, then gzip-compressed (about 4–6× smaller). The Drive copy is
re-read and compared byte for byte (SHA-256) after copying.

Retention (both places): every backup from the last 2 days, one per day for 60 days, one per month
for 24 months, within a size budget (Google Drive 6 GB of the free 15 GB, this PC 20 GB; the oldest go
first, the newest 3 always stay). Manual backups on the PC are never deleted automatically.
"""
import gzip
import hashlib
import json
import os
import shutil
import sqlite3
import string
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

from django.conf import settings
from django.db import connection

DRIVE_SUBFOLDER = "Madhuram backups"
GB = 1024 ** 3
# Free Google Drive is 15 GB, shared with Gmail and Photos: our backups use at most 6 GB of it by default.
DRIVE_BUDGET = int(float(os.environ.get("MPC_DRIVE_BUDGET_GB", "6")) * GB)
LOCAL_BUDGET = int(float(os.environ.get("MPC_LOCAL_BUDGET_GB", "20")) * GB)


class BackupError(RuntimeError):
    pass


# ------------------------------------------------------------------ making backups
def make_backup(dest_dir=None, label="manual", compress=True):
    dest_dir = Path(dest_dir or settings.BACKUP_DIR)
    dest_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    raw = dest_dir / f"madhuram-{settings.MODE}-{stamp}-{label}.sqlite3"
    tmp = raw.with_suffix(".partial")
    connection.ensure_connection()
    out = sqlite3.connect(str(tmp))
    try:
        connection.connection.backup(out)        # consistent snapshot, billing can continue
        ok = out.execute("PRAGMA integrity_check").fetchone()[0]
        if ok != "ok":
            raise BackupError(f"Integrity check failed on the backup copy: {ok}")
    finally:
        out.close()
    if not compress:
        tmp.replace(raw)
        return raw
    final = raw.with_name(raw.name + ".gz")
    part = final.with_name(final.name + ".partial")
    with open(tmp, "rb") as src, gzip.open(part, "wb", compresslevel=6) as dst:
        shutil.copyfileobj(src, dst, 1024 * 1024)
    tmp.unlink(missing_ok=True)
    part.replace(final)
    return final


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def copy_verified(src, folder):
    """Copy to the second place and prove the copy is identical."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / src.name
    part = folder / (src.name + ".partial")
    shutil.copyfile(src, part)
    if sha256(part) != sha256(src):
        part.unlink(missing_ok=True)
        raise BackupError("The copy in the second folder does not match the original.")
    part.replace(dest)
    return dest


# ------------------------------------------------------------------ Google Drive
def detect_google_drive():
    """Find the Google Drive for desktop 'My Drive' folder on Windows (or a configured path)."""
    candidates = []
    if os.name == "nt":
        for letter in string.ascii_uppercase[3:]:  # D: … Z:  (Drive for desktop uses G: by default)
            candidates += [Path(f"{letter}:/My Drive"), Path(f"{letter}:/எனது இயக்ககம்")]
    home = Path.home()
    candidates += [home / "Google Drive" / "My Drive", home / "My Drive", home / "Google Drive", home / "GoogleDrive"]
    for c in candidates:
        try:
            if c.is_dir():
                return c
        except OSError:
            continue
    return None


def drive_folder(cfg=None):
    from core.models import StoreSettings

    cfg = cfg or StoreSettings.load()
    if cfg.backup_extra_dir:
        return Path(cfg.backup_extra_dir)
    return None


# ------------------------------------------------------------------ retention
def _stamp(p):
    try:
        return datetime.strptime("-".join(p.name.split("-")[2:4]), "%Y%m%d-%H%M%S")
    except ValueError:
        return datetime.fromtimestamp(p.stat().st_mtime)


def retention(folder, include_manual=False, now=None, max_bytes=None):
    """Keep: all from the last 2 days, newest per day for 60 days, newest per month for 24 months.
    If the kept files are larger than max_bytes, the oldest are removed first (the newest 3 are always kept)."""
    folder = Path(folder)
    if not folder.exists():
        return []
    now = now or datetime.now()
    files = [p for p in folder.glob(f"madhuram-{settings.MODE}-*.sqlite3*") if not p.name.endswith(".partial")]
    if not include_manual:
        files = [p for p in files if "-manual" not in p.name and "-check" not in p.name]
    files.sort(key=_stamp, reverse=True)
    keep, days, months, removed = set(), set(), set(), []
    for p in files:
        t = _stamp(p)
        age = now - t
        if age <= timedelta(days=2):
            keep.add(p)
        elif age <= timedelta(days=60) and t.date() not in days:
            keep.add(p)
            days.add(t.date())
        elif age <= timedelta(days=730) and (t.year, t.month) not in months:
            keep.add(p)
            months.add((t.year, t.month))
    if max_bytes:
        kept = [p for p in files if p in keep]  # newest first
        total = sum(p.stat().st_size for p in kept)
        for p in reversed(kept[3:]):
            if total <= max_bytes:
                break
            total -= p.stat().st_size
            keep.discard(p)
    for p in files:
        if p not in keep:
            p.unlink(missing_ok=True)
            removed.append(p.name)
    return removed


# ------------------------------------------------------------------ status
def _status_file():
    return Path(settings.DATA_DIR) / "backup_status.json"


def read_status():
    try:
        return json.loads(_status_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _write_status(**parts):
    s = read_status()
    s.update(parts)
    try:
        _status_file().write_text(json.dumps(s, indent=1), encoding="utf-8")
    except OSError:
        pass


def health():
    """What the owner sees: are BOTH backups fresh?"""
    s, now = read_status(), datetime.now()
    out = []
    for key, label in (("local", "System backup (this PC)"), ("drive", "Google Drive backup")):
        r = s.get(key) or {}
        at = datetime.fromisoformat(r["at"]) if r.get("at") else None
        ok = bool(r.get("ok")) and at is not None and now - at < timedelta(hours=26)
        msg = r.get("error") or ("" if at else "Never made yet")
        if key == "drive" and not drive_folder():
            ok, msg = False, "Google Drive folder not set. Install Google Drive for desktop, then Settings → Backups → Find Google Drive."
        out.append({"key": key, "label": label, "ok": ok, "at": at, "file": r.get("file", ""), "size": r.get("size", 0), "msg": msg})
    return out


# ------------------------------------------------------------------ the automatic run
def auto_backup(label="auto", drive=True):
    """System backup + Google Drive copy + retention. Never raises into billing.
    drive=False (the hourly run) keeps the copy on this PC only, to save the shop's internet."""
    from core.models import StoreSettings, audit

    if settings.MODE == "test":  # the automated tests check backups explicitly
        return None
    now = datetime.now().isoformat(timespec="seconds")
    try:
        path = make_backup(label=f"auto-{label}")
        _write_status(local={"at": now, "ok": True, "file": path.name, "size": path.stat().st_size})
    except Exception as exc:  # noqa: BLE001
        _write_status(local={"at": now, "ok": False, "error": str(exc)[:200]})
        try:
            audit("backup_failed", f"System backup failed: {exc}")
        except Exception:  # noqa: BLE001
            pass
        return None
    try:
        folder = drive_folder(StoreSettings.load()) if drive else None
    except Exception as exc:  # noqa: BLE001
        folder = None
        _write_status(drive={"at": now, "ok": False, "error": f"Could not read the backup settings: {exc}"[:300]})
    if folder:
        try:
            copy = copy_verified(path, folder / DRIVE_SUBFOLDER / settings.MODE)
            _write_status(drive={"at": now, "ok": True, "file": copy.name, "size": copy.stat().st_size, "folder": str(copy.parent)})
        except Exception as exc:  # noqa: BLE001
            _write_status(drive={"at": now, "ok": False, "error": f"Could not copy to Google Drive ({folder}): {exc}"[:300]})
            try:
                audit("backup_warning", f"Google Drive copy failed: {exc}")
            except Exception:  # noqa: BLE001
                pass
    for place, budget in ((folder / DRIVE_SUBFOLDER / settings.MODE if folder else None, DRIVE_BUDGET), (settings.BACKUP_DIR, LOCAL_BUDGET)):
        if place:
            try:
                retention(place, max_bytes=budget)
            except OSError:
                pass
    return path


def list_backups():
    d = Path(settings.BACKUP_DIR)
    if not d.exists():
        return []
    files = [p for p in d.glob("madhuram-*.sqlite3*") if not p.name.endswith(".partial")]
    return sorted(files, key=lambda p: p.stat().st_mtime, reverse=True)


# ------------------------------------------------------------------ checking and restoring
def open_plain(path):
    """Return (sqlite path, cleanup) – decompresses .gz backups to a temporary file."""
    path = Path(path)
    if not path.name.endswith(".gz"):
        return path, (lambda: None)
    fd, tmp = tempfile.mkstemp(suffix=".sqlite3")
    os.close(fd)
    try:
        with gzip.open(path, "rb") as src, open(tmp, "wb") as dst:
            shutil.copyfileobj(src, dst, 1024 * 1024)
    except (OSError, EOFError) as exc:
        Path(tmp).unlink(missing_ok=True)
        raise BackupError(f"Backup file is damaged and cannot be decompressed: {exc}") from exc
    return Path(tmp), (lambda: Path(tmp).unlink(missing_ok=True))


def verify_backup(path):
    """Open a backup as a separate, read-only database and report what it contains."""
    path = Path(path)
    if not path.exists():
        raise BackupError(f"{path} not found")
    plain, cleanup = open_plain(path)
    try:
        con = sqlite3.connect(f"file:{plain}?mode=ro", uri=True)
        try:
            con.row_factory = sqlite3.Row
            ok = con.execute("PRAGMA integrity_check").fetchone()[0]
            last = con.execute("SELECT bill_no, total, created_at FROM sales_sale ORDER BY id DESC LIMIT 1").fetchone()
            sales = con.execute("SELECT COUNT(*), COALESCE(SUM(total),0) FROM sales_sale").fetchone()
            stock = con.execute("SELECT COUNT(*), COALESCE(SUM(on_hand),0) FROM catalog_item WHERE on_hand<>0").fetchone()
            lots = con.execute("SELECT COALESCE(SUM(qty),0) FROM inventory_stocklot WHERE status='sellable'").fetchone()[0]
            shift = con.execute("SELECT id, status, opening_float, expected, counted, variance FROM sales_shift ORDER BY id DESC LIMIT 1").fetchone()
            items = con.execute("SELECT COUNT(*) FROM catalog_item").fetchone()[0]
            return {
                "file": str(path), "integrity": ok, "items": items,
                "last_bill": dict(last) if last else None,
                "sales_count": sales[0], "sales_total": str(sales[1]),
                "items_with_stock": stock[0], "stock_units": str(stock[1]), "lot_units": str(lots),
                "last_shift": dict(shift) if shift else None,
            }
        finally:
            con.close()
    finally:
        cleanup()
