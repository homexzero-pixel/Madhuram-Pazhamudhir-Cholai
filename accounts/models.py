from django.contrib.auth.models import AbstractUser
from django.db import models

ROLE_ADMIN = "Admin"
ROLE_MANAGER = "Manager"
ROLE_CASHIER = "Cashier"
DEFAULT_ROLES = {
    ROLE_ADMIN: "Full access: staff, store settings, stock, billing, expenses and reports.",
    ROLE_MANAGER: "Manages products, purchases, expenses and views reports.",
    ROLE_CASHIER: "Runs the billing counter (POS) and sees own sales.",
}


class User(AbstractUser):
    phone = models.CharField(max_length=15, blank=True)

    @property
    def role(self):
        if self.is_superuser:
            return ROLE_ADMIN
        group = self.groups.first()
        return group.name if group else ""

    def has_role(self, *roles):
        return self.is_superuser or self.groups.filter(name__in=roles).exists()


class RoleProfile(models.Model):
    """Extra info attached to an auth Group, which acts as a role."""

    group = models.OneToOneField("auth.Group", on_delete=models.CASCADE, related_name="profile")
    description = models.CharField(max_length=200, blank=True)

    def __str__(self):
        return self.group.name
