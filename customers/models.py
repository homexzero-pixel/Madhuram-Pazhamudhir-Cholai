from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import Sum
from django.utils import timezone


class Customer(models.Model):
    name = models.CharField(max_length=100)
    name_ta = models.CharField("Name in Tamil", max_length=100, blank=True)
    phone = models.CharField(max_length=15, unique=True, null=True, blank=True)
    address = models.CharField(max_length=250, blank=True)
    gstin = models.CharField("GSTIN (business customer)", max_length=15, blank=True)
    loyalty_enabled = models.BooleanField(default=True)
    credit_allowed = models.BooleanField(default=False)
    credit_limit = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    credit_approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    created_at = models.DateTimeField(default=timezone.now)
    notes = models.CharField(max_length=250, blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.phone})" if self.phone else self.name

    @property
    def points(self):
        return self.loyalty.aggregate(s=Sum("points"))["s"] or Decimal(0)

    @property
    def credit_balance(self):
        """Amount the customer owes the store."""
        return self.credit_entries.aggregate(s=Sum("amount"))["s"] or Decimal(0)


class LoyaltyEntry(models.Model):
    customer = models.ForeignKey(Customer, on_delete=models.PROTECT, related_name="loyalty")
    at = models.DateTimeField(default=timezone.now)
    points = models.DecimalField(max_digits=10, decimal_places=2, help_text="+ earned, − redeemed or reversed")
    kind = models.CharField(max_length=10, choices=[("earn", "Earned"), ("redeem", "Redeemed"), ("reverse", "Reversed on return"), ("adjust", "Adjusted")])
    sale = models.ForeignKey("sales.Sale", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    sale_return = models.ForeignKey("sales.SaleReturn", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    note = models.CharField(max_length=120, blank=True)


class CreditEntry(models.Model):
    """Customer credit ledger. + = customer owes more (credit sale), − = paid or credited."""

    customer = models.ForeignKey(Customer, on_delete=models.PROTECT, related_name="credit_entries")
    at = models.DateTimeField(default=timezone.now)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    kind = models.CharField(max_length=10, choices=[("sale", "Credit sale"), ("payment", "Payment received"), ("return", "Return credited"), ("adjust", "Adjustment")])
    method = models.CharField(max_length=6, blank=True, help_text="How a payment was received")
    sale = models.ForeignKey("sales.Sale", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    sale_return = models.ForeignKey("sales.SaleReturn", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    shift = models.ForeignKey("sales.Shift", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    reference = models.CharField(max_length=60, blank=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+")

    class Meta:
        ordering = ["-at", "-id"]


class Offer(models.Model):
    """A promotion. Lower priority number is tried first; each bill line gets at most one offer."""

    PERCENT, AMOUNT, QTY, COMBO = "percent", "amount", "qty", "combo"
    KINDS = [
        (PERCENT, "% off"),
        (AMOUNT, "₹ off per unit"),
        (QTY, "Quantity deal (buy N, pay a set price per unit or get % off)"),
        (COMBO, "Combo (buy these items together, ₹ off the set)"),
    ]
    name = models.CharField(max_length=100)
    kind = models.CharField(max_length=8, choices=KINDS)
    priority = models.PositiveSmallIntegerField(default=10)
    is_active = models.BooleanField(default=True)
    starts_on = models.DateField()
    ends_on = models.DateField()
    items = models.ManyToManyField("catalog.Item", blank=True, related_name="offers")
    categories = models.ManyToManyField("catalog.Category", blank=True, related_name="offers")
    percent = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True, help_text="₹ off per unit, or ₹ off the combo set")
    min_qty = models.DecimalField(max_digits=10, decimal_places=3, null=True, blank=True, help_text="Quantity deal: minimum quantity")
    deal_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True, help_text="Quantity deal: price per unit when min qty reached")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")

    class Meta:
        ordering = ["priority", "id"]

    def __str__(self):
        return self.name

    def live(self, on):
        return self.is_active and self.starts_on <= on <= self.ends_on
