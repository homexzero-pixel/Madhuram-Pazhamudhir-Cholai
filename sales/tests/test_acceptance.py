"""The store's acceptance tests (numbered as in the specification).

Tests 3 (restart), 10 (restore) and 11 (performance) need real processes and files and
run in scripts/run_acceptance.py; their core logic is also covered here.
"""
import json
from decimal import Decimal

from django.test import Client, TestCase, TransactionTestCase

from catalog.models import Item, TaxClass
from core import testing as T
from customers.models import Offer
from inventory.models import StockLot, StockMove
from purchasing import services as P
from purchasing.models import Supplier
from sales import services as S
from sales.models import DraftBill, Payment, Sale, SaleReturn, Shift

D = Decimal


class Base(TestCase):
    def setUp(self):
        self.cashier = T.user("priya", "cashier")
        self.manager = T.user("karthik", "manager")
        self.c = Client()
        self.c.force_login(self.cashier)

    def api(self, url, body=None):
        if body is None:
            return self.c.get(url, HTTP_ACCEPT="application/json").json()
        return self.c.post(url, json.dumps(body), content_type="application/json").json()


class A01_FirstBill(Base):
    def test_two_rice_and_weighed_apple_cash_250(self):
        T.item("TRYRICE", "Ponni rice · 1 kg", 75, barcode="8901000000019", stock_qty=20, cost=60)
        T.item("TRYAPPLE", "Apple · loose", 180, unit="kg", plu="101", stock_qty=12, cost=120, dept="Fresh produce", cat="Fruit")
        S.start_shift(self.cashier, 500)
        self.api("/api/pos/scan/", {"code": "8901000000019"})
        self.api("/api/pos/scan/", {"code": "8901000000019"})
        r = self.api("/api/pos/scan/", {"code": "TRYAPPLE"})
        self.assertTrue(r.get("needs_qty"), "weighed item must ask for the weight")
        st = self.api("/api/pos/scan/", {"code": "TRYAPPLE", "qty": "0.375"})
        self.assertEqual(st["total"], "217.50")
        self.assertEqual([l["qty"] for l in st["lines"]], ["2", "0.375"])
        done = self.api("/api/pos/checkout/", {"draft": st["draft"], "payments": [{"method": "cash", "tendered": "250"}]})
        self.assertTrue(done["ok"], done)
        self.assertEqual(done["sale_total"], "217.50")
        self.assertEqual(done["change"], "32.50")
        self.assertEqual(S.cash_summary(S.open_shift())["expected"], D("717.50"))


class A02_UnknownBarcode(Base):
    def test_basket_intact(self):
        T.item("TRYRICE", "Ponni rice · 1 kg", 75, barcode="8901000000019", stock_qty=20)
        S.start_shift(self.cashier, 0)
        before = self.api("/api/pos/scan/", {"code": "8901000000019"})
        r = self.api("/api/pos/scan/", {"code": "8909999999994"})
        self.assertFalse(r["ok"])
        self.assertEqual(r["unknown"], "8909999999994")
        self.assertEqual(r["lines"], before["lines"])
        self.assertEqual(r["total"], before["total"])
        # Never a 'similar' product: a prefix or near-miss of a real barcode is also unknown.
        for near in ("890100000001", "08901000000019", "8901000000018"):
            self.assertFalse(self.api("/api/pos/scan/", {"code": near})["ok"], near)
        # Cashier cannot link without approval; a manager PIN can.
        link = self.api("/api/pos/link-barcode/", {"code": "8909999999994", "item": Item.objects.get(sku="TRYRICE").pk})
        self.assertTrue(link.get("needs_approval"))
        link = self.api("/api/pos/link-barcode/", {"code": "8909999999994", "item": Item.objects.get(sku="TRYRICE").pk,
                                                   "approver": "karthik", "pin": "1234"})
        self.assertTrue(link["ok"], link)


class A03_LeadingZero(Base):
    def test_import_and_scan_leading_zero(self):
        from catalog import importer

        T.item("X1", "Seed item", 10)  # creates department/category
        csv_bytes = ("SKU,Barcode,English name,Department,Category,Sale unit,Selling price,MRP,Active,Status,GST treatment\n"
                     "OIL1L,0890105800007,Sunflower oil 1 L,Pantry,Oils,pcs,165,175,yes,verified,exempt\n").encode()
        headers, raw = importer.read_file("t.csv", csv_bytes)
        rows, summary = importer.preview(headers, raw)
        self.assertEqual(summary["error"], 0, [r.errors for r in rows])
        importer.apply(rows, self.manager, "t.csv")
        item = Item.objects.get(sku="OIL1L")
        self.assertEqual(item.barcodes.get().code, "0890105800007")
        self.assertEqual(S.resolve_code("0890105800007").item, item)
        self.assertIsNone(S.resolve_code("890105800007"))

    def test_excel_number_barcode_refused(self):
        import io

        import openpyxl

        from catalog import importer

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(["SKU", "Barcode", "English name"])
        ws.append(["OIL1L", 890105800007, "Oil"])
        buf = io.BytesIO()
        wb.save(buf)
        headers, raw = importer.read_file("t.xlsx", buf.getvalue())
        rows, summary = importer.preview(headers, raw)
        self.assertEqual(summary["error"], 1)
        self.assertIn("Leading zeros", rows[0].errors[0])


class A04_CartonConversion(Base):
    def test_two_cartons_of_24_sell_3_leaves_45(self):
        juice = T.item("JUICE200", "Mango drink 200 ml", 20, barcode="8900000000050", upp=24)
        sup = Supplier.objects.create(name="FMCG")
        P.receive(sup, self.manager, invoice_no="INV-1", invoice_date=T.days(0), invoice_total="672",
                  lines=[{"item": juice, "qty": 2, "unit_cost": "336"}])
        juice.refresh_from_db()
        self.assertEqual(juice.on_hand, D("48"))
        self.assertEqual(StockLot.objects.get(item=juice).unit_cost, D("14"))
        S.start_shift(self.cashier, 0)
        st = self.api("/api/pos/scan/", {"code": "8900000000050", "qty": "3"})
        self.assertEqual(st["lines"][0]["qty"], "3")
        self.assertTrue(self.api("/api/pos/checkout/", {"draft": st["draft"], "payments": [{"method": "upi", "amount": "60"}]})["ok"])
        juice.refresh_from_db()
        self.assertEqual(juice.on_hand, D("45"))
        # duplicate supplier invoice is refused
        with self.assertRaises(P.PurchaseError):
            P.receive(sup, self.manager, invoice_no="inv-1", invoice_date=T.days(0), invoice_total="1",
                      lines=[{"item": juice, "qty": 1, "unit_cost": "1"}])


class A05_FEFO(Base):
    def test_earliest_expiry_first_and_expired_blocked(self):
        milk = T.item("MILK", "Toned milk 500 ml", 28, barcode="8901000000101", track_expiry=True)
        sup = Supplier.objects.create(name="Dairy")
        P.receive(sup, self.manager, invoice_no="D-2", invoice_date=T.days(0), invoice_total="240",
                  lines=[{"item": milk, "qty": 10, "unit_cost": "24", "batch": "LATE", "expiry": T.days(5)}])
        P.receive(sup, self.manager, invoice_no="D-1", invoice_date=T.days(0), invoice_total="48",
                  lines=[{"item": milk, "qty": 2, "unit_cost": "24", "batch": "EARLY", "expiry": T.days(1)}])
        S.start_shift(self.cashier, 0)
        st = self.api("/api/pos/scan/", {"code": "8901000000101", "qty": "3"})
        self.assertTrue(self.api("/api/pos/checkout/", {"draft": st["draft"], "payments": [{"method": "upi", "amount": "84"}]})["ok"])
        early, late = StockLot.objects.get(batch="EARLY"), StockLot.objects.get(batch="LATE")
        self.assertEqual((early.qty, late.qty), (D(0), D(9)))
        # an expired lot cannot be sold
        StockLot.objects.filter(pk=late.pk).update(expiry=T.days(-1))
        r = self.api("/api/pos/scan/", {"code": "8901000000101"})
        self.assertFalse(r["ok"])
        self.assertIn("past expiry", r["error"])
        # and receiving already-expired stock is refused
        with self.assertRaises(P.PurchaseError):
            P.receive(sup, self.manager, invoice_no="D-3", invoice_date=T.days(0), invoice_total="24",
                      lines=[{"item": milk, "qty": 1, "unit_cost": "24", "batch": "OLD", "expiry": T.days(-2)}])


class A06_AllOrNothing(Base):
    def test_one_short_line_changes_nothing(self):
        rice = T.item("RICE", "Rice 1 kg", 75, barcode="111", stock_qty=10)
        dal = T.item("DAL", "Toor dal 1 kg", 160, barcode="222", stock_qty=5)
        S.start_shift(self.cashier, 0)
        self.api("/api/pos/scan/", {"code": "111"})
        st = self.api("/api/pos/scan/", {"code": "222", "qty": "2"})
        # Stock is reduced by another counter / write-off between scanning and payment.
        from inventory.services import remove_from_lot

        remove_from_lot(dal.lots.get(), 4, "damage", reason="dropped")
        moves, payments = StockMove.objects.count(), Payment.objects.count()
        r = self.api("/api/pos/checkout/", {"draft": st["draft"], "payments": [{"method": "cash", "tendered": "500"}]})
        self.assertFalse(r["ok"])
        self.assertIn("Not enough stock", r["error"])
        rice.refresh_from_db()
        self.assertEqual(rice.on_hand, D(10))
        self.assertEqual((Sale.objects.count(), Payment.objects.count(), StockMove.objects.count()), (0, payments, moves))
        self.assertEqual(DraftBill.objects.get(uuid=st["draft"]).status, DraftBill.OPEN)

    def test_double_click_creates_one_sale(self):
        T.item("RICE", "Rice 1 kg", 75, barcode="111", stock_qty=10)
        S.start_shift(self.cashier, 0)
        st = self.api("/api/pos/scan/", {"code": "111"})
        body = {"draft": st["draft"], "payments": [{"method": "cash", "tendered": "100"}]}
        a, b = self.api("/api/pos/checkout/", body), self.api("/api/pos/checkout/", body)
        self.assertEqual(a["sale"], b["sale"])
        self.assertFalse(b["created"])
        self.assertEqual(Sale.objects.count(), 1)
        self.assertEqual(Item.objects.get(sku="RICE").on_hand, D(9))


class A07_PrinterFailureReprint(Base):
    def test_reprint_does_not_create_sale(self):
        T.item("RICE", "Rice 1 kg", 75, barcode="111", stock_qty=10)
        S.start_shift(self.cashier, 0)
        st = self.api("/api/pos/scan/", {"code": "111"})
        done = self.api("/api/pos/checkout/", {"draft": st["draft"], "payments": [{"method": "cash", "tendered": "100"}]})
        # Printer fails: the print confirmation never arrives. The sale already exists once.
        self.assertEqual(Sale.objects.count(), 1)
        sale = Sale.objects.get()
        for _ in range(2):
            page = self.c.get(f"/sales/{sale.pk}/receipt/?print=1&reprint=1")
            self.assertContains(page, sale.bill_no)
            self.assertContains(page, "DUPLICATE")
            self.api(f"/api/sales/{sale.pk}/printed/", {"reprint": True})
        sale.refresh_from_db()
        self.assertEqual((Sale.objects.count(), sale.print_count, Payment.objects.count()), (1, 2, 1))
        self.assertEqual(Item.objects.get(sku="RICE").on_hand, D(9))
        self.assertEqual(done["bill_no"], sale.bill_no)


class A08_PartialReturn(Base):
    def test_return_one_of_discounted_multi_unit(self):
        rice = T.item("RICE", "Rice 1 kg", 75, barcode="111", stock_qty=10, cost=60)
        Offer.objects.create(name="Buy 3 at ₹70", kind=Offer.QTY, min_qty=3, deal_price=70, starts_on=T.days(-1), ends_on=T.days(1),
                             created_by=self.manager).items.add(rice)
        S.start_shift(self.cashier, 1000)
        st = self.api("/api/pos/scan/", {"code": "111", "qty": "3"})
        self.assertEqual((st["gross"], st["discount"], st["total"]), ("225.00", "15.00", "210.00"))
        self.assertEqual(st["lines"][0]["notes"], ["Buy 3 at ₹70"])
        done = self.api("/api/pos/checkout/", {"draft": st["draft"], "payments": [{"method": "cash", "tendered": "210"}]})
        sale = Sale.objects.get(pk=done["sale"])
        line = sale.lines.get()
        ret, _ = S.process_return(sale, self.manager, [{"line": line.pk, "qty": "1", "disposition": "sellable"}], method="cash",
                                  reason="Not needed")
        self.assertEqual(ret.total, D("70.00"))  # the discounted price actually paid, not ₹75
        line.refresh_from_db()
        self.assertEqual(line.returnable_qty, D(2))
        rice.refresh_from_db()
        self.assertEqual(rice.on_hand, D(8))  # 10 − 3 + 1 back to sellable
        # cannot return more than is left
        with self.assertRaises(S.BillingError):
            S.process_return(sale, self.manager, [{"line": line.pk, "qty": "3", "disposition": "sellable"}], method="cash", reason="x")
        # remaining two, to quarantine: exact remainder, total never exceeds the bill
        ret2, _ = S.process_return(sale, self.manager, [{"line": line.pk, "qty": "2", "disposition": "quarantine"}], method="cash", reason="Damaged")
        self.assertEqual(ret2.total, D("140.00"))
        self.assertEqual(sale.refunded, sale.total)
        rice.refresh_from_db()
        self.assertEqual(rice.on_hand, D(8))  # quarantined stock is not sellable
        self.assertEqual(StockLot.objects.filter(item=rice, status="quarantine").get().qty, D(2))
        # cashier without refund permission needs approval
        with self.assertRaises(Exception):
            S.process_return(sale, self.cashier, [{"line": line.pk, "qty": "1"}], method="cash", reason="x")

    def test_weighed_partial_return_and_loyalty_reversal(self):
        from customers.models import Customer

        apple = T.item("APPLE", "Apple loose", 180, unit="kg", plu="101", stock_qty=5, cost=120, dept="Fresh produce", cat="Fruit")
        cust = Customer.objects.create(name="Lakshmi", phone="9840012345")
        S.start_shift(self.cashier, 0)
        d = S.current_draft(self.cashier)
        d.customer = cust
        d.save()
        S.add_item(d, apple, "1.500")
        sale, _ = S.checkout(d.uuid, self.cashier, [{"method": "upi", "amount": "270"}])
        self.assertEqual(sale.points_earned, D(2))
        ret, _ = S.process_return(sale, self.manager, [{"line": sale.lines.get().pk, "qty": "0.500", "disposition": "waste"}],
                                  method="upi", reason="Bruised")
        self.assertEqual(ret.total, D("90.00"))
        self.assertEqual(ret.points_reversed, D("0.67"))
        self.assertEqual(cust.points, D("1.33"))


class A09_ShiftClose(Base):
    def test_only_cash_moves_the_drawer(self):
        from expenses.models import Expense, ExpenseCategory

        rice = T.item("RICE", "Rice 1 kg", 100, barcode="111", stock_qty=50)
        shift = S.start_shift(self.cashier, 1000)
        for method, extra in (("cash", {"tendered": "500"}), ("upi", {"amount": "200"}), ("card", {"amount": "300"})):
            d = S.current_draft(self.cashier)
            S.add_item(d, rice, {"cash": 3, "upi": 2, "card": 3}[method])
            S.checkout(d.uuid, self.cashier, [dict(method=method, **extra)])
        Expense.objects.create(category=ExpenseCategory.objects.first(), description="Tea", amount=D(50), method="cash", shift=shift,
                               created_by=self.cashier)
        Expense.objects.create(category=ExpenseCategory.objects.first(), description="Online ad", amount=D(400), method="upi",
                               created_by=self.manager)
        cash_sale = Sale.objects.order_by("id").first()
        upi_sale = Sale.objects.order_by("id")[1]
        S.process_return(cash_sale, self.manager, [{"line": cash_sale.lines.get().pk, "qty": "1", "disposition": "sellable"}], method="cash", reason="r")
        S.process_return(upi_sale, self.manager, [{"line": upi_sale.lines.get().pk, "qty": "1", "disposition": "sellable"}], method="upi", reason="r")
        summ = S.cash_summary(shift)
        # 1000 float + 300 cash sales − 100 cash refund − 50 cash expense; UPI, card, UPI refund and UPI expense ignored.
        self.assertEqual(summ["expected"], D("1150.00"))
        self.assertEqual((summ["tenders"]["upi"], summ["tenders"]["card"]), (D("200.00"), D("300.00")))
        closed = S.close_shift(shift, self.cashier, "1140", retained="1000")
        self.assertEqual((closed.expected, closed.variance, closed.retained_cash), (D("1150.00"), D("-10.00"), D("1000.00")))
        with self.assertRaises(Exception):
            S.reopen_shift(closed, self.cashier, "mistake")
        S.reopen_shift(closed, self.manager, "Count error")
        self.assertEqual(Shift.objects.get(pk=shift.pk).status, Shift.OPEN)


class A10_BackupRestore(TransactionTestCase):
    """Runs outside a test transaction, like the real app (backups are taken between requests)."""

    serialized_rollback = True

    def setUp(self):
        self.cashier = T.user("priya", "cashier")

    def test_backup_contains_last_bill_stock_and_shift(self):
        import tempfile

        from core.backup import make_backup, verify_backup

        rice = T.item("RICE", "Rice 1 kg", 75, barcode="111", stock_qty=10)
        shift = S.start_shift(self.cashier, 500)
        d = S.current_draft(self.cashier)
        S.add_item(d, rice, 2)
        sale, _ = S.checkout(d.uuid, self.cashier, [{"method": "cash", "tendered": "150"}])
        S.close_shift(shift, self.cashier, "650")
        with tempfile.TemporaryDirectory() as tmp:
            rep = verify_backup(make_backup(tmp, label="test"))
        self.assertEqual(rep["integrity"], "ok")
        self.assertEqual(rep["last_bill"]["bill_no"], sale.bill_no)
        self.assertEqual(D(rep["stock_units"]), D(8))
        self.assertEqual((D(str(rep["last_shift"]["expected"])), D(str(rep["last_shift"]["counted"]))), (D("650"), D("650")))


class ScaleLabels(Base):
    def test_weight_label_with_check_digit(self):
        from core.models import StoreSettings
        from core.scale import make_scale_label

        cfg = StoreSettings.load()
        cfg.scale_enabled = True
        cfg.save()
        T.item("APPLE", "Apple loose", 180, unit="kg", plu="101", stock_qty=5)
        code = make_scale_label("101", D("0.375"), cfg)
        self.assertEqual(code[:7], "2000101")
        r = S.resolve_code(code)
        self.assertEqual((r.item.sku, r.qty), ("APPLE", D("0.375")))
        bad = code[:-1] + str((int(code[-1]) + 1) % 10)
        with self.assertRaises(ValueError):
            S.resolve_code(bad)
        cfg.scale_value_type, cfg.scale_value_decimals = "price", 2
        cfg.save()
        r = S.resolve_code(make_scale_label("101", D("67.50"), cfg))
        self.assertEqual(r.qty, D("0.375"))


class Permissions(Base):
    def test_cashier_cannot_open_admin_pages(self):
        for url in ("/settings/staff/", "/settings/edit/store/", "/reports/dashboard/", "/purchases/grn/new/", "/products/new/"):
            r = self.c.get(url)
            self.assertEqual(r.status_code, 302, url)

    def test_price_override_needs_pin_and_is_audited(self):
        from core.models import AuditLog

        T.item("RICE", "Rice 1 kg", 75, barcode="111", stock_qty=10, mrp=80)
        S.start_shift(self.cashier, 0)
        st = self.api("/api/pos/scan/", {"code": "111"})
        lid = st["lines"][0]["id"]
        r = self.api(f"/api/pos/line/{lid}/price/", {"price": "70", "reason": "shelf tag"})
        self.assertTrue(r.get("needs_approval"))
        r = self.api(f"/api/pos/line/{lid}/price/", {"price": "90", "reason": "x", "approver": "karthik", "pin": "1234"})
        self.assertIn("above MRP", r["error"])
        r = self.api(f"/api/pos/line/{lid}/price/", {"price": "70", "reason": "shelf tag", "approver": "karthik", "pin": "1234"})
        self.assertEqual(r["total"], "70.00")
        a = AuditLog.objects.get(action="price_override")
        self.assertEqual((a.user, a.approved_by.username), (self.cashier, "karthik"))
