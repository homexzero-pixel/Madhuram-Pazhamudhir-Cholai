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
        if User.objects.filter(username__iexact=username).exists():
            raise CommandError("That user already exists.")
        if not password:
            self.stdout.write("  (Typing is hidden for the password and PIN – nothing appears on screen. Type it and press Enter.)")
        while not password:
            p1 = getpass.getpass("Password (at least 6 characters, hidden): ")
            if len(p1) < 6:
                self.stdout.write("  Too short – at least 6 characters. Try again.")
                continue
            if getpass.getpass("Type the same password again: ") != p1:
                self.stdout.write("  The two passwords were different. Try again.")
                continue
            password = p1
        if len(password) < 6:
            raise CommandError("Password too short.")
        while not pin:
            p1 = getpass.getpass("Approval PIN (4-6 digits, hidden): ").strip()
            if not (p1.isdigit() and 4 <= len(p1) <= 6):
                self.stdout.write("  The PIN must be 4 to 6 digits. Try again.")
                continue
            if getpass.getpass("Type the same PIN again: ").strip() != p1:
                self.stdout.write("  The two PINs were different. Try again.")
                continue
            pin = p1
        u = User(username=username, role="owner", is_staff=True, is_superuser=True)
        u.set_password(password)
        u.set_pin(pin)
        u.save()
        self.stdout.write(self.style.SUCCESS(f"Owner '{username}' created. Log in with this user name (capital letters do not matter)."))
