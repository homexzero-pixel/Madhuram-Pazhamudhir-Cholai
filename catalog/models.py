from decimal import Decimal

from django.core.validators import MinValueValidator
from django.db import models

NONNEG = [MinValueValidator(Decimal("0"))]


class Department(models.Model):
    name = models.CharField(max_length=60, unique=True)
    name_ta = models.CharField(max_length=80, blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Category(models.Model):
    department = models.ForeignKey(Department, on_delete=models.PROTECT, related_name="categories")
    name = models.CharField(max_length=60)
    name_ta = models.CharField(max_length=80, blank=True)

    class Meta:
        ordering = ["department__name", "name"]
        unique_together = [("department", "name")]
        verbose_name_plural = "categories"

    def __str__(self):
        return self.name


class TaxClass(models.TextChoices):
    UNSET = "unset", "Not set (needs accountant)"
    TAXABLE = "taxable", "Taxable"
    EXEMPT = "exempt", "Exempt"
    NIL = "nil", "Nil-rated"
    NON_GST = "non_gst", "Non-GST"


class BaseProduct(models.Model):
    """What the item is (e.g. 'Ponni rice'), shared by all its packs and brands."""

    name = models.CharField(max_length=120, unique=True)
    name_ta = models.CharField("Tamil name", max_length=120, blank=True)
    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="base_products")
    subcategory = models.CharField(max_length=60, blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Item(models.Model):
    """A sellable SKU: one brand, variant and pack size with its own price and stock."""

    PCS, KG = "pcs", "kg"
    SALE_UNITS = [(PCS, "Piece / pack"), (KG, "Kilogram (weighed)")]
    VERIFIED, CANDIDATE = "verified", "candidate"
    STATUS = [(VERIFIED, "Verified by store"), (CANDIDATE, "Generated candidate – not verified")]

    sku = models.CharField("SKU", max_length=20, unique=True)
    plu = models.CharField("PLU", max_length=8, unique=True, null=True, blank=True, help_text="Short code for loose produce and scale labels.")
    base = models.ForeignKey(BaseProduct, on_delete=models.PROTECT, related_name="items")
    name = models.CharField("English name", max_length=160, db_index=True)
    name_ta = models.CharField("Tamil name", max_length=160, blank=True, db_index=True)
    brand = models.CharField(max_length=60, blank=True, db_index=True)
    variant = models.CharField(max_length=60, blank=True)
    pack_size = models.CharField(max_length=40, blank=True)
    department = models.ForeignKey(Department, on_delete=models.PROTECT, related_name="items")
    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="items")
    subcategory = models.CharField(max_length=60, blank=True)
    sale_unit = models.CharField(max_length=4, choices=SALE_UNITS, default=PCS)
    purchase_unit = models.CharField(max_length=20, default="pcs", help_text="e.g. carton, bag, crate, kg")
    units_per_purchase = models.DecimalField(
        max_digits=10, decimal_places=3, default=1, validators=[MinValueValidator(Decimal("0.001"))],
        help_text="Sale units in one purchase unit, e.g. 24 bottles per carton.",
    )
    mrp = models.DecimalField("MRP", max_digits=10, decimal_places=2, null=True, blank=True, validators=NONNEG)
    cost = models.DecimalField("Purchase cost", max_digits=10, decimal_places=2, null=True, blank=True, validators=NONNEG, help_text="Latest cost per sale unit.")
    price = models.DecimalField("Selling price", max_digits=10, decimal_places=2, null=True, blank=True, validators=NONNEG, help_text="Per piece, or per kg for weighed items. GST inclusive.")
    hsn = models.CharField("HSN", max_length=8, blank=True)
    tax_class = models.CharField("GST treatment", max_length=8, choices=TaxClass.choices, default=TaxClass.UNSET)
    gst_rate = models.DecimalField("GST %", max_digits=5, decimal_places=2, null=True, blank=True)
    preferred_supplier = models.ForeignKey("purchasing.Supplier", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    reorder_level = models.DecimalField(max_digits=10, decimal_places=3, default=0, validators=NONNEG)
    shelf = models.CharField("Shelf location", max_length=30, blank=True)
    track_batch = models.BooleanField(default=False)
    track_expiry = models.BooleanField(default=False)
    is_active = models.BooleanField("Active (can be sold)", default=False, db_index=True)
    status = models.CharField(max_length=10, choices=STATUS, default=VERIFIED)
    on_hand = models.DecimalField(max_digits=12, decimal_places=3, default=0, help_text="Sellable stock. Kept equal to the sum of sellable lots.")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        indexes = [models.Index(fields=["category", "is_active"])]

    def __str__(self):
        return self.name

    @property
    def weighed(self):
        return self.sale_unit == self.KG

    @property
    def unit_label(self):
        return "kg" if self.weighed else "pc"

    @property
    def is_low(self):
        return self.on_hand <= self.reorder_level

    def tax_rate(self):
        if self.tax_class == TaxClass.TAXABLE and self.gst_rate is not None:
            return self.gst_rate
        return Decimal("0")

    def as_dict(self):
        return {
            "id": self.pk, "sku": self.sku, "plu": self.plu or "", "name": self.name, "name_ta": self.name_ta,
            "brand": self.brand, "pack": self.pack_size, "unit": self.unit_label, "weighed": self.weighed,
            "price": str(self.price) if self.price is not None else None, "mrp": str(self.mrp) if self.mrp is not None else None,
            "on_hand": str(self.on_hand), "active": self.is_active, "status": self.status,
        }


class Barcode(models.Model):
    """A scannable code. Text, so leading zeros survive. One code -> exactly one item."""

    MANUFACTURER, INTERNAL = "mfr", "int"
    KINDS = [(MANUFACTURER, "Manufacturer (on pack)"), (INTERNAL, "Store label")]

    code = models.CharField(max_length=32, unique=True)
    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="barcodes")
    kind = models.CharField(max_length=3, choices=KINDS, default=MANUFACTURER)
    qty_per_scan = models.DecimalField(
        max_digits=10, decimal_places=3, default=1, validators=[MinValueValidator(Decimal("0.001"))],
        help_text="Units added per scan, e.g. 24 for a carton barcode of a bottle SKU.",
    )
    note = models.CharField(max_length=80, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.code


class ImportBatch(models.Model):
    """One applied product import. Keeps the previous values so it can be undone."""

    created_at = models.DateTimeField(auto_now_add=True)
    user = models.ForeignKey("accounts.User", on_delete=models.PROTECT, related_name="+")
    filename = models.CharField(max_length=200)
    created_items = models.PositiveIntegerField(default=0)
    updated_items = models.PositiveIntegerField(default=0)
    barcodes_added = models.PositiveIntegerField(default=0)
    undo = models.JSONField(default=dict)
    undone_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-id"]
