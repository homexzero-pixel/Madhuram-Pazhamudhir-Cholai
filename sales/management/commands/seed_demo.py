"""Fill the PRACTICE database with users, verified sample products, stock and two weeks of history.

Refuses to run on the live store database. Practice prices are examples, not store prices.
"""
import random
from datetime import datetime, time, timedelta
from decimal import Decimal

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from catalog.models import Barcode, Category, Department, Item, TaxClass
from core import testing as T
from core.models import StoreSettings
from customers.models import Customer, Offer
from expenses.models import Expense, ExpenseCategory
from inventory import services as stock
from purchasing import services as P
from purchasing.models import Supplier
from sales import services as S
from sales.models import Sale, Shift

D = Decimal
# sku, name, tamil, dept, cat, unit, price, mrp, cost, gst, barcode, plu, stock, expiry_days
PRACTICE = [
    ("TRYRICE", "Practice Ponni rice · 1 kg pack", "பொன்னி அரிசி · 1 kg", "Pantry", "Rice & millets", "pcs", 75, 80, 60, None, "8901000000019", None, 20, None),
    ("TRYAPPLE", "Practice apple · loose", "ஆப்பிள் · உதிரி", "Fresh produce", "Fruit", "kg", 180, 180, 120, None, None, "101", 12, None),
    ("TRYOIL1L", "Practice sunflower oil · 1 L pouch", "சூரியகாந்தி எண்ணெய் · 1 L", "Pantry", "Oils", "pcs", 165, 175, 140, 5, "0890105800007", None, 30, None),
    ("TRYJUICE", "Practice mango drink · 200 ml bottle", "மாம்பழ பானம் · 200 ml", "Beverages", "Fruit drinks", "pcs", 20, 20, 14, 12, "8900000000050", None, 0, None),
    ("TRYMILK", "Practice toned milk · 500 ml", "பால் · 500 ml", "Dairy & chilled", "Milk & drinks", "pcs", 28, 28, 24, None, "8901000000101", None, 0, None),
]
PRODUCE = [  # base product, price per kg, cost, plu
    ("Poovan banana", 60, 42, "102"), ("Nendran banana", 80, 58, "103"), ("Tomato", 32, 22, "104"), ("Small onion", 70, 50, "105"),
    ("Red onion", 40, 28, "106"), ("Potato", 38, 27, "107"), ("Carrot", 60, 42, "108"), ("Brinjal", 45, 30, "109"),
    ("Okra", 50, 34, "110"), ("Banganapalli mango", 110, 80, "111"), ("Pomegranate", 190, 140, "112"), ("Papaya", 40, 26, "113"),
    ("Sapota", 80, 55, "114"), ("Guava", 70, 48, "115"), ("Green chilli", 60, 40, "116"), ("Ginger", 120, 85, "117"),
]
PACKED = [  # base, pack, price, mrp, cost
    ("Ponni rice", "5 kg", 340, 365, 290), ("Seeraga samba rice", "1 kg", 145, 160, 118), ("Toor dal", "1 kg", 165, 180, 140),
    ("Urad dal", "500 g", 78, 85, 64), ("Moong dal", "500 g", 72, 80, 59), ("Wheat atta", "1 kg", 58, 62, 47),
    ("Iodised salt", "1 kg", 28, 30, 21), ("Groundnut oil", "1 L", 210, 230, 182), ("Sesame oil", "500 ml", 190, 210, 160),
    ("Filter coffee", "500 g", 280, 300, 225), ("Sambar", "100 g", 48, 52, 36), ("Rasam", "100 g", 45, 50, 34),
    ("Hen eggs", "6 pcs", 42, 45, 34), ("Curd", "500 g", 40, 42, 33), ("Ghee", "500 ml", 330, 350, 290), ("Murukku", "200 g", 55, 60, 40),
]


class Command(BaseCommand):
    help = "Create practice data (practice database only)."

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=14)
        parser.add_argument("--skip-catalogue", action="store_true")

    def handle(self, *args, days, skip_catalogue, **opts):
        if settings.MODE == "store":
            raise CommandError("seed_demo only runs on the practice database (MPC_MODE=demo).")
        random.seed(7)
        if not skip_catalogue and not Item.objects.filter(status=Item.CANDIDATE).exists():
            call_command("load_catalogue", verbosity=0)
        with transaction.atomic():
            self._setup()
        self._history(days)
        self.stdout.write(self.style.SUCCESS("Practice data ready. Users owner / manager / cashier / purchaser / auditor, password practice123, PIN 1234."))

    def _setup(self):
        cfg = StoreSettings.load()
        cfg.is_demo = True
        cfg.address = "Practice address – replace in Settings"
        cfg.phone = "PRACTICE"
        cfg.scale_enabled = True
        cfg.save()
        self.owner = T.user("owner", "owner", password="practice123")
        self.manager = T.user("manager", "manager", password="practice123")
        self.cashier = T.user("cashier", "cashier", password="practice123")
        T.user("purchaser", "purchaser", password="practice123")
        T.user("auditor", "auditor", password="practice123")
        for u, n in ((self.owner, "Meenakshi"), (self.manager, "Karthik"), (self.cashier, "Priya")):
            u.first_name = n
            u.save()
        self.sup = [Supplier.objects.get_or_create(name=n, defaults={"phone": p, "payment_terms_days": t})[0] for n, p, t in (
            ("Practice Koyambedu Traders", "044-0000000", 0), ("Practice Dindigul Dals & Grains", "0451-0000000", 15),
            ("Practice Madurai Dairy", "0452-0000000", 7), ("Practice FMCG Distributor", "0452-1111111", 21))]
        for sku, name, ta, dept, cat, unit, price, mrp, cost, gst, bc, plu, qty, exp in PRACTICE:
            if Item.objects.filter(sku=sku).exists():
                continue
            it = T.item(sku, name, price, unit=unit, barcode=bc, cost=cost, dept=dept, cat=cat, plu=plu, mrp=mrp, name_ta=ta,
                        tax_class=TaxClass.TAXABLE if gst else TaxClass.EXEMPT, gst=gst)
            it.reorder_level = D(5)
            if sku == "TRYJUICE":
                it.purchase_unit, it.units_per_purchase = "carton", D(24)
                Barcode.objects.create(code="18901000000030", item=it, qty_per_scan=24, note="Carton of 24")
            if sku == "TRYMILK":
                it.track_expiry = True
            it.save()
            if qty:
                stock.add_lot(it, D(qty), D(cost), kind="opening", ref="OPENING-PRACTICE", user=self.owner)
        # Verify a slice of the generated catalogue with practice prices (clearly practice values).
        for base, price, cost, plu in PRODUCE:
            it = Item.objects.filter(base__name=base, sale_unit=Item.KG).order_by("sku").first()
            if it and not it.is_active:
                it.price = it.mrp = D(price)
                it.cost, it.plu, it.is_active, it.status = D(cost), plu, True, Item.VERIFIED
                it.tax_class, it.reorder_level, it.track_expiry = TaxClass.EXEMPT, D(10), False
                it.save()
                stock.add_lot(it, D(random.randint(25, 60)), D(cost), kind="opening", ref="OPENING-PRACTICE", user=self.owner)
        n = 0
        for base, pack, price, mrp, cost in PACKED:
            it = Item.objects.filter(base__name=base, pack_size=pack).order_by("sku").first()
            if it and not it.is_active:
                n += 1
                it.price, it.mrp, it.cost = D(price), D(mrp), D(cost)
                it.is_active, it.status, it.reorder_level = True, Item.VERIFIED, D(6)
                it.tax_class = TaxClass.UNSET
                it.preferred_supplier = self.sup[1]
                it.save()
                stock.add_lot(it, D(random.randint(12, 40)), D(cost), kind="opening", ref="OPENING-PRACTICE", user=self.owner)
        today = timezone.localdate()
        if not Offer.objects.exists():
            o = Offer.objects.create(name="Pomegranate & papaya 5% off", kind=Offer.PERCENT, percent=5, priority=20, starts_on=today - timedelta(days=20),
                                     ends_on=today + timedelta(days=20), created_by=self.owner)
            o.items.add(*Item.objects.filter(base__name__in=["Pomegranate", "Papaya"], is_active=True))
            q = Offer.objects.create(name="Rice: buy 3 at ₹70 each", kind=Offer.QTY, min_qty=3, deal_price=70, priority=10,
                                     starts_on=today - timedelta(days=20), ends_on=today + timedelta(days=20), created_by=self.owner)
            q.items.add(Item.objects.get(sku="TRYRICE"))
        for name, phone, credit in (("Lakshmi R", "9840012345", True), ("Senthil Kumar", "9840054321", False), ("Hotel Annapoorna", "9840099999", True)):
            c, _ = Customer.objects.get_or_create(phone=phone, defaults={"name": name})
            if credit:
                c.credit_allowed, c.credit_limit, c.credit_approved_by = True, D(5000), self.owner
                c.save()

    def _history(self, days):
        if Sale.objects.exists():
            return
        today = timezone.localdate()
        items = list(Item.objects.filter(is_active=True).exclude(sku__startswith="TRY"))
        cats = {c.name: c for c in ExpenseCategory.objects.all()}
        custs = list(Customer.objects.all())
        for back in range(days, -1, -1):
            day = today - timedelta(days=back)
            stamp = timezone.make_aware(datetime.combine(day, time.min)) + timedelta(hours=8)
            shift = S.start_shift(self.cashier if back % 3 else self.manager, D(1000))
            Shift.objects.filter(pk=shift.pk).update(business_date=day, opened_at=stamp)
            if back % 4 == 0:
                lines = [{"item": it, "qty": D(random.randint(2, 6)), "unit_cost": it.cost * it.units_per_purchase} for it in random.sample(items, 4)]
                try:
                    P.receive(random.choice(self.sup), self.manager, invoice_no=f"PR-{day:%m%d}-{back}", invoice_date=day,
                              invoice_total=sum(l["qty"] * l["unit_cost"] for l in lines), lines=lines)
                except ValueError:
                    pass
            if back == 2:
                juice = Item.objects.get(sku="TRYJUICE")
                milk = Item.objects.get(sku="TRYMILK")
                P.receive(self.sup[3], self.manager, invoice_no="PRACTICE-FMCG-001", invoice_date=day, invoice_total=D("672.00") + D("288.00"),
                          lines=[{"item": juice, "qty": 2, "unit_cost": D("336.00")},
                                 {"item": milk, "qty": 12, "unit_cost": D("24.00"), "units_per_purchase": 1, "batch": "M1", "expiry": today + timedelta(days=2)}])
            for _ in range(random.randint(12, 22)):
                d = S.current_draft(shift.cashier)
                for it in random.sample(items, random.randint(1, 4)):
                    q = D(random.choice(["0.250", "0.500", "0.750", "1.000", "1.250"])) if it.weighed else D(random.randint(1, 3))
                    if stock.available(it) >= q:
                        S.add_item(d, it, q)
                if not d.lines.exists():
                    continue
                if random.random() < 0.25:
                    d.customer = random.choice(custs)
                    d.save()
                total = S.quote(d).total
                r = random.random()
                pays = ([{"method": "cash", "tendered": str((total / 50).to_integral_value(rounding="ROUND_CEILING") * 50)}] if r < 0.5 else
                        [{"method": "upi", "amount": str(total), "reference": f"UPI{random.randint(10**9, 10**10)}"}] if r < 0.85 else
                        [{"method": "card", "amount": str(total), "reference": f"{random.randint(100000, 999999)}"}])
                sale, _ = S.checkout(d.uuid, shift.cashier, pays)
                when = stamp + timedelta(minutes=random.randint(30, 12 * 60))
                if back == 0 and when > timezone.now():
                    when = timezone.now() - timedelta(minutes=random.randint(1, 60))
                Sale.objects.filter(pk=sale.pk).update(business_date=day, created_at=when)
            Expense.objects.create(spent_on=day, category=cats["Tea & staff welfare"], description="Tea for staff", amount=D(60), method="cash",
                                   shift=shift, created_by=self.manager)
            if back == days:
                Expense.objects.create(spent_on=day, category=cats["Rent"], description="Shop rent (practice)", amount=D(25000), method="bank",
                                       created_by=self.owner)
            if back == 3:
                s = Sale.objects.filter(shift=shift).first()
                l = s.lines.first()
                S.process_return(s, self.manager, [{"line": l.pk, "qty": "1" if l.unit == "pc" else str(min(l.qty, D("0.250"))), "disposition": "quarantine"}],
                                 method="cash", reason="Customer found it damaged")
            if back:
                summ = S.cash_summary(shift)
                counted = summ["expected"] - (D(10) if back == 5 else 0)
                S.close_shift(shift, self.manager, counted, retained=min(D(1000), counted))
                Shift.objects.filter(pk=shift.pk).update(closed_at=stamp + timedelta(hours=13))
