from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import Sum
from django.utils import timezone

from catalog.models import Item


class Supplier(models.Model):
    name = models.CharField(max_length=120, unique=True)
    phone = models.CharField(max_length=30, blank=True)
    gstin = models.CharField("GSTIN", max_length=15, blank=True)
    address = models.CharField(max_length=250, blank=True)
    payment_terms_days = models.PositiveSmallIntegerField(default=0)
    opening_balance = models.DecimalField(max_digits=12, decimal_places=2, default=0, help_text="Amount owed to the supplier when you started using this system.")
    is_active = models.BooleanField(default=True)
    notes = models.CharField(max_length=250, blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    def outstanding(self):
        billed = GoodsReceipt.objects.filter(supplier=self).aggregate(s=Sum("invoice_total"))["s"] or Decimal(0)
        returned = PurchaseReturn.objects.filter(supplier=self).aggregate(s=Sum("total"))["s"] or Decimal(0)
        paid = SupplierPayment.objects.filter(supplier=self).aggregate(s=Sum("amount"))["s"] or Decimal(0)
        return self.opening_balance + billed - returned - paid


class PurchaseOrder(models.Model):
    DRAFT, ORDERED, PARTIAL, RECEIVED, CLOSED = "draft", "ordered", "partial", "received", "closed"
    STATUS = [(DRAFT, "Draft"), (ORDERED, "Ordered"), (PARTIAL, "Partly received"), (RECEIVED, "Fully received"), (CLOSED, "Closed short")]
    number = models.CharField(max_length=20, unique=True)
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="orders")
    ordered_on = models.DateField(default=timezone.localdate)
    expected_on = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=STATUS, default=ORDERED)
    notes = models.CharField(max_length=250, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")

    class Meta:
        ordering = ["-id"]

    def __str__(self):
        return self.number

    def refresh_status(self):
        lines = list(self.lines.all())
        if self.status == self.CLOSED:
            return
        got = [l.received_qty for l in lines]
        if lines and all(l.received_qty >= l.qty for l in lines):
            self.status = self.RECEIVED
        elif any(g > 0 for g in got):
            self.status = self.PARTIAL
        self.save(update_fields=["status"])

    @property
    def total(self):
        return sum((l.qty * l.unit_cost for l in self.lines.all()), Decimal(0))


class POLine(models.Model):
    order = models.ForeignKey(PurchaseOrder, on_delete=models.CASCADE, related_name="lines")
    item = models.ForeignKey(Item, on_delete=models.PROTECT)
    qty = models.DecimalField("Qty (purchase units)", max_digits=12, decimal_places=3)
    unit_cost = models.DecimalField("Cost per purchase unit", max_digits=12, decimal_places=2)
    received_qty = models.DecimalField(max_digits=12, decimal_places=3, default=0)

    @property
    def outstanding(self):
        return max(self.qty - self.received_qty, Decimal(0))

    @property
    def value(self):
        return (self.qty * self.unit_cost).quantize(Decimal("0.01"))


class GoodsReceipt(models.Model):
    """GRN: what physically arrived, against a supplier invoice."""

    number = models.CharField(max_length=20, unique=True)
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="receipts")
    order = models.ForeignKey(PurchaseOrder, null=True, blank=True, on_delete=models.PROTECT, related_name="receipts")
    invoice_no = models.CharField("Supplier invoice no.", max_length=40)
    invoice_date = models.DateField()
    invoice_total = models.DecimalField("Invoice total (₹)", max_digits=12, decimal_places=2)
    received_at = models.DateTimeField(default=timezone.now)
    received_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    notes = models.CharField(max_length=250, blank=True)

    class Meta:
        ordering = ["-id"]
        constraints = [models.UniqueConstraint(fields=["supplier", "invoice_no"], name="one_grn_per_supplier_invoice")]

    def __str__(self):
        return self.number

    @property
    def lines_total(self):
        return sum((l.line_cost for l in self.lines.all()), Decimal(0))

    @property
    def invoice_difference(self):
        return self.invoice_total - self.lines_total


class GRNLine(models.Model):
    grn = models.ForeignKey(GoodsReceipt, on_delete=models.CASCADE, related_name="lines")
    po_line = models.ForeignKey(POLine, null=True, blank=True, on_delete=models.PROTECT, related_name="grn_lines")
    item = models.ForeignKey(Item, on_delete=models.PROTECT)
    qty = models.DecimalField("Billed qty (purchase units)", max_digits=12, decimal_places=3)
    free_qty = models.DecimalField("Free qty (purchase units)", max_digits=12, decimal_places=3, default=0)
    damaged_qty = models.DecimalField("Damaged on arrival (purchase units)", max_digits=12, decimal_places=3, default=0)
    units_per_purchase = models.DecimalField(max_digits=10, decimal_places=3, default=1)
    unit_cost = models.DecimalField("Cost per purchase unit (₹)", max_digits=12, decimal_places=2)
    batch = models.CharField(max_length=40, blank=True)
    expiry = models.DateField(null=True, blank=True)

    @property
    def line_cost(self):
        return (self.qty * self.unit_cost).quantize(Decimal("0.01"))

    @property
    def stock_qty(self):
        """Sale units added to sellable stock."""
        return (self.qty + self.free_qty - self.damaged_qty) * self.units_per_purchase


class PurchaseReturn(models.Model):
    number = models.CharField(max_length=20, unique=True)
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="returns")
    grn = models.ForeignKey(GoodsReceipt, null=True, blank=True, on_delete=models.PROTECT, related_name="returns")
    created_at = models.DateTimeField(default=timezone.now)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    reason = models.CharField(max_length=200)
    total = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    class Meta:
        ordering = ["-id"]


class PurchaseReturnLine(models.Model):
    ret = models.ForeignKey(PurchaseReturn, on_delete=models.CASCADE, related_name="lines")
    lot = models.ForeignKey("inventory.StockLot", on_delete=models.PROTECT)
    qty = models.DecimalField(max_digits=12, decimal_places=3)
    unit_cost = models.DecimalField(max_digits=12, decimal_places=4)
    amount = models.DecimalField(max_digits=12, decimal_places=2)


class SupplierPayment(models.Model):
    METHODS = [("cash", "Cash from drawer"), ("bank", "Bank transfer"), ("upi", "UPI"), ("cheque", "Cheque")]
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="payments")
    paid_on = models.DateField(default=timezone.localdate)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    method = models.CharField(max_length=8, choices=METHODS, default="bank")
    reference = models.CharField(max_length=60, blank=True)
    shift = models.ForeignKey("sales.Shift", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-paid_on", "-id"]
