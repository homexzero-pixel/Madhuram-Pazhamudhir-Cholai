"""Double backup: compressed system backup, verified Google Drive copy, tiered retention and size budget."""
import gzip
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

from django.test import SimpleTestCase, TransactionTestCase

from core import backup


class DoubleBackupTests(TransactionTestCase):
    serialized_rollback = True  # same as A10: keeps the shared test database intact for the tests that follow

    def test_compressed_backup_copies_to_drive_and_verifies(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            path = backup.make_backup(tmp / "pc", label="auto-test")
            self.assertTrue(path.name.endswith(".sqlite3.gz"))
            with gzip.open(path, "rb") as f:
                self.assertEqual(f.read(16), b"SQLite format 3\x00")
            copy = backup.copy_verified(path, tmp / "My Drive" / backup.DRIVE_SUBFOLDER)
            self.assertEqual(backup.sha256(copy), backup.sha256(path))
            self.assertEqual(backup.verify_backup(copy)["integrity"], "ok")
            self.assertFalse(list((tmp / "My Drive").rglob("*.partial")))

    def test_damaged_backup_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = backup.make_backup(tmp, label="auto-test")
            data = path.read_bytes()
            path.write_bytes(data[: len(data) // 2])  # cut off, like an interrupted copy
            with self.assertRaises(backup.BackupError):
                backup.verify_backup(path)


class RetentionTests(SimpleTestCase):
    def _fill(self, d, now, days, step_hours=4):
        for h in range(0, 24 * days, step_hours):
            t = now - timedelta(hours=h)
            (d / f"madhuram-test-{t:%Y%m%d-%H%M%S}-auto-hourly.sqlite3.gz").write_bytes(b"x" * 10)

    def test_tiers_keep_recent_daily_monthly_and_manual(self):
        now = datetime(2026, 11, 22, 20, 0)
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            self._fill(d, now, 800)
            (d / "madhuram-test-20240101-100000-manual.sqlite3.gz").write_bytes(b"m")
            backup.retention(d, now=now)
            names = sorted(p.name for p in d.iterdir())
            self.assertIn("madhuram-test-20240101-100000-manual.sqlite3.gz", names)
            autos = [n for n in names if "auto" in n]
            self.assertEqual(len([n for n in autos if n >= f"madhuram-test-{now - timedelta(days=2):%Y%m%d-%H%M%S}"]), 13)
            self.assertLess(len(autos), 13 + 60 + 25)
            self.assertTrue(any(n.startswith("madhuram-test-2024") for n in autos))  # monthly copies from long ago

    def test_size_budget_drops_oldest_first(self):
        now = datetime(2026, 11, 22, 20, 0)
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            self._fill(d, now, 30, step_hours=24)  # 30 daily files of 10 bytes
            backup.retention(d, now=now, max_bytes=55)
            left = sorted(p.name for p in d.iterdir())
            self.assertEqual(len(left), 5)
            self.assertEqual(left[-1], f"madhuram-test-{now:%Y%m%d-%H%M%S}-auto-hourly.sqlite3.gz")
