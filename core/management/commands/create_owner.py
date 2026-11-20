import getpass

from django.core.management.base import BaseCommand, CommandError

from accounts.models import User


class Command(BaseCommand):
    help = "Create the first owner account (user name, password and approval PIN)."

    def add_arguments(self, parser):
        parser.add_argument("--username")
        parser.add_argument("--password")
        parser.add_argument("--pin")

    def handle(self, *args, username=None, password=None, pin=None, **opts):
        username = username or input("Owner user name: ").strip()
        if not username:
            raise CommandError("User name is required.")
        if User.objects.filter(username=username).exists():
            raise CommandError("That user already exists.")
        password = password or getpass.getpass("Password (at least 6 characters): ")
        if len(password) < 6:
            raise CommandError("Password too short.")
        pin = pin or getpass.getpass("Approval PIN (4-6 digits): ")
        u = User(username=username, role="owner", is_staff=True, is_superuser=True)
        u.set_password(password)
        u.set_pin(pin)
        u.save()
        self.stdout.write(self.style.SUCCESS(f"Owner '{username}' created. Start the shop with Start_Store.bat."))
