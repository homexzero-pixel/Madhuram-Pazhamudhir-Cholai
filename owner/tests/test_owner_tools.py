"""Owner tools: today's prices, buy list, loss watch, day summary, credit reminders."""
from decimal import Decimal

from django.test import Client, TestCase
from django.utils import timezone

from catalog.models import Item
from core import testing as T
from core.models import AuditLog, StoreSettings
from owner import buylist, daysummary, losswatch, prices
from sales import services as S


class OwnerToolsTests(TestCase):
    def setUp(self):
        self.owner = T.user("meena", "owner")
        self.cashier = T.user("priya", "cashier")
        self.mgr = T.user("ravi", "manager", pin="4321")
        self.apple = T.item("APPLE", "Apple · Loose kg", 180, unit="kg", plu="101", stock_qty=5, cost=120, mrp=None,
                            dept="Fresh produce", cat="Fruits")
        self.rice = T.item("RICE", "Rice 1 kg", 75, barcode="111", stock_qty=3, cost=60, mrp=80)
        Item.objects.filter(pk=self.apple.pk).update(mrp=None)      # loose produce has no MRP
        self.apple.refresh_from_db()

    def sell(self, item, qty):
        d = S.current_draft(self.cashier)
        S.add_item(d, item, qty)
        q = S.quote(d)
        return S.checkout(d.uuid, self.cashier, [{"method": "cash", "tendered": str(q.total)}])[0]

    def test_todays_prices_all_or_nothing_and_audited(self):
        with self.assertRaises(ValueError):            # rice above MRP → nothing saved, not even the apple
            prices.apply({self.apple.pk: {"price": "200"}, self.rice.pk: {"price": "85"}}, self.owner)
        self.apple.refresh_from_db(); self.assertEqual(self.apple.price, Decimal("180"))
        n = prices.apply({self.apple.pk: {"price": "200", "cost": "140"}, self.rice.pk: {"price": "78"}}, self.owner)
        self.assertEqual(n, 2)
        self.apple.refresh_from_db()
        self.assertEqual((self.apple.price, self.apple.cost), (Decimal("200"), Decimal("140")))
        self.assertEqual(AuditLog.objects.filter(action="price_change", summary__startswith="Today's prices").count(), 2)
        self.assertEqual(list(prices.items_for("loose")), [self.apple])

    def test_prices_page_saves_only_changed_boxes(self):
        c = Client(); c.force_login(self.owner)
        r = c.post("/owner/prices/?f=all", {f"p_{self.apple.pk}": "190", f"op_{self.apple.pk}": "180.00",
                                            f"p_{self.rice.pk}": "75.00", f"op_{self.rice.pk}": "75.00"})
        self.assertEqual(r.status_code, 302)
        self.apple.refresh_from_db(); self.assertEqual(self.apple.price, Decimal("190"))
        self.assertEqual(AuditLog.objects.filter(action="price_change").count(), 1)
        self.assertContains(c.get("/owner/prices/board/?f=loose"), "₹190.00")

    def test_buy_list_from_sales(self):
        S.start_shift(self.cashier, 500)
        self.sell(self.apple, "3.5")                   # 3.5 kg sold today; 1.5 kg left
        self.sell(self.rice, 2)
        groups = buylist.build(days=1, fresh_cover=1, other_cover=7)
        rows = {r["item"].sku: r for g in groups for r in g["rows"]}
        self.assertEqual(rows["APPLE"]["qty"], Decimal("2.0"))    # need 3.5 for tomorrow, have 1.5 → 2.0 kg (rounded to 0.5)
        self.assertEqual(rows["RICE"]["qty"], Decimal("13"))      # 2/day × 7 days = 14, have 1 → 13
        self.assertIn("Rice 1 kg – 13 pc", buylist.message(groups[0], "Madhuram"))

    def test_loss_watch_flags_cancels_and_shortage(self):
        sh = S.start_shift(self.cashier, 500)
        self.sell(self.rice, 1)
        for _ in range(2):
            d = S.current_draft(self.cashier)
            S.add_item(d, self.rice, 1)
            S.cancel(d, self.cashier, "customer left", approver="ravi", pin="4321")
        S.close_shift(sh, self.mgr, "550")             # expected 575 → ₹25 short
        row = [r for r in losswatch.build(timezone.localdate(), timezone.localdate()) if r["user"] == self.cashier][0]
        self.assertEqual(row["r"]["bill_cancel"], 2)
        self.assertEqual(row["r"]["bill_cancel_value"], Decimal("150.00"))
        self.assertTrue(any("cancelled" in f for f in row["flags"]))
        self.assertTrue(any("cash short by ₹25.00" in f for f in row["flags"]))
        self.assertTrue(any("never printed" in f for f in row["flags"]))

    def test_day_summary_and_credit_reminder(self):
        from customers.models import Customer
        S.start_shift(self.cashier, 500)
        self.sell(self.rice, 1)
        cfg = StoreSettings.load(); cfg.owner_whatsapp = "98765 43210"; cfg.save()
        text = daysummary.day_text(timezone.localdate(), cfg)
        self.assertIn("Net sales: *₹75.00* (1 bills", text)
        self.assertIn("no shift closed yet", text)
        c = Client(); c.force_login(self.owner)
        self.assertContains(c.get("/owner/day-summary/"), "whatsapp://send?phone=919876543210")
        cust = Customer.objects.create(name="Lakshmi", phone="9123456780", credit_allowed=True, credit_limit=2000)
        cust.credit_entries.create(amount=Decimal("450"), kind="sale")
        self.assertIn("₹450.00", daysummary.credit_reminder_text(cust, cfg))
        self.assertContains(c.get("/owner/credit-reminders/"), "Send reminder")

    def test_cashier_cannot_open_owner_tools(self):
        c = Client(); c.force_login(self.cashier)
        for u in ("/owner/", "/owner/prices/", "/owner/loss-watch/", "/owner/buy-list/", "/owner/credit-reminders/", "/owner/day-summary/"):
            self.assertIn(c.get(u).status_code, (302, 403), u)
