"""Find the Google Drive for desktop folder and set it as the second backup place, then make and check a first backup."""
from pathlib import Path

from django.core.management.base import BaseCommand

from core.backup import DRIVE_SUBFOLDER, auto_backup, detect_google_drive, health
from core.models import StoreSettings, audit


class Command(BaseCommand):
    help = "Set Google Drive as the second backup place (auto-detected, or --folder) and run a first double backup."

    def add_arguments(self, parser):
        parser.add_argument("--folder", help="Use this folder instead of auto-detecting Google Drive")
        parser.add_argument("--quiet", action="store_true")

    def handle(self, *args, folder=None, quiet=False, **opts):
        cfg = StoreSettings.load()
        found = Path(folder) if folder else detect_google_drive()
        if found and found.is_dir():
            if str(found) != cfg.backup_extra_dir:
                cfg.backup_extra_dir = str(found)
                cfg.save()
                audit("settings", f"Google Drive backup folder set to {found}")
            self.stdout.write(self.style.SUCCESS(f"Google Drive folder: {found}  → backups go to '{DRIVE_SUBFOLDER}'"))
        elif cfg.backup_extra_dir:
            self.stdout.write(self.style.WARNING(f"Google Drive not found now; keeping the saved folder {cfg.backup_extra_dir}"))
        else:
            self.stdout.write(self.style.WARNING(
                "Google Drive for desktop was not found. Install it (https://www.google.com/drive/download/), sign in with the "
                "shop's Google account, then run Setup_Backups.bat again. System backups on this PC still work."))
        auto_backup("setup")
        for h in health():
            style = self.style.SUCCESS if h["ok"] else self.style.WARNING
            self.stdout.write(style(f"{h['label']}: {'OK ' + h['file'] if h['ok'] else 'NOT OK – ' + h['msg']}"))
