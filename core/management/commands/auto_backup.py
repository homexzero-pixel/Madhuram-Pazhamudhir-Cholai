from django.core.management.base import BaseCommand, CommandError

from core.backup import auto_backup


class Command(BaseCommand):
    help = "Make a checked automatic backup on this PC plus a verified Google Drive copy (used by the nightly scheduled task)."

    def add_arguments(self, parser):
        parser.add_argument("--label", default="nightly")

    def handle(self, *args, label, **opts):
        from core.backup import health

        path = auto_backup(label)
        if path is None:
            raise CommandError("Backup failed – see the audit log.")
        self.stdout.write(self.style.SUCCESS(f"System backup saved and checked: {path}"))
        for h in health():
            if h["key"] == "drive":
                if h["ok"]:
                    self.stdout.write(self.style.SUCCESS(f"Google Drive copy verified: {h['file']}"))
                else:
                    self.stdout.write(self.style.WARNING(f"Google Drive backup NOT done: {h['msg']}"))
