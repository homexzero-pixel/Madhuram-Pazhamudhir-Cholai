"""Start the store system on this PC: migrate, daily backup, then serve on http://127.0.0.1:8765/."""
import os
import threading
import webbrowser
from datetime import date

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Run the Madhuram store system (offline, this PC only by default)."

    def add_arguments(self, parser):
        parser.add_argument("--host", default="127.0.0.1")
        parser.add_argument("--port", type=int, default=8765)
        parser.add_argument("--no-browser", action="store_true")

    def handle(self, *args, host, port, no_browser, **opts):
        from catalog.models import Item
        from core.backup import auto_backup
        from core.models import StoreSettings

        call_command("migrate", interactive=False, verbosity=0)
        call_command("collectstatic", interactive=False, verbosity=0)
        if not Item.objects.exists():
            self.stdout.write("Loading the 20,000-SKU starter catalogue (inactive candidates)…")
            call_command("load_catalogue")
        from django.db import connection

        with connection.cursor() as c:  # quick health check and planner statistics at every start
            ok = c.execute("PRAGMA quick_check").fetchone()[0]
            c.execute("PRAGMA optimize")
            c.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        if ok != "ok":
            self.stdout.write(self.style.ERROR(f"DATABASE PROBLEM: {ok}. Stop and restore the latest backup (docs/BACKUP_RESTORE.md)."))
        marker = settings.DATA_DIR / "last_auto_backup.txt"
        today = date.today().isoformat()
        if not marker.exists() or marker.read_text().strip() != today:
            if auto_backup("daily"):
                marker.write_text(today)
        StoreSettings.load()
        from accounts.models import User

        if not User.objects.filter(is_active=True).exists():
            self.stdout.write(self.style.WARNING("No staff accounts yet. Close this window and run Create_Owner.bat first."))
        threading.Thread(target=_hourly_backups, daemon=True, name="hourly-backup").start()
        url = f"http://{'127.0.0.1' if host in ('0.0.0.0', '') else host}:{port}/"
        self.stdout.write(self.style.SUCCESS(f"Madhuram {settings.MODE.upper()} is running at {url}  (database: {settings.DB_FILE})"))
        self.stdout.write("Keep this window open while the shop is billing. Press Ctrl+C to stop.")
        if not no_browser:
            threading.Timer(1.5, lambda: webbrowser.open(url + "billing/")).start()
        from waitress import serve

        from cholai.wsgi import application

        extra = {}
        if os.environ.get("MPC_HTTPS") == "1":
            # Online hosting: trust only the local nginx in front of us for the client IP and https scheme.
            extra = {"trusted_proxy": "127.0.0.1", "trusted_proxy_headers": {"x-forwarded-for", "x-forwarded-proto"},
                     "trusted_proxy_count": 1}
        serve(application, host=host, port=port, threads=8, channel_timeout=120, **extra)


def _change_mark():
    """Changes when anything is saved: every sale, receipt, price change and stock move is audited or ledgered."""
    from django.db.models import Max

    from core.models import AuditLog
    from inventory.models import StockMove

    return f"{AuditLog.objects.aggregate(m=Max('id'))['m']}-{StockMove.objects.aggregate(m=Max('id'))['m']}"


def _hourly_backups():
    """Every hour, if anything changed since the last automatic backup, back up on this PC (Drive gets the start-up,
    shift-close and nightly copies)."""
    import time

    from django.db import close_old_connections

    from core.backup import auto_backup

    try:
        last = _change_mark()  # the start-up backup covers the data as it is now
    except Exception:  # noqa: BLE001
        last = None
    finally:
        close_old_connections()
    while True:
        time.sleep(3600)
        try:
            close_old_connections()
            mark = _change_mark()
            if mark != last and auto_backup("hourly", drive=False):
                last = mark
        except Exception:  # noqa: BLE001 – never stop the server
            pass
        finally:
            close_old_connections()
