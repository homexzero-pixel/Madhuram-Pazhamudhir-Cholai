"""Load the 20,000-SKU starter catalogue as INACTIVE, UNVERIFIED candidates.

No prices, barcodes, HSN codes, GST rates or suppliers are invented: those columns
are empty in the source file and stay empty until the store fills them in.
"""
import csv
import time

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction

from catalog.models import BaseProduct, Category, Department, Item
from catalog.tamil import BASE_TAMIL


class Command(BaseCommand):
    help = "Load data/Madhuram_20000_SKUs.csv as inactive candidate SKUs (skips SKUs that already exist)."

    def add_arguments(self, parser):
        parser.add_argument("--file", default=str(settings.CATALOGUE_CSV))

    @transaction.atomic
    def handle(self, *args, file, **opts):
        t0 = time.perf_counter()
        with open(file, encoding="utf-8-sig", newline="") as f:
            rows = list(csv.DictReader(f))
        existing = set(Item.objects.values_list("sku", flat=True))
        depts = {d.name: d for d in Department.objects.all()}
        cats = {(c.department.name, c.name): c for c in Category.objects.select_related("department")}
        bases = {b.name: b for b in BaseProduct.objects.all()}
        new = []
        for r in rows:
            sku = r["SKU"].strip().upper()
            if sku in existing:
                continue
            dn, cn, bn = r["Department"].strip(), r["Category"].strip(), r["Base product"].strip()
            d = depts.get(dn) or depts.setdefault(dn, Department.objects.create(name=dn))
            c = cats.get((dn, cn)) or cats.setdefault((dn, cn), Category.objects.create(department=d, name=cn))
            b = bases.get(bn) or bases.setdefault(bn, BaseProduct.objects.create(name=bn, category=c, name_ta=BASE_TAMIL.get(bn, "")))
            pack = r["Pack"].strip()
            weighed = r["Sale unit"].strip().lower() == "kg"
            ta = BASE_TAMIL.get(bn, "")
            new.append(Item(
                sku=sku, base=b, name=r["Product name"].strip(), name_ta=f"{ta} · {pack}" if ta else "",
                brand=r.get("Brand", "").strip(), variant=r["Variant"].strip(), pack_size=pack, department=d, category=c,
                sale_unit=Item.KG if weighed else Item.PCS, purchase_unit="kg" if weighed else "pcs",
                is_active=False, status=Item.CANDIDATE,
            ))
        Item.objects.bulk_create(new, batch_size=2000)
        self.stdout.write(self.style.SUCCESS(
            f"Loaded {len(new)} candidate SKUs ({len(rows) - len(new)} already present) in {time.perf_counter() - t0:.1f}s. "
            f"Tamil names filled for {sum(1 for b in bases.values() if b.name_ta)} of {len(bases)} base products."))
