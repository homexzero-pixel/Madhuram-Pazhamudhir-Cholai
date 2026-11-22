from django.conf import settings
from django.db import models, transaction
from django.utils import timezone


class StoreSettings(models.Model):
    """One row. Shop identity, invoice series and counter hardware settings."""

    RECEIPT_WIDTHS = [("80", "80 mm thermal"), ("58", "58 mm thermal"), ("a4", "A4 invoice")]
    VALUE_TYPES = [("weight", "Weight (kg)"), ("price", "Price (₹)")]

    name = models.CharField(max_length=100, default="Madhuram Pazhamudhir Cholai")
    name_ta = models.CharField("Name in Tamil", max_length=100, default="மதுரம் பழமுதிர் சோலை")
    legal_name = models.CharField(max_length=150, blank=True)
    tagline = models.CharField(max_length=150, blank=True, default="Supermarket · Fresh fruits, vegetables & daily needs")
    address = models.TextField(blank=True)
    phone = models.CharField(max_length=30, blank=True)
    email = models.EmailField(blank=True)
    gstin = models.CharField("GSTIN", max_length=15, blank=True)
    state_name = models.CharField(max_length=40, default="Tamil Nadu")
    state_code = models.CharField(max_length=2, default="33")
    fssai = models.CharField("FSSAI licence no.", max_length=20, blank=True)
    invoice_prefix = models.CharField(max_length=6, default="MPC", help_text="Bill number = PREFIX/FY/00001, at most 16 characters.")
    credit_note_prefix = models.CharField(max_length=6, default="MCN")
    bill_footer = models.CharField(max_length=200, blank=True, default="Thank you! Visit again. நன்றி, மீண்டும் வருக!")
    receipt_width = models.CharField(max_length=3, choices=RECEIPT_WIDTHS, default="80")
    auto_print = models.BooleanField(default=True, help_text="Open the print dialog as soon as a bill is saved.")
    require_tax_setup = models.BooleanField(
        default=False, help_text="Block billing of items whose GST treatment is not set. Turn on after the accountant has reviewed tax data."
    )

    # Weighing-scale barcode labels (EAN-13 style). Defaults match a common Indian
    # pattern "2 IIIII VVVVV C" but MUST be checked against a real label from the store's scale.
    scale_enabled = models.BooleanField(default=False)
    scale_prefixes = models.CharField(max_length=20, default="20,21,22,23,24,25,26,27,28,29", help_text="Comma-separated leading digits that mark a scale label.")
    scale_item_start = models.PositiveSmallIntegerField(default=2, help_text="Position (0-based) where the item code starts.")
    scale_item_length = models.PositiveSmallIntegerField(default=5)
    scale_value_start = models.PositiveSmallIntegerField(default=7)
    scale_value_length = models.PositiveSmallIntegerField(default=5)
    scale_value_type = models.CharField(max_length=6, choices=VALUE_TYPES, default="weight")
    scale_value_decimals = models.PositiveSmallIntegerField(default=3)
    scale_check_digit = models.BooleanField(default=True, help_text="Validate the EAN-13 check digit.")
    scale_label_length = models.PositiveSmallIntegerField(default=13)

    scanner_note = models.CharField(max_length=200, blank=True, default="USB scanner in keyboard (HID) mode, Enter suffix.")
    printer_note = models.CharField(max_length=200, blank=True, default="Thermal printer installed as a Windows printer; set as default in the browser.")
    scale_note = models.CharField(max_length=200, blank=True, default="Weight entered by the cashier. Direct scale link needs the scale model.")
    hardware_tested = models.CharField(max_length=300, blank=True, default="", help_text="Record each device only after a physical test, e.g. 'Scanner XYZ tested 12-Dec by Priya'.")

    loyalty_enabled = models.BooleanField(default=True)
    loyalty_rupees_per_point = models.DecimalField(max_digits=8, decimal_places=2, default=100, help_text="₹ spent for 1 point.")
    loyalty_point_value = models.DecimalField(max_digits=6, decimal_places=2, default=1, help_text="₹ value of 1 point when redeemed.")
    near_expiry_days = models.PositiveSmallIntegerField(default=7)
    dead_stock_days = models.PositiveSmallIntegerField(default=60)

    backup_keep = models.PositiveSmallIntegerField(default=30, help_text="Not used any more: backups are kept automatically (all from 2 days, daily for 60 days, monthly for 2 years).")
    backup_extra_dir = models.CharField(max_length=255, blank=True, help_text="Second backup place: your Google Drive for desktop folder, e.g. G:\\My Drive (found automatically by Setup_Backups.bat). Each backup is copied and checked into its 'Madhuram backups' folder.")
    is_demo = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "store settings"

    def __str__(self):
        return self.name

    @classmethod
    def load(cls):
        obj = cls.objects.filter(pk=1).first()
        if obj is None:
            obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def identity(self):
        return {
            "name": self.name, "name_ta": self.name_ta, "legal_name": self.legal_name, "address": self.address,
            "phone": self.phone, "gstin": self.gstin, "state": self.state_name, "state_code": self.state_code,
            "fssai": self.fssai, "footer": self.bill_footer,
        }


class Sequence(models.Model):
    """Gap-free counters for bill and credit-note numbers, one row per series and FY."""

    key = models.CharField(max_length=30, unique=True)
    last = models.PositiveIntegerField(default=0)

    @classmethod
    def next(cls, key):
        assert transaction.get_connection().in_atomic_block, "Sequence.next must run inside a transaction"
        obj, _ = cls.objects.select_for_update().get_or_create(key=key)
        obj.last += 1
        obj.save(update_fields=["last"])
        return obj.last


class AuditLog(models.Model):
    """Who did what. Price changes, approvals, refunds, write-offs, shift reopen, etc."""

    at = models.DateTimeField(default=timezone.now, db_index=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    action = models.CharField(max_length=40, db_index=True)
    object_type = models.CharField(max_length=40, blank=True)
    object_id = models.CharField(max_length=40, blank=True)
    summary = models.CharField(max_length=300)
    data = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-at", "-id"]

    def __str__(self):
        return f"{self.at:%d-%m %H:%M} {self.action} {self.summary}"


def audit(action, summary, *, user=None, approved_by=None, obj=None, **data):
    return AuditLog.objects.create(
        action=action, summary=summary[:300], user=user if getattr(user, "pk", None) else None,
        approved_by=approved_by if getattr(approved_by, "pk", None) else None,
        object_type=obj.__class__.__name__ if obj is not None else "",
        object_id=str(obj.pk) if obj is not None else "", data={k: str(v) for k, v in data.items()},
    )
