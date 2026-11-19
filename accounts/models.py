from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.models import AbstractUser
from django.db import models

from .roles import CASHIER, ROLE_CHOICES, perms_for


class User(AbstractUser):
    role = models.CharField(max_length=12, choices=ROLE_CHOICES, default=CASHIER)
    name_ta = models.CharField("Name in Tamil", max_length=60, blank=True)
    phone = models.CharField(max_length=15, blank=True)
    approval_pin = models.CharField(max_length=128, blank=True, help_text="Hashed 4-6 digit PIN used to approve actions at the counter.")

    def can(self, perm):
        return perm in perms_for(self)

    def set_pin(self, pin):
        pin = str(pin or "").strip()
        if not (pin.isdigit() and 4 <= len(pin) <= 6):
            raise ValueError("PIN must be 4 to 6 digits.")
        self.approval_pin = make_password(pin)

    def check_pin(self, pin):
        return bool(self.approval_pin) and check_password(str(pin or ""), self.approval_pin)

    @property
    def display(self):
        return self.get_full_name() or self.username
