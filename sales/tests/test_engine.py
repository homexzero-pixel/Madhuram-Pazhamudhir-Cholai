from decimal import Decimal

from django.test import TestCase

from core import testing as T
from core.money import inr, split_tax
from sales import services as S
from sales.models import DraftBill, Payment, Sale


class EngineTests(TestCase):
    def setUp(self):
        self.cashier = T.user("priya", "cashier")
        self.rice = T.item("TRYRICE", "Ponni rice · 1 kg", 75, barcode="8901000000017", stock_qty=20, cost=60)
        self.apple = T.item("TRYAPPLE", "Apple · loose", 180, unit="kg", plu="101", stock_qty=12, cost=120,
                            dept="Fresh produce", cat="Fruit")
        S.start_shift(self.cashier, 500)

    def test_first_bill(self):
        d = S.current_draft(self.cashier)
        for _ in range(2):
            r = S.resolve_code("8901000000017")
            S.add_item(d, r.item, r.qty)
        S.add_item(d, S.resolve_code("TRYAPPLE").item, "0.375")
        q = S.quote(d)
        self.assertEqual(q.total, Decimal("217.50"))
        sale, created = S.checkout(d.uuid, self.cashier, [{"method": "cash", "tendered": "250"}])
        self.assertTrue(created)
        self.assertEqual(sale.change, Decimal("32.50"))
        self.assertEqual(inr(sale.total), "₹217.50")
        again, created = S.checkout(d.uuid, self.cashier, [{"method": "cash", "tendered": "250"}])
        self.assertFalse(created)
        self.assertEqual(again.pk, sale.pk)
        self.assertEqual(Sale.objects.count(), 1)
        self.rice.refresh_from_db()
        self.assertEqual(self.rice.on_hand, Decimal("18"))

    def test_tax_split(self):
        self.assertEqual(split_tax(Decimal("105"), Decimal("5")), (Decimal("100.00"), Decimal("2.50"), Decimal("2.50")))
