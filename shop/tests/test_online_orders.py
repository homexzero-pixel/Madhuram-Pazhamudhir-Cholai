"""Online shop and several counters: a customer orders, staff bill it at a counter, stock and cash follow the normal rules."""
import json
from datetime import timedelta
from decimal import Decimal

from django.test import Client, TestCase
from django.utils import timezone

from core import counter
from core import testing as T
from core.models import StoreSettings
from sales import services as S
from shop import services as SH
from shop.models import OnlineOrder


def first_slot():
    return timezone.localtime(SH.slots()[0][1][0]).strftime(SH.SLOT_FMT)


class OnlineOrderTests(TestCase):
    def setUp(self):
        cfg = StoreSettings.load()
        cfg.online_enabled = True
        cfg.online_open, cfg.online_close = "00:00", "23:59"
        cfg.online_lead_minutes, cfg.online_min_order, cfg.online_delivery_charge, cfg.online_free_delivery_above = 30, 100, 30, 500
        cfg.public_url = "https://billing.example.in"
        cfg.save()
        self.cashier = T.user("priya", "cashier")
        self.rice = T.item("RICE", "Ponni rice · 1 kg", 75, barcode="111", stock_qty=10, name_ta="பொன்னி அரிசி")
        self.apple = T.item("APPLE", "Apple · Loose kg", 180, unit="kg", plu="101", stock_qty=5, dept="Fresh produce", cat="Fruits")
        self.c = Client()

    def order(self, **kw):
        body = {"name": "Lakshmi", "phone": "98400 12345", "mode": "pickup", "slot": first_slot(),
                "lines": [{"id": self.rice.pk, "qty": 2}, {"id": self.apple.pk, "qty": 0.75}]}
        body.update(kw)
        return json.loads(self.c.post("/shop/api/order/", json.dumps(body), content_type="application/json").content)

    def test_customer_sees_stock_orders_and_tracks(self):
        page = self.c.get("/shop/")
        self.assertContains(page, "Scan")
        items = json.loads(self.c.get("/shop/api/items/?q=அரிசி").content)["items"]
        self.assertEqual([i["name"] for i in items], ["Ponni rice · 1 kg"])
        self.assertEqual(json.loads(self.c.get("/shop/api/items/?code=111").content)["items"][0]["available"], "10")
        r = self.order()
        self.assertTrue(r["ok"], r)
        o = OnlineOrder.objects.get()
        self.assertEqual((o.number, o.est_items, o.delivery_charge, o.phone), ("ON-00001", Decimal("285.00"), Decimal("0"), "919840012345"))
        # reserved: the shop page now shows less available
        self.assertEqual(json.loads(self.c.get("/shop/api/items/?code=111").content)["items"][0]["available"], "8")
        self.assertContains(self.c.get(r["url"]), "ON-00001")

    def test_checks(self):
        self.assertIn("Only 10", self.order(lines=[{"id": self.rice.pk, "qty": 11}])["error"])
        self.assertIn("whole pieces", self.order(lines=[{"id": self.rice.pk, "qty": 1.5}])["error"])
        self.assertIn("address", self.order(mode="delivery", address="")["error"])
        self.assertIn("Minimum order", self.order(mode="delivery", address="12 Main Road, near temple", lines=[{"id": self.rice.pk, "qty": 1}])["error"])
        self.assertIn("time slot", self.order(slot="2001-01-01T10:00")["error"])
        self.assertIn("10-digit", self.order(phone="123")["error"])
        self.assertFalse(self.order(website="spam")["ok"])
        d = self.order(mode="delivery", address="12 Main Road, near temple", lines=[{"id": self.rice.pk, "qty": 2}])
        self.assertTrue(d["ok"], d)
        self.assertEqual(OnlineOrder.objects.get().delivery_charge, Decimal("30"))     # below free-delivery level
        cfg = StoreSettings.load(); cfg.online_enabled = False; cfg.save()
        self.assertIn("closed", self.order()["error"])

    def test_staff_bill_the_order_at_counter_2(self):
        self.order(mode="delivery", address="12 Main Road, near temple")
        o = OnlineOrder.objects.get()
        self.assertEqual(o.delivery_charge, Decimal("30"))
        tok = counter.use("Counter 2")
        try:
            S.start_shift(self.cashier, 500)
            draft = SH.load_to_counter(o, self.cashier)
            self.assertEqual(draft.lines.count(), 3)                    # rice, apple, delivery charge
            q = S.quote(draft)
            sale, _ = S.checkout(draft.uuid, self.cashier, [{"method": "cash", "tendered": str(q.total)}])
        finally:
            counter.reset(tok)
        o.refresh_from_db()
        self.assertEqual((o.status, o.sale, sale.shift.counter), (OnlineOrder.DONE, sale, "Counter 2"))
        self.assertEqual(sale.total, Decimal("315.00"))
        self.rice.refresh_from_db(); self.apple.refresh_from_db()
        self.assertEqual((self.rice.on_hand, self.apple.on_hand), (Decimal("8"), Decimal("4.25")))
        self.assertEqual(sale.customer.phone, "9840012345")
        self.assertIn("complete", SH.status_message(o))

    def test_staff_screens_and_badge(self):
        self.order()
        o = OnlineOrder.objects.get()
        self.c.force_login(self.cashier)
        self.assertEqual(json.loads(self.c.get("/orders/api/badge/").content)["new"], 1)
        self.assertContains(self.c.get("/orders/"), "ON-00001")
        page = self.c.get(f"/orders/{o.pk}/")
        self.assertContains(page, "whatsapp://send?phone=919840012345")
        self.c.post(f"/orders/{o.pk}/action/", {"act": "accept"})
        self.c.post(f"/orders/{o.pk}/action/", {"act": "cancel", "note": ""})
        o.refresh_from_db(); self.assertEqual(o.status, OnlineOrder.ACCEPTED)       # cancel needs a reason
        self.c.post(f"/orders/{o.pk}/action/", {"act": "cancel", "note": "Out of apples"})
        o.refresh_from_db(); self.assertEqual(o.status, OnlineOrder.CANCELLED)
        self.assertEqual(json.loads(self.c.get("/shop/api/items/?code=111").content)["items"][0]["available"], "10")   # released


class CounterTests(TestCase):
    def test_each_counter_has_its_own_shift_and_shared_bill_series(self):
        a, b = T.user("priya", "cashier"), T.user("kavi", "cashier")
        rice = T.item("RICE", "Rice", 75, barcode="111", stock_qty=10)
        bills = []
        for user, name in ((a, "Counter 1"), (b, "Counter 2")):
            tok = counter.use(name)
            try:
                S.start_shift(user, 100)
                d = S.current_draft(user); S.add_item(d, rice, 1)
                bills.append(S.checkout(d.uuid, user, [{"method": "cash", "tendered": "75"}])[0])
                self.assertEqual(S.open_shift().cashier, user)
            finally:
                counter.reset(tok)
        self.assertEqual([s.shift.counter for s in bills], ["Counter 1", "Counter 2"])
        self.assertEqual([s.bill_no[-5:] for s in bills], ["00001", "00002"])
        self.assertEqual(S.open_shifts().count(), 2)
        c = Client(); c.force_login(a)
        r = c.post("/counter/", {"name": "Counter 3", "next": "/billing/"})
        self.assertEqual(r.cookies["mpc_counter"].value, "Counter 3")
        c.cookies["mpc_counter"] = "Counter 2"
        self.assertEqual(json.loads(c.get("/api/pos/state/").content)["counter"], "Counter 2")

    def test_host_check(self):
        from core.counter import host_allowed
        cfg = StoreSettings.load(); cfg.public_url = "https://billing.example.in"; cfg.save()
        for ok in ("127.0.0.1:8765", "192.168.1.20:8765", "10.0.0.5", "shop-server:8765", "billing.example.in", "localhost"):
            self.assertTrue(host_allowed(ok), ok)
        for bad in ("evil.com", "8.8.8.8", ""):
            self.assertFalse(host_allowed(bad), bad)


class CounterShortcutTests(TestCase):
    def test_counter_number_address_sets_this_pc(self):
        r = Client().get("/counter/3/")
        self.assertEqual((r.status_code, r["Location"], r.cookies["mpc_counter"].value), (302, "/billing/", "Counter 3"))
