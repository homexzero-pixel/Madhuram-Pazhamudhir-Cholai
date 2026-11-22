"""Billing screen: product tiles to tap (search, category, best sellers) and the customer picker."""
import json

from django.test import Client, TestCase

from core import testing as T
from customers.models import Customer
from sales import services as S


class CounterPanelTests(TestCase):
    def setUp(self):
        self.cashier = T.user("priya", "cashier")
        self.rice = T.item("RICE", "Ponni rice · 1 kg", 75, barcode="111", stock_qty=10, name_ta="பொன்னி அரிசி")
        self.apple = T.item("APPLE", "Apple · Loose kg", 180, unit="kg", plu="101", stock_qty=5, dept="Fresh produce", cat="Fruits")
        self.c = Client(); self.c.force_login(self.cashier)

    def get(self, url):
        return json.loads(self.c.get(url).content)

    def test_tiles_search_category_and_best_sellers(self):
        self.assertEqual([i["sku"] for i in self.get("/api/pos/tiles/?q=அரிசி")["results"]], ["RICE"])
        self.assertEqual([i["sku"] for i in self.get("/api/pos/tiles/?cat=kg")["results"]], ["APPLE"])
        self.assertEqual([i["sku"] for i in self.get(f"/api/pos/tiles/?cat={self.apple.category_id}")["results"]], ["APPLE"])
        S.start_shift(self.cashier, 500)
        d = S.current_draft(self.cashier); S.add_item(d, self.rice, 1)
        S.checkout(d.uuid, self.cashier, [{"method": "cash", "tendered": "75"}])
        self.assertEqual(self.get("/api/pos/tiles/?cat=top")["results"][0]["sku"], "RICE")    # best seller first
        page = self.c.get("/billing/").content.decode()
        self.assertIn('id="tq"', page)
        self.assertIn("Fruits", page)

    def test_tap_adds_pieces_and_asks_weight_for_loose(self):
        S.start_shift(self.cashier, 500)
        r = json.loads(self.c.post("/api/pos/add/", json.dumps({"item": self.rice.pk}), content_type="application/json").content)
        self.assertTrue(r["ok"]); self.assertEqual(r["total"], "75.00")
        r = json.loads(self.c.post("/api/pos/add/", json.dumps({"item": self.apple.pk}), content_type="application/json").content)
        self.assertTrue(r["needs_qty"])

    def test_customer_search_by_name_words_phone_and_recent(self):
        Customer.objects.create(name="Senthil Kumar", phone="9840054321")
        lak = Customer.objects.create(name="Lakshmi R", phone="9840012345", name_ta="லட்சுமி")
        Customer.objects.create(name="Hotel Annapoorna", phone="9840099999", credit_allowed=True, credit_limit=5000)
        names = lambda q: [c["name"] for c in self.get("/api/customers/search/?q=" + q)["results"]]
        self.assertEqual(names("sent"), ["Senthil Kumar"])
        self.assertEqual(names("kumar sen"), ["Senthil Kumar"])          # words in any order
        self.assertEqual(names("லட்சு"), ["Lakshmi R"])                 # Tamil name
        self.assertEqual(names("12345"), ["Lakshmi R"])                 # any part of the phone
        self.assertEqual(len(names("")), 3)                               # empty search shows customers straight away
        S.start_shift(self.cashier, 500)
        d = S.current_draft(self.cashier); d.customer = lak; d.save(); S.add_item(d, self.rice, 1)
        S.checkout(d.uuid, self.cashier, [{"method": "cash", "tendered": "75"}])
        self.assertEqual(names("")[0], "Lakshmi R")                       # most recent buyer first
        r = json.loads(self.c.post("/api/pos/customer/", json.dumps({"clear": True}), content_type="application/json").content)
        self.assertIsNone(r["customer"])
