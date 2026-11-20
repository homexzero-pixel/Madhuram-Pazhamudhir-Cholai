from django.conf import settings
from django.db import models
from django.utils import timezone


class ExpenseCategory(models.Model):
    name = models.CharField(max_length=60, unique=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "expense categories"

    def __str__(self):
        return self.name


class Expense(models.Model):
    METHODS = [("cash", "Cash from drawer"), ("bank", "Bank"), ("upi", "UPI"), ("card", "Card")]
    spent_on = models.DateField(default=timezone.localdate, db_index=True)
    category = models.ForeignKey(ExpenseCategory, on_delete=models.PROTECT, related_name="expenses")
    description = models.CharField(max_length=200)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    method = models.CharField(max_length=5, choices=METHODS, default="cash")
    reference = models.CharField("Voucher / bill no.", max_length=60, blank=True)
    shift = models.ForeignKey("sales.Shift", null=True, blank=True, on_delete=models.PROTECT, related_name="expenses")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-spent_on", "-id"]

    def __str__(self):
        return self.description
