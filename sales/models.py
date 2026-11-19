from decimal import Decimal

from django.conf import settings
from django.db import models

from inventory.models import Product


class Sale(models.Model):
    PAYMENT_CHOICES = [("cash", "Cash"), ("upi", "UPI"), ("card", "Card")]
    STATUS_COMPLETED = "completed"
    STATUS_VOID = "void"
    STATUS_CHOICES = [(STATUS_COMPLETED, "Completed"), (STATUS_VOID, "Void")]

    bill_no = models.CharField(max_length=20, unique=True, editable=False)
    customer_name = models.CharField(max_length=80, blank=True)
    customer_phone = models.CharField(max_length=15, blank=True)
    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    discount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    payment_method = models.CharField(max_length=10, choices=PAYMENT_CHOICES, default="cash")
    amount_received = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=STATUS_COMPLETED)
    cashier = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="sales")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return self.bill_no

    @property
    def change_due(self):
        return max(self.amount_received - self.total, Decimal("0"))

    @property
    def profit(self):
        return sum((i.line_total - i.quantity * i.unit_cost for i in self.items.all()), Decimal("0")) - self.discount


class SaleItem(models.Model):
    sale = models.ForeignKey(Sale, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="sale_items")
    product_name = models.CharField(max_length=80)
    unit = models.CharField(max_length=10)
    quantity = models.DecimalField(max_digits=12, decimal_places=3)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    unit_cost = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    line_total = models.DecimalField(max_digits=12, decimal_places=2)

    def __str__(self):
        return f"{self.product_name} × {self.quantity}"
