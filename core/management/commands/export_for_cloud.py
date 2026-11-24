"""Write everything the cloud edition needs (products, barcodes, stock lots, customers, staff, shop details) to one file.

The owner uploads it in the cloud app: Settings & backup -> Bring data from the shop PC.
"""
import gzip
import json
from decimal import Decimal
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db.models import Sum
from django.utils import timezone

from accounts.models import User
from catalog.models import Item
from core.models import StoreSettings
from customers.models import Customer
from inventory.models import StockLot


def s(v):
    return None if v is None else f"{v:f}" if isinstance(v, Decimal) else v


class Command(BaseCommand):
    help = "Export products, stock, customers and staff for the Madhuram cloud edition."

    def add_arguments(self, parser):
        parser.add_argument("--out", default=str(Path.home() / "Desktop" / "madhuram_cloud_export.json.gz"))

    def handle(self, *args, out, **opts):
        lots = {}
        for lot in StockLot.objects.filter(status=StockLot.SELLABLE, qty__gt=0).order_by("pk"):
            lots.setdefault(lot.item_id, []).append({"qty": s(lot.qty), "unit_cost": s(lot.unit_cost),
                                                    "expiry": lot.expiry.isoformat() if lot.expiry else None, "batch": lot.batch})
        items = []
        for it in Item.objects.select_related("category").prefetch_related("barcodes").order_by("pk"):
            items.append({
                "sku": it.sku, "plu": it.plu or None, "name": it.name, "name_ta": it.name_ta, "cat": it.category.name,
                "unit": "kg" if it.sale_unit == "kg" else "pcs", "price": s(it.price), "mrp": s(it.mrp), "cost": s(it.cost or 0),
                "gst_rate": s(it.gst_rate or 0), "tax_class": it.tax_class, "hsn": it.hsn, "reorder_level": s(it.reorder_level),
                "active": it.is_active, "barcodes": [[b.code, s(b.qty_per_scan)] for b in it.barcodes.all()],
                "lots": lots.get(it.pk, []),
            })
        customers = [{"name": c.name, "phone": c.phone, "points": s(c.pts or Decimal(0))}
                     for c in Customer.objects.annotate(pts=Sum("loyalty__points"))]
        users = [{"username": u.username, "name": u.get_full_name() or u.username, "role": "owner" if u.is_superuser else u.role,
                  "active": u.is_active, "password_hash": u.password if u.password.startswith("pbkdf2_sha256$") else "",
                  "pin_hash": u.approval_pin if u.approval_pin.startswith("pbkdf2_sha256$") else ""} for u in User.objects.all()]
        cfg = StoreSettings.load()
        keys = ["name", "name_ta", "tagline", "address", "phone", "gstin", "fssai", "invoice_prefix", "bill_footer"]
        data = {"format": "madhuram-cloud-export", "version": 1, "exported_at": timezone.now().isoformat(),
                "settings": {k: getattr(cfg, k, "") for k in keys}, "items": items, "customers": customers, "users": users}
        Path(out).parent.mkdir(parents=True, exist_ok=True)
        with gzip.open(out, "wt", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        self.stdout.write(self.style.SUCCESS(
            f"Saved {out}\n{len(items)} products, {sum(len(v) for v in lots.values())} stock lots, {len(customers)} customers, {len(users)} logins."))
