from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models

POSITIVE = [MinValueValidator(Decimal("0.001"))]
NON_NEGATIVE = [MinValueValidator(Decimal("0"))]


class Category(models.Model):
    name = models.CharField(max_length=60, unique=True)
    description = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "categories"

    def __str__(self):
        return self.name


class Product(models.Model):
    UNIT_CHOICES = [
        ("kg", "Kilogram"),
        ("g", "Gram"),
        ("pc", "Piece"),
        ("dozen", "Dozen"),
        ("bunch", "Bunch"),
        ("box", "Box"),
        ("ltr", "Litre"),
        ("pkt", "Packet"),
    ]

    name = models.CharField(max_length=80, unique=True)
    tamil_name = models.CharField(max_length=80, blank=True)
    code = models.CharField("item code", max_length=20, unique=True, blank=True, null=True)
    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="products")
    unit = models.CharField(max_length=10, choices=UNIT_CHOICES, default="kg")
    cost_price = models.DecimalField(max_digits=10, decimal_places=2, default=0, validators=NON_NEGATIVE)
    selling_price = models.DecimalField(max_digits=10, decimal_places=2, validators=NON_NEGATIVE)
    stock = models.DecimalField(max_digits=12, decimal_places=3, default=0)
    reorder_level = models.DecimalField(max_digits=12, decimal_places=3, default=5, validators=NON_NEGATIVE)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    @property
    def is_low_stock(self):
        return self.stock <= self.reorder_level

    @property
    def stock_value(self):
        return (self.stock * self.cost_price).quantize(Decimal("0.01"))

    def as_dict(self):
        return {
            "id": self.pk,
            "name": self.name,
            "tamil_name": self.tamil_name,
            "code": self.code,
            "category": self.category.name,
            "unit": self.unit,
            "selling_price": str(self.selling_price),
            "stock": str(self.stock),
            "low_stock": self.is_low_stock,
        }


class Supplier(models.Model):
    name = models.CharField(max_length=100, unique=True)
    phone = models.CharField(max_length=20, blank=True)
    address = models.CharField(max_length=200, blank=True)
    notes = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Purchase(models.Model):
    """Stock received from a supplier. Saving adds to the product's stock."""

    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="purchases")
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="purchases", null=True, blank=True)
    quantity = models.DecimalField(max_digits=12, decimal_places=3, validators=POSITIVE)
    unit_cost = models.DecimalField(max_digits=10, decimal_places=2, validators=NON_NEGATIVE)
    total_cost = models.DecimalField(max_digits=12, decimal_places=2, editable=False)
    invoice_no = models.CharField(max_length=40, blank=True)
    purchased_on = models.DateField()
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="purchases")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-purchased_on", "-id"]

    def __str__(self):
        return f"{self.product} × {self.quantity}"

    def save(self, *args, **kwargs):
        self.total_cost = (self.quantity * self.unit_cost).quantize(Decimal("0.01"))
        super().save(*args, **kwargs)
