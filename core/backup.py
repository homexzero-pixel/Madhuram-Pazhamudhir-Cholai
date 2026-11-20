"""Consistent SQLite backups using the online-backup API, with an integrity check on every copy."""
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path

from django.conf import settings
from django.db import connection


class BackupError(RuntimeError):
    pass


def _db_path():
    return Path(settings.DATABASES["default"]["NAME"])


def make_backup(dest_dir=None, label="manual"):
    dest_dir = Path(dest_dir or settings.BACKUP_DIR)
    dest_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = dest_dir / f"madhuram-{settings.MODE}-{stamp}-{label}.sqlite3"
    tmp = dest.with_suffix(".partial")
    # Use the app's own connection: the SQLite online-backup API copies a consistent snapshot
    # even while billing continues.
    connection.ensure_connection()
    src = connection.connection
    out = sqlite3.connect(str(tmp))
    try:
        src.backup(out)
        ok = out.execute("PRAGMA integrity_check").fetchone()[0]
        if ok != "ok":
            raise BackupError(f"Integrity check failed on the backup copy: {ok}")
    finally:
        out.close()
    tmp.replace(dest)
    return dest


def prune(keep):
    files = sorted(Path(settings.BACKUP_DIR).glob(f"madhuram-{settings.MODE}-*-auto*.sqlite3"))
    for f in files[:-keep] if keep and len(files) > keep else []:
        f.unlink(missing_ok=True)


def auto_backup(label="auto"):
    """Called after a shift closes and once a day at start-up. Never raises into the caller."""
    from core.models import StoreSettings, audit

    if settings.MODE == "test":  # the automated tests check backups explicitly
        return None
    try:
        cfg = StoreSettings.load()
        path = make_backup(label=f"auto-{label}")
        if cfg.backup_extra_dir:
            try:
                Path(cfg.backup_extra_dir).mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, Path(cfg.backup_extra_dir) / path.name)
            except OSError as exc:
                audit("backup_warning", f"Could not copy backup to {cfg.backup_extra_dir}: {exc}")
        prune(cfg.backup_keep)
        return path
    except Exception as exc:  # noqa: BLE001 – a failed backup must not stop billing
        try:
            audit("backup_failed", f"Automatic backup failed: {exc}")
        except Exception:  # noqa: BLE001
            pass
        return None


def list_backups():
    d = Path(settings.BACKUP_DIR)
    if not d.exists():
        return []
    return sorted(d.glob("madhuram-*.sqlite3"), key=lambda p: p.stat().st_mtime, reverse=True)


def verify_backup(path):
    """Open a backup as a separate database and report what it contains. Does not touch the live data."""
    path = Path(path)
    if not path.exists():
        raise BackupError(f"{path} not found")
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
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
