import json

from django.core.management.base import BaseCommand

from core.backup import list_backups, make_backup, verify_backup


class Command(BaseCommand):
    help = "Check a backup file (opened read-only, separately from the live database). With no file, makes a fresh backup and checks it."

    def add_arguments(self, parser):
        parser.add_argument("file", nargs="?")
        parser.add_argument("--latest", action="store_true", help="Check the newest backup on this PC")

    def handle(self, *args, file=None, latest=False, **opts):
        if latest and list_backups():
            file = list_backups()[0]
        path = file or make_backup(label="check")
        self.stdout.write(json.dumps(verify_backup(path), indent=2, default=str))
