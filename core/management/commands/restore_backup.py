"""Replace the database with a backup. STOP the store app first. The current database is kept as a copy."""
import shutil
from datetime import datetime
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from core.backup import verify_backup


class Command(BaseCommand):
    help = "Restore a backup file into this mode's database (app must be stopped)."

    def add_arguments(self, parser):
        parser.add_argument("file")
        parser.add_argument("--yes", action="store_true", help="Do not ask for confirmation")

    def handle(self, *args, file, yes, **opts):
        src = Path(file)
        report = verify_backup(src)
        if report["integrity"] != "ok":
            raise CommandError(f"Backup failed its integrity check: {report['integrity']}")
        self.stdout.write(f"Backup contains {report['sales_count']} bills, last {report['last_bill']}, last shift {report['last_shift']}.")
        db = Path(settings.DB_FILE)
        if not yes and input(f"Replace {db} with this backup? Type YES: ").strip() != "YES":
            raise CommandError("Cancelled.")
        keep = db.with_name(f"{db.stem}-before-restore-{datetime.now():%Y%m%d-%H%M%S}{db.suffix}")
        if db.exists():
            shutil.copy2(db, keep)
            for ext in ("-wal", "-shm"):
                Path(str(db) + ext).unlink(missing_ok=True)
        shutil.copy2(src, db)
        self.stdout.write(self.style.SUCCESS(f"Restored. The previous database was kept as {keep}. Start the app and check the last bill and stock."))
