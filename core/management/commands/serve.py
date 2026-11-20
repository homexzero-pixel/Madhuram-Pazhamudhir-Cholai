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
        marker = settings.DATA_DIR / "last_auto_backup.txt"
        today = date.today().isoformat()
        if not marker.exists() or marker.read_text().strip() != today:
            if auto_backup("daily"):
                marker.write_text(today)
        StoreSettings.load()
        from accounts.models import User

        if not User.objects.filter(is_active=True).exists():
            self.stdout.write(self.style.WARNING("No staff accounts yet. Close this window and run Create_Owner.bat first."))
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
