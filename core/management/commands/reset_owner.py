"""Forgotten owner password? Set a new password and PIN for the owner (creates the owner if there is none).
Typing is VISIBLE on purpose: hidden typing confused people at the counter. Run on the shop PC only."""
from django.core.management.base import BaseCommand, CommandError

from accounts.models import User


class Command(BaseCommand):
    help = "Set a new password and approval PIN for the owner login (visible typing)."

    def add_arguments(self, parser):
        parser.add_argument("--username")
        parser.add_argument("--password")
        parser.add_argument("--pin")

    def handle(self, *args, username=None, password=None, pin=None, **opts):
        owners = list(User.objects.filter(role="owner").order_by("id"))
        if not username:
            default = owners[0].username if owners else "owner"
            self.stdout.write(f"Owner logins: {', '.join(u.username for u in owners) or 'none yet'}")
            username = input(f"User name to reset [{default}]: ").strip() or default
        user = User.objects.filter(username__iexact=username).first()
        if user is None:
            user = User(username=username, role="owner", is_staff=True, is_superuser=True)
            self.stdout.write(f"No login called '{username}' yet – it will be created as the owner.")
        while not password or len(password) < 6:
            password = input("New password (at least 6 characters, you can see it): ").strip()
            if len(password) < 6:
                self.stdout.write("  Too short – try again.")
        while not (pin and pin.isdigit() and 4 <= len(pin) <= 6):
            pin = input("New approval PIN (4 to 6 digits): ").strip()
            if not (pin.isdigit() and 4 <= len(pin) <= 6):
                self.stdout.write("  The PIN must be 4 to 6 digits – try again.")
        user.set_password(password)
        user.set_pin(pin)
        user.is_active = True
        user.save()
        try:
            from accounts import throttle
            throttle.clear("login", f"{user.username.lower()}|127.0.0.1")
        except Exception:  # noqa: BLE001
            pass
        from core.models import audit
        audit("password_reset", f"Password and PIN reset for {user.username} on the shop PC")
        self.stdout.write(self.style.SUCCESS(f"\nDone. Log in with user name: {user.username}   password: (what you typed)   PIN: {pin}"))
        self.stdout.write("Write them down and keep them safe. Change them later in Settings -> Staff if you like.")
