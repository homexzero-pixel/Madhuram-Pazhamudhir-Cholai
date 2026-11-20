"""Bring the data from the earlier single-counter pilot (Madhuram_POS, counter.sqlite) into this system.

What is carried over:
  * store identity (legal name, address, GSTIN)
  * products: names, departments, categories, sale unit, linked barcodes, selling price, MRP
  * HSN and GST rate per SKU (0 % rates are left as "not set" for the accountant to classify
    as exempt or nil-rated – the pilot did not record which)
  * every stock lot with its remaining quantity, cost, supplier, invoice reference, batch and expiry
  * suppliers (from lot and order records) and open purchase-order quantities
  * history: shifts, bills with their lines, payments and tax split, line refunds and expenses,
    so reports cover the pilot period. Pilot bills keep their number as PILOT-000123.

The pilot stored money in paise and quantities in thousandths; both are converted exactly.
The pilot database is opened read-only and is never changed.
"""
import sqlite3
from datetime import datetime
from decimal import Decimal
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from accounts.models import User
from catalog.models import Barcode, BaseProduct, Category, Department, Item, TaxClass
from core.models import StoreSettings, audit
from customers.models import Customer
from expenses.models import Expense, ExpenseCategory
from inventory.models import StockLot, StockMove
from purchasing.models import POLine, PurchaseOrder, Supplier
from sales.models import Payment, ReturnLine, Sale, SaleLine, SaleReturn, Shift

P = Decimal("0.01")
M = Decimal("0.001")


def paise(v):
    return (Decimal(v or 0) * P).quantize(P)


def milli(v):
    return (Decimal(v or 0) * M).quantize(M)


def when(text):
    if not text:
        return timezone.now()
    dt = datetime.fromisoformat(text)
    return timezone.make_aware(dt) if timezone.is_naive(dt) else dt


class Command(BaseCommand):
    help = "Import data from the pilot's counter.sqlite (opened read-only)."

    def add_arguments(self, parser):
        parser.add_argument("pilot_db")
        parser.add_argument("--dry-run", action="store_true", help="Read and report, but save nothing.")

    def handle(self, *args, pilot_db, dry_run, **opts):
        path = Path(pilot_db)
        if not path.exists():
            raise CommandError(f"{path} not found")
        src = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        src.row_factory = sqlite3.Row
        tables = {r[0] for r in src.execute("select name from sqlite_master where type='table'")}
        if "product" not in tables or "lot" not in tables:
            raise CommandError("This does not look like a Madhuram pilot database (no product / lot tables).")
        if Sale.objects.filter(bill_no__startswith="PILOT-").exists():
            raise CommandError("Pilot data was already imported into this database.")
        self.report = {}
        try:
            with transaction.atomic():
                self._run(src, tables)
                if dry_run:
                    raise _DryRun
        except _DryRun:
            self.stdout.write(self.style.WARNING("Dry run only – nothing saved."))
        for k, v in self.report.items():
            self.stdout.write(f"  {k}: {v}")
        if not dry_run:
            audit("pilot_import", f"Imported pilot database {path.name}: " + ", ".join(f"{k} {v}" for k, v in self.report.items()))
            self.stdout.write(self.style.SUCCESS("Pilot data imported. Check products, stock and the last pilot bill before billing."))

    def _count(self, key, n=1):
        self.report[key] = self.report.get(key, 0) + n

    def _run(self, src, tables):
        cfg = StoreSettings.load()
        if "retail_profile" in tables:
            r = src.execute("select * from retail_profile where id=1").fetchone()
            if r:
                cfg.legal_name, cfg.address, cfg.gstin = r["legal"] or cfg.legal_name, r["address"] or cfg.address, (r["gstin"] or "").upper()
                cfg.save()
                self._count("store identity", 1)

        taxes = {r["sku"]: r for r in src.execute("select * from tax")} if "tax" in tables else {}
        for r in src.execute("select * from product"):
            sku = r["sku"].strip().upper()
            item = Item.objects.filter(sku=sku).first()
            if item is not None and item.name == r["name"] and not r["price"] and not r["barcode"] and r["sku"] not in taxes:
                self._count("products already identical")
                continue
            dept, _ = Department.objects.get_or_create(name=(r["dept"] or "Uncategorised").strip())
            cat, _ = Category.objects.get_or_create(department=dept, name=(r["category"] or "Uncategorised").strip())
            weighed = (r["unit"] or "pack") == "kg"
            if item is None:
                base, _ = BaseProduct.objects.get_or_create(name=r["name"].split("·")[0].strip()[:120] or sku, defaults={"category": cat})
                item = Item(sku=sku, base=base, department=dept, category=cat, sale_unit=Item.KG if weighed else Item.PCS,
                            purchase_unit="kg" if weighed else "pcs")
                self._count("products created")
            else:
                self._count("products updated")
            item.name = r["name"]
            if r["price"]:
                item.price = paise(r["price"])
                item.mrp = paise(r["mrp"]) if r["mrp"] else item.price
                item.is_active, item.status = True, Item.VERIFIED
            t = taxes.get(r["sku"])
            if t:
                item.hsn = t["hsn"] or ""
                rate = Decimal(t["rate"] or 0) / 100
                if rate > 0:
                    item.tax_class, item.gst_rate = TaxClass.TAXABLE, rate
                else:
                    item.tax_class = TaxClass.UNSET
                    self._count("0% GST items left for the accountant to classify")
            item.save()
            if r["barcode"]:
                code = r["barcode"].strip()
                other = Barcode.objects.filter(code=code).exclude(item=item).first()
                if other:
                    self._count(f"barcode conflicts skipped ({code} already on {other.item.sku})")
                else:
                    Barcode.objects.get_or_create(code=code, defaults={"item": item, "note": "From pilot"})
                    self._count("barcodes linked")

        suppliers = {}

        def supplier(name):
            name = (name or "").strip() or "Unknown (pilot)"
            if name not in suppliers:
                suppliers[name], created = Supplier.objects.get_or_create(name=name)
                if created:
                    self._count("suppliers created")
            return suppliers[name]

        lot_map = {}
        for r in src.execute("select * from lot order by id"):
            item = Item.objects.get(sku=r["sku"].strip().upper())
            q = milli(r["qty"])
            cost = paise(r["cost"])
            lot = StockLot.objects.create(item=item, batch=r["batch"] or "", expiry=r["expiry"] or None, received_qty=q, qty=q,
                                          unit_cost=cost, received_at=when(r["received"]), source=f"PILOT lot {r['id']} {r['reference'] or ''}"[:60],
                                          supplier=supplier(r["supplier"]))
            lot_map[r["id"]] = lot
            if q > 0:
                StockMove.objects.create(item=item, lot=lot, kind="opening", qty=q, unit_cost=cost, ref=f"PILOT-{r['id']}",
                                         reason="Balance carried over from the pilot")
                self._count("stock lots carried over")
        for item in Item.objects.filter(lots__isnull=False).distinct():
            from inventory.services import _sync_on_hand

            _sync_on_hand(item.pk)

        owner = User.objects.filter(role="owner").order_by("id").first()
        if "orders" in tables:
            for r in src.execute("select * from orders where qty>received"):
                if owner is None:
                    self._count("open orders skipped (create the owner account first)")
                    break
                po = PurchaseOrder.objects.create(number=f"PILOT-PO-{r['id']}", supplier=supplier(r["supplier"]), created_by=owner,
                                                  expected_on=r["due"] or None, notes="Carried over from the pilot")
                POLine.objects.create(order=po, item=Item.objects.get(sku=r["sku"].strip().upper()), qty=milli(r["qty"] - r["received"]),
                                      unit_cost=paise(r["cost"]))
                self._count("open purchase orders")

        # ---- history
        users = {}

        def staff(name):
            name = (name or "pilot").strip()
            if name not in users:
                username = "pilot-" + "".join(ch for ch in name.lower() if ch.isalnum())[:20] or "pilot"
                u, created = User.objects.get_or_create(username=username, defaults={"first_name": name[:30], "role": "cashier", "is_active": False})
                if created:
                    u.set_unusable_password()
                    u.save()
                users[name] = u
            return users[name]

        shift_map = {}
        for r in src.execute("select * from shift order by id"):
            opened = when(r["opened"])
            s = Shift.objects.create(counter="Pilot counter", cashier=staff(r["cashier"]), business_date=timezone.localdate(opened),
                                     opened_at=opened, opening_float=paise(r["opening"]), status=Shift.CLOSED,
                                     closed_at=when(r["closed"]) if r["closed"] else opened, counted=paise(r["counted"]) if r["counted"] is not None else None,
                                     variance=paise(r["variance"]) if r["variance"] is not None else None,
                                     close_note="Pilot shift" + ("" if r["closed"] else " (was still open in the pilot)"))
            if r["counted"] is not None and r["variance"] is not None:
                s.expected = s.counted - s.variance
                s.save(update_fields=["expected"])
            shift_map[r["id"]] = s
            self._count("shifts")
        cust_cache = {}
        line_map = {}
        line_tax = {r["line_id"]: r for r in src.execute("select * from line_tax")} if "line_tax" in tables else {}
        profiles = {r["sale_id"]: r for r in src.execute("select * from bill_profile")} if "bill_profile" in tables else {}
        for r in src.execute("select * from sale order by id"):
            t = when(r["time"])
            shift = shift_map[r["shift_id"]]
            cust = None
            if (r["customer"] or "").strip():
                name = r["customer"].strip()
                cust = cust_cache.get(name) or Customer.objects.filter(name=name, phone__isnull=True).first() or Customer.objects.create(name=name, notes="From pilot")
                cust_cache[name] = cust
            prof = profiles.get(r["id"])
            sale = Sale.objects.create(
                bill_no=f"PILOT-{r['id']:06d}", draft_uuid=__import__("uuid").uuid4(), business_date=timezone.localdate(t), created_at=t,
                shift=shift, cashier=shift.cashier, customer=cust, gross=paise(r["total"]), discount=Decimal("0.00"), total=paise(r["total"]),
                doc_type=Sale.CASH_MEMO if not (prof and prof["gstin"]) else Sale.TAX_INVOICE,
                identity={"name": cfg.name, "legal_name": prof["legal"] if prof else "", "address": prof["address"] if prof else "",
                          "gstin": prof["gstin"] if prof else "", "footer": "", "state": cfg.state_name, "state_code": cfg.state_code},
            )
            method = (r["method"] or "Cash").lower()
            tender = paise(r["tender"]) if method == "cash" else paise(r["total"])
            Payment.objects.create(sale=sale, method=method if method in ("cash", "upi", "card") else "cash", amount=paise(r["total"]),
                                   tendered=tender, change=tender - paise(r["total"]), reference="pilot")
            self._count("bills")
        for r in src.execute("select * from line order by id"):
            sale = Sale.objects.get(bill_no=f"PILOT-{r['sale_id']:06d}")
            item = Item.objects.get(sku=r["sku"].strip().upper())
            tx = line_tax.get(r["id"])
            total = paise(r["total"])
            sl = SaleLine.objects.create(
                sale=sale, item=item, sku=item.sku, name=r["name"], category=r["category"] or item.category.name, department=item.department.name,
                unit="kg" if r["unit"] == "kg" else "pc", qty=milli(r["qty"]), list_price=paise(r["price"]), rate=paise(r["price"]), mrp=None,
                gross=total, discount=Decimal("0.00"), net=total, tax_class=TaxClass.TAXABLE if tx and tx["rate"] else TaxClass.UNSET,
                hsn=tx["hsn"] if tx else "", gst_rate=Decimal(tx["rate"]) / 100 if tx else Decimal(0), taxable=paise(tx["base"]) if tx else total,
                cgst=paise(tx["central"]) if tx else Decimal(0), sgst=paise(tx["state"]) if tx else Decimal(0), cost=paise(r["cost"]),
            )
            line_map[r["id"]] = sl
            self._count("bill lines")
        if "refund" in tables:
            for r in src.execute("select * from refund order by id"):
                sl = line_map[r["line_id"]]
                t = when(r["time"])
                ret = SaleReturn.objects.create(number=f"PILOT-R{r['id']:05d}", sale=sl.sale, business_date=timezone.localdate(t), created_at=t,
                                                shift=shift_map.get(r["shift_id"]), user=sl.sale.cashier, reason=r["reason"] or "Pilot refund",
                                                method=(r["method"] or "cash").lower() if (r["method"] or "").lower() in ("cash", "upi", "card") else "cash",
                                                total=paise(r["total"]))
                ReturnLine.objects.create(ret=ret, sale_line=sl, qty=sl.qty, amount=sl.net, taxable=sl.taxable, cgst=sl.cgst, sgst=sl.sgst,
                                          cost=sl.cost, disposition="quarantine")
                SaleLine.objects.filter(pk=sl.pk).update(returned_qty=sl.qty)
                self._count("refunds")
        if "spend" in tables:
            for r in src.execute("select * from spend order by id"):
                cat, _ = ExpenseCategory.objects.get_or_create(name=(r["category"] or "Miscellaneous").strip()[:60])
                t = when(r["time"])
                m = (r["method"] or "Cash").lower()
                Expense.objects.create(spent_on=timezone.localdate(t), category=cat, description=r["note"] or "Pilot expense", amount=paise(r["amount"]),
                                       method=m if m in ("cash", "bank", "upi", "card") else "cash", shift=shift_map.get(r["shift_id"]) if m == "cash" else None,
                                       created_by=shift_map[r["shift_id"]].cashier if r["shift_id"] in shift_map else (owner or staff("pilot")),
                                       created_at=t)
                self._count("expenses")


class _DryRun(Exception):
    pass
