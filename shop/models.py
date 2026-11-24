import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


class OnlineOrder(models.Model):
    """An order a customer placed on the online shop. Stock and money move only when it is billed at a counter."""

    NEW, ACCEPTED, READY, OUT, DONE, CANCELLED = "new", "accepted", "ready", "out", "done", "cancelled"
    STATUS = [(NEW, "New – not seen yet"), (ACCEPTED, "Accepted – being packed"), (READY, "Ready for pickup"),
              (OUT, "Out for delivery"), (DONE, "Completed – billed"), (CANCELLED, "Cancelled")]
    OPEN_STATUSES = (NEW, ACCEPTED, READY, OUT)
    PICKUP, DELIVERY = "pickup", "delivery"
    MODES = [(PICKUP, "Takeaway – customer collects"), (DELIVERY, "Home delivery")]

    number = models.CharField(max_length=20, unique=True)
    token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False, help_text="Secret part of the customer's tracking link")
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    name = models.CharField(max_length=80)
    phone = models.CharField(max_length=15, db_index=True, help_text="91XXXXXXXXXX")
    mode = models.CharField(max_length=8, choices=MODES)
    slot = models.DateTimeField(db_index=True, help_text="Start of the pickup / delivery slot")
    address = models.CharField(max_length=300, blank=True)
    notes = models.CharField(max_length=300, blank=True)
    pay_pref = models.CharField(max_length=6, default="cash", choices=[("cash", "Cash"), ("upi", "UPI")])
    status = models.CharField(max_length=10, choices=STATUS, default=NEW, db_index=True)
    status_note = models.CharField(max_length=200, blank=True)
    est_items = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    delivery_charge = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    accepted_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    accepted_at = models.DateTimeField(null=True, blank=True)
    done_at = models.DateTimeField(null=True, blank=True)
    draft_uuid = models.UUIDField(null=True, blank=True, db_index=True, help_text="Counter bill it was loaded into")
    sale = models.OneToOneField("sales.Sale", null=True, blank=True, on_delete=models.PROTECT, related_name="online_order")
    ip = models.CharField(max_length=45, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.number

    @property
    def est_total(self):
        return self.est_items + self.delivery_charge

    @property
    def is_open(self):
        return self.status in self.OPEN_STATUSES


class OnlineOrderLine(models.Model):
    order = models.ForeignKey(OnlineOrder, on_delete=models.CASCADE, related_name="lines")
    item = models.ForeignKey("catalog.Item", on_delete=models.PROTECT, related_name="+")
    name = models.CharField(max_length=160)
    name_ta = models.CharField(max_length=160, blank=True)
    unit = models.CharField(max_length=4)
    qty = models.DecimalField(max_digits=12, decimal_places=3)
    price = models.DecimalField(max_digits=10, decimal_places=2, help_text="Price per unit shown when ordered")

    @property
    def amount(self):
        return (self.qty * self.price).quantize(self.price)
