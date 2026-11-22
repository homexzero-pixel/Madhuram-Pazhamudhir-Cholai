"""Quick add: a new barcode scanned at the counter becomes a sellable product and is billed in one go."""
import json
from decimal import Decimal

from django.test import Client, TestCase

from catalog.models import Barcode, Category, Item, TaxClass
from core import testing as T
from sales import services as S


class QuickAddTests(TestCase):
    def setUp(self):
        self.owner = T.user("meena", "owner")
        self.cashier = T.user("priya", "cashier")
        self.manager = T.user("ravi", "manager", pin="4321")
        T.item("RICE", "Rice 1 kg", 75, barcode="111", stock_qty=10)   # makes the department/category
        self.cat = Category.objects.first()
        self.c = Client()

    def post(self, url, body, who):
        self.c.force_login(who)
        return json.loads(self.c.post(url, json.dumps(body), content_type="application/json").content)

    def test_new_barcode_at_counter_becomes_product_and_is_billed(self):
        S.start_shift(self.cashier, 500)
        d = self.post("/api/pos/scan/", {"code": "8901234567890"}, self.cashier)
        self.assertEqual(d["unknown"], "8901234567890")
        self.assertFalse(d["can_add"])
        body = {"code": "8901234567890", "name": "Gold Winner Oil 1 L", "category": self.cat.pk, "unit": "pcs",
                "mrp": "180", "price": "172.50", "gst": "5", "stock": "12", "cost": "150", "stock_required": True}
        refused = self.post("/api/products/quick-add/", body, self.cashier)          # cashier alone may not
        self.assertFalse(refused["ok"]); self.assertTrue(refused.get("needs_approval"))
        ok = self.post("/api/products/quick-add/", dict(body, approver="ravi", pin="4321"), self.cashier)
        self.assertTrue(ok["ok"], ok)
        it = Item.objects.get(pk=ok["item"]["id"])
        self.assertTrue(it.is_active)
        self.assertEqual((it.price, it.mrp, it.tax_class, it.gst_rate), (Decimal("172.50"), Decimal("180"), TaxClass.TAXABLE, Decimal("5")))
        self.assertEqual(it.on_hand, Decimal("12"))
        self.assertTrue(it.sku.startswith("MPC"))
        scan = self.post("/api/pos/scan/", {"code": "8901234567890"}, self.cashier)   # now it sells
        self.assertTrue(scan["ok"], scan)
        self.assertEqual(Decimal(scan["total"]), Decimal("172.50"))

    def test_checks(self):
        base = {"code": "999", "name": "Test", "category": self.cat.pk, "price": "50", "gst": "0"}
        self.assertIn("above the MRP", self.post("/api/products/quick-add/", dict(base, mrp="40"), self.owner)["error"])
        self.assertIn("already belongs", self.post("/api/products/quick-add/", dict(base, code="111"), self.owner)["error"])
        self.assertIn("on the shelf", self.post("/api/products/quick-add/", dict(base, stock_required=True), self.owner)["error"])
        self.assertIn("whole number", self.post("/api/products/quick-add/", dict(base, stock="1.5"), self.owner)["error"])
        self.assertIn("already on sale", self.post("/api/products/quick-add/", dict(base, name="rice 1 KG"), self.owner)["error"])
        ok = self.post("/api/products/quick-add/", dict(base, unit="kg", stock="2.375", gst="0"), self.owner)
        it = Item.objects.get(pk=ok["item"]["id"])
        self.assertEqual((it.sale_unit, it.on_hand, it.tax_class), ("kg", Decimal("2.375"), TaxClass.EXEMPT))

    def test_activates_starter_candidate_instead_of_duplicating(self):
        cand = T.item("MPC00042", "Ponni Rice 5 kg", 300)
        cand.is_active, cand.price = False, None
        cand.save()
        n = Item.objects.count()
        ok = self.post("/api/products/quick-add/", {"candidate": cand.pk, "code": "555", "price": "295", "mrp": "310", "gst": "0", "stock": "4"}, self.owner)
        self.assertTrue(ok["ok"], ok)
        self.assertEqual(Item.objects.count(), n)
        cand.refresh_from_db()
        self.assertTrue(cand.is_active)
        self.assertEqual(Barcode.objects.get(code="555").item, cand)

    def test_quick_add_page_opens(self):
        self.c.force_login(self.owner)
        r = self.c.get("/products/quick/")
        self.assertContains(r, "Quick add products")
        self.assertContains(r, "qa-cats")
