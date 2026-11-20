from django.conf import settings
from django.db import models
from django.utils import timezone

from catalog.models import Item


class StockLot(models.Model):
    """One delivery (or opening count) of one item. Each lot keeps its own batch, expiry and cost."""

    SELLABLE, QUARANTINE = "sellable", "quarantine"
    STATUS = [(SELLABLE, "Sellable"), (QUARANTINE, "Quarantine (not for sale)")]

    item = models.ForeignKey(Item, on_delete=models.PROTECT, related_name="lots")
    batch = models.CharField(max_length=40, blank=True)
    expiry = models.DateField(null=True, blank=True, db_index=True)
    received_qty = models.DecimalField(max_digits=12, decimal_places=3)
    qty = models.DecimalField("On hand", max_digits=12, decimal_places=3)
    unit_cost = models.DecimalField(max_digits=12, decimal_places=4, help_text="Actual cost per sale unit, after free goods.")
    status = models.CharField(max_length=10, choices=STATUS, default=SELLABLE)
    received_at = models.DateTimeField(default=timezone.now)
    source = models.CharField(max_length=60, blank=True, help_text="GRN / opening / return reference")
    supplier = models.ForeignKey("purchasing.Supplier", null=True, blank=True, on_delete=models.PROTECT, related_name="lots")
    grn_line = models.ForeignKey("purchasing.GRNLine", null=True, blank=True, on_delete=models.PROTECT, related_name="lots")
    origin = models.ForeignKey("self", null=True, blank=True, on_delete=models.PROTECT, related_name="+")

    class Meta:
        ordering = ["item_id", "expiry", "id"]
        indexes = [models.Index(fields=["item", "status", "expiry"])]
        constraints = [models.CheckConstraint(condition=models.Q(qty__gte=0), name="lot_qty_not_negative")]

    def __str__(self):
        return f"Lot {self.pk} {self.item.sku} {self.batch}"

    def is_expired(self, on=None):
        return self.expiry is not None and self.expiry < (on or timezone.localdate())


class StockMove(models.Model):
    """Append-only stock ledger. Every change to a lot is one row here."""

    KINDS = [
        ("opening", "Opening stock"),
        ("purchase", "Goods received"),
        ("sale", "Sale"),
        ("return_in", "Customer return"),
        ("purchase_return", "Return to supplier"),
        ("waste", "Wastage"),
        ("damage", "Damage"),
        ("expiry", "Expired write-off"),
        ("adjust", "Stocktake adjustment"),
        ("transfer_out", "Moved out of sellable"),
        ("transfer_in", "Moved into lot"),
    ]
    at = models.DateTimeField(default=timezone.now, db_index=True)
    item = models.ForeignKey(Item, on_delete=models.PROTECT, related_name="moves")
    lot = models.ForeignKey(StockLot, on_delete=models.PROTECT, related_name="moves")
    kind = models.CharField(max_length=16, choices=KINDS, db_index=True)
    qty = models.DecimalField(max_digits=12, decimal_places=3, help_text="+ in, − out")
    unit_cost = models.DecimalField(max_digits=12, decimal_places=4)
    ref = models.CharField(max_length=60, blank=True, db_index=True)
    reason = models.CharField(max_length=200, blank=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+")

    class Meta:
        ordering = ["-at", "-id"]

    @property
    def value(self):
        from core.money import money

        return money(self.qty * self.unit_cost)


class StockCount(models.Model):
    OPEN, APPROVED, CANCELLED = "open", "approved", "cancelled"
    STATUS = [(OPEN, "Counting"), (APPROVED, "Approved"), (CANCELLED, "Cancelled")]
    title = models.CharField(max_length=100)
    created_at = models.DateTimeField(default=timezone.now)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    status = models.CharField(max_length=10, choices=STATUS, default=OPEN)
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    approved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-id"]


class StockCountLine(models.Model):
    count = models.ForeignKey(StockCount, on_delete=models.CASCADE, related_name="lines")
    item = models.ForeignKey(Item, on_delete=models.PROTECT)
    lot = models.ForeignKey(StockLot, on_delete=models.PROTECT, null=True, blank=True)
    expected = models.DecimalField(max_digits=12, decimal_places=3)
    counted = models.DecimalField(max_digits=12, decimal_places=3, null=True, blank=True)
    reason = models.CharField(max_length=120, blank=True)

    @property
    def difference(self):
        return None if self.counted is None else self.counted - self.expected
