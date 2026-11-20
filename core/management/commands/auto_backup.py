from django.core.management.base import BaseCommand, CommandError

from core.backup import auto_backup


class Command(BaseCommand):
    help = "Make a checked automatic backup (kept per Settings → Backups → keep) – used by the nightly server timer."

    def handle(self, *args, **opts):
        path = auto_backup("nightly")
        if path is None:
            raise CommandError("Backup failed – see the audit log.")
        self.stdout.write(self.style.SUCCESS(f"Backup saved and checked: {path}"))
