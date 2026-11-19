import uuid
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import Q, Sum
from django.utils import timezone

from catalog.models import Item

TENDERS = [("cash", "Cash"), ("upi", "UPI"), ("card", "Card"), ("credit", "Customer credit")]
REFUND_METHODS = [("cash", "Cash"), ("upi", "UPI"), ("card", "Card"), ("credit", "Credit to customer account")]


class Shift(models.Model):
    OPEN, CLOSED = "open", "closed"
    counter = models.CharField(max_length=20, default="Counter 1")
    cashier = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="shifts")
    business_date = models.DateField(default=timezone.localdate, db_index=True)
    opened_at = models.DateTimeField(default=timezone.now)
    opening_float = models.DecimalField(max_digits=12, decimal_places=2)
    status = models.CharField(max_length=6, choices=[(OPEN, "Open"), (CLOSED, "Closed")], default=OPEN)
    closed_at = models.DateTimeField(null=True, blank=True)
    closed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    counted = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    expected = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    variance = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    denominations = models.JSONField(default=dict, blank=True)
    retained_cash = models.DecimalField("Cash left in drawer for next shift", max_digits=12, decimal_places=2, null=True, blank=True)
    close_note = models.CharField(max_length=200, blank=True)
    reopen_count = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["-id"]
        constraints = [models.UniqueConstraint(fields=["counter"], condition=Q(status="open"), name="one_open_shift_per_counter")]

    def __str__(self):
        return f"Shift {self.pk} · {self.cashier} · {self.business_date:%d-%m-%Y}"


class CashMovement(models.Model):
    """Cash put into or taken out of the drawer other than sales, refunds and expenses."""

    KINDS = [("pay_in", "Cash paid in"), ("pay_out", "Cash paid out"), ("bank_deposit", "Removed for bank deposit")]
    shift = models.ForeignKey(Shift, on_delete=models.PROTECT, related_name="cash_moves")
    at = models.DateTimeField(default=timezone.now)
    kind = models.CharField(max_length=12, choices=KINDS)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    reason = models.CharField(max_length=200)
    reference = models.CharField(max_length=60, blank=True, help_text="Bank deposit slip no. etc.")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")

    @property
    def signed(self):
        return self.amount if self.kind == "pay_in" else -self.amount


class DraftBill(models.Model):
    """The bill on the counter before payment. Survives a browser refresh or power cut.

    Its uuid is the idempotency key: a draft can become at most one Sale.
    """

    OPEN, HELD, DONE, CANCELLED = "open", "held", "done", "cancelled"
    uuid = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    cashier = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="drafts")
    status = models.CharField(max_length=10, default=OPEN, db_index=True)
    label = models.CharField(max_length=60, blank=True)
    customer = models.ForeignKey("customers.Customer", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    cancel_reason = models.CharField(max_length=200, blank=True)
    cancelled_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+")

    class Meta:
        ordering = ["-updated_at"]


class DraftLine(models.Model):
    draft = models.ForeignKey(DraftBill, on_delete=models.CASCADE, related_name="lines")
    item = models.ForeignKey(Item, on_delete=models.PROTECT)
    qty = models.DecimalField(max_digits=12, decimal_places=3)
    source = models.CharField(max_length=10, default="scan")  # scan / search / plu / scale
    scan_code = models.CharField(max_length=40, blank=True)
    price_override = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    override_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    override_reason = models.CharField(max_length=120, blank=True)
    manual_discount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    discount_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    discount_reason = models.CharField(max_length=120, blank=True)
    position = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["position", "id"]


class Sale(models.Model):
    TAX_INVOICE, BILL_OF_SUPPLY, INVOICE_CUM_BOS, CASH_MEMO = "tax", "bos", "inv_bos", "memo"
    DOC_TYPES = [
        (TAX_INVOICE, "Tax invoice"),
        (BILL_OF_SUPPLY, "Bill of supply"),
        (INVOICE_CUM_BOS, "Invoice-cum-bill of supply"),
        (CASH_MEMO, "Cash memo (store not GST-registered)"),
    ]
    bill_no = models.CharField(max_length=16, unique=True)
    draft_uuid = models.UUIDField(unique=True, help_text="Idempotency key – one draft makes at most one sale.")
    business_date = models.DateField(db_index=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    shift = models.ForeignKey(Shift, on_delete=models.PROTECT, related_name="sales")
    cashier = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="sales")
    customer = models.ForeignKey("customers.Customer", null=True, blank=True, on_delete=models.PROTECT, related_name="sales")
    gross = models.DecimalField(max_digits=12, decimal_places=2)
    discount = models.DecimalField(max_digits=12, decimal_places=2)
    total = models.DecimalField(max_digits=12, decimal_places=2)
    doc_type = models.CharField(max_length=8, choices=DOC_TYPES)
    identity = models.JSONField(default=dict, help_text="Store name, address and GSTIN as printed at the time of sale.")
    points_earned = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    print_count = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-id"]

    def __str__(self):
        return self.bill_no

    @property
    def paid(self):
        return self.payments.aggregate(s=Sum("amount"))["s"] or Decimal(0)

    @property
    def change(self):
        return self.payments.aggregate(s=Sum("change"))["s"] or Decimal(0)

    @property
    def refunded(self):
        return SaleReturn.objects.filter(sale=self).aggregate(s=Sum("total"))["s"] or Decimal(0)


class SaleLine(models.Model):
    sale = models.ForeignKey(Sale, on_delete=models.PROTECT, related_name="lines")
    item = models.ForeignKey(Item, on_delete=models.PROTECT, related_name="sale_lines")
    sku = models.CharField(max_length=20)
    name = models.CharField(max_length=160)
    name_ta = models.CharField(max_length=160, blank=True)
    category = models.CharField(max_length=60)
    department = models.CharField(max_length=60)
    unit = models.CharField(max_length=4)
    qty = models.DecimalField(max_digits=12, decimal_places=3)
    list_price = models.DecimalField(max_digits=10, decimal_places=2, help_text="Catalogue price at sale time")
    rate = models.DecimalField(max_digits=10, decimal_places=2, help_text="Price charged per unit (after any override)")
    mrp = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    gross = models.DecimalField(max_digits=12, decimal_places=2)
    discount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    offer = models.ForeignKey("customers.Offer", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    discount_note = models.CharField(max_length=160, blank=True)
    net = models.DecimalField(max_digits=12, decimal_places=2)
    tax_class = models.CharField(max_length=8)
    hsn = models.CharField(max_length=8, blank=True)
    gst_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    taxable = models.DecimalField(max_digits=12, decimal_places=2)
    cgst = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    sgst = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    cost = models.DecimalField("Cost of goods", max_digits=12, decimal_places=2)
    returned_qty = models.DecimalField(max_digits=12, decimal_places=3, default=0)
    override_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+")

    class Meta:
        ordering = ["id"]
        constraints = [models.CheckConstraint(condition=Q(returned_qty__lte=models.F("qty")), name="cannot_return_more_than_sold")]

    @property
    def returnable_qty(self):
        return self.qty - self.returned_qty


class SaleLineLot(models.Model):
    line = models.ForeignKey(SaleLine, on_delete=models.PROTECT, related_name="lots")
    lot = models.ForeignKey("inventory.StockLot", on_delete=models.PROTECT, related_name="+")
    qty = models.DecimalField(max_digits=12, decimal_places=3)
    unit_cost = models.DecimalField(max_digits=12, decimal_places=4)
    returned_qty = models.DecimalField(max_digits=12, decimal_places=3, default=0)


class Settlement(models.Model):
    """Money actually credited to the bank for UPI or card payments."""

    method = models.CharField(max_length=6, choices=[("upi", "UPI"), ("card", "Card")])
    provider = models.CharField(max_length=60, blank=True)
    settled_on = models.DateField()
    expected = models.DecimalField("Payments matched", max_digits=12, decimal_places=2, default=0)
    fees = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    credited = models.DecimalField("Amount credited to bank", max_digits=12, decimal_places=2)
    bank_reference = models.CharField(max_length=60, blank=True)
    notes = models.CharField(max_length=200, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-settled_on", "-id"]

    @property
    def difference(self):
        """Unexplained difference after fees. Zero means fully reconciled."""
        return self.credited + self.fees - self.expected


class Payment(models.Model):
    sale = models.ForeignKey(Sale, on_delete=models.PROTECT, related_name="payments")
    method = models.CharField(max_length=6, choices=TENDERS)
    amount = models.DecimalField("Applied to bill", max_digits=12, decimal_places=2)
    tendered = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    change = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    reference = models.CharField(max_length=60, blank=True, help_text="UPI transaction ID / card approval code")
    settlement = models.ForeignKey(Settlement, null=True, blank=True, on_delete=models.SET_NULL, related_name="payments")


class SaleReturn(models.Model):
    """Customer return / credit note."""

    number = models.CharField(max_length=16, unique=True)
    sale = models.ForeignKey(Sale, on_delete=models.PROTECT, related_name="returns")
    business_date = models.DateField(db_index=True)
    created_at = models.DateTimeField(default=timezone.now)
    shift = models.ForeignKey(Shift, null=True, blank=True, on_delete=models.PROTECT, related_name="returns")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    reason = models.CharField(max_length=200)
    method = models.CharField(max_length=6, choices=REFUND_METHODS)
    reference = models.CharField(max_length=60, blank=True)
    total = models.DecimalField(max_digits=12, decimal_places=2)
    points_reversed = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    idempotency_key = models.UUIDField(unique=True, null=True, blank=True)
    settlement = models.ForeignKey(Settlement, null=True, blank=True, on_delete=models.SET_NULL, related_name="refunds")

    class Meta:
        ordering = ["-id"]


class ReturnLine(models.Model):
    DISPOSITIONS = [("sellable", "Back to sellable stock"), ("quarantine", "Quarantine (check before selling)"), ("waste", "Waste")]
    ret = models.ForeignKey(SaleReturn, on_delete=models.PROTECT, related_name="lines")
    sale_line = models.ForeignKey(SaleLine, on_delete=models.PROTECT, related_name="return_lines")
    qty = models.DecimalField(max_digits=12, decimal_places=3)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    discount = models.DecimalField(max_digits=12, decimal_places=2, default=0, help_text="Share of the original discount reversed")
    taxable = models.DecimalField(max_digits=12, decimal_places=2)
    cgst = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    sgst = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    cost = models.DecimalField(max_digits=12, decimal_places=2)
    disposition = models.CharField(max_length=10, choices=DISPOSITIONS)
