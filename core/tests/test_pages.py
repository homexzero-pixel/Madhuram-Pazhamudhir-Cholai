"""Integration tests over the real screens, on top of the practice data set."""
import io
import json
from decimal import Decimal

from django.core.management import call_command
from django.test import Client, TestCase

from accounts.models import User
from catalog.models import Category, ImportBatch, Item
from customers.models import Customer
from expenses.models import ExpenseCategory
from inventory.models import StockCount
from purchasing.models import GoodsReceipt, PurchaseOrder, Supplier
from reports.registry import R
from sales import services as S
from sales.models import DraftBill, Payment, Settlement, Shift

D = Decimal


class PageTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_demo", days=2, verbosity=0)

    def setUp(self):
        self.owner = Client()
        self.owner.force_login(User.objects.get(username="owner"))
        self.cashier = Client()
        self.cashier.force_login(User.objects.get(username="cashier"))

    def api(self, client, url, body=None):
        if body is None:
            return client.get(url, HTTP_ACCEPT="application/json").json()
        return client.post(url, json.dumps(body), content_type="application/json").json()

    def test_every_page_and_report_opens(self):
        sale = S.Sale.objects.first() if hasattr(S, "Sale") else None
        from sales.models import Sale

        sale = Sale.objects.first()
        item = Item.objects.filter(is_active=True).first()
        self.assertRedirects(self.owner.get("/"), "/reports/dashboard/")
        urls = ["/reports/dashboard/", "/billing/", "/products/", "/products/?status=candidate&q=ponni", f"/products/{item.pk}/",
                f"/products/{item.pk}/edit/", "/products/import/", "/products/labels/?ids=" + str(item.pk), "/products/practice-barcodes/",
                "/purchases/", "/purchases/orders/new/", "/purchases/grn/new/", "/purchases/returns/new/?supplier=1", "/purchases/suppliers/",
                "/inventory/", "/inventory/counts/", "/inventory/ledger/", "/sales/", f"/sales/{sale.pk}/", f"/sales/{sale.pk}/receipt/",
                f"/sales/{sale.pk}/receipt/?w=58", f"/sales/{sale.pk}/receipt/?w=a4", "/customers/", "/customers/offers/", "/expenses/",
                "/cash/", "/cash/settlements/", "/reports/", "/settings/", "/settings/edit/store/", "/settings/edit/hardware/?test=2000101003759",
                "/settings/staff/", "/settings/backups/", "/settings/audit/", "/products/import/template.xlsx", "/products/import/template.csv"]
        urls += [f"/inventory/?view={v}" for v in ("low", "out", "expiry", "expired", "dead", "quarantine", "wastage", "lots")]
        for key in R:
            urls += [f"/reports/view/?report={key}", f"/reports/view/?report={key}&format=csv", f"/reports/view/?report={key}&format=xlsx"]
        for u in urls:
            self.assertEqual(self.owner.get(u).status_code, 200, u)

    def test_cashier_is_kept_out_of_back_office(self):
        for u in ("/reports/dashboard/", "/settings/staff/", "/purchases/grn/new/", "/products/import/", "/inventory/counts/", "/expenses/"):
            self.assertEqual(self.cashier.get(u).status_code, 302, u)
        self.assertEqual(self.cashier.get("/billing/").status_code, 200)

    def test_purchase_order_partial_delivery(self):
        item = Item.objects.filter(is_active=True, sale_unit="pcs").exclude(sku__startswith="TRY").first()
        sup = Supplier.objects.first()
        before = item.on_hand
        r = self.owner.post("/purchases/orders/new/", {"supplier": sup.pk, "lcount": 1, "l0-code": item.sku, "l0-qty": "10", "l0-unit_cost": "50"})
        po = PurchaseOrder.objects.latest("id")
        self.assertRedirects(r, f"/purchases/orders/{po.pk}/")
        line = po.lines.get()
        r = self.owner.post("/purchases/grn/new/", {"po": po.pk, "lcount": 1, "l0-code": item.sku, "l0-qty": "4", "l0-free_qty": "1",
                                                    "l0-damaged_qty": "1", "l0-units_per_purchase": "1", "l0-unit_cost": "50",
                                                    "l0-po_line": line.pk, "invoice_no": "T-100", "invoice_date": "2026-11-01", "invoice_total": "200"})
        grn = GoodsReceipt.objects.get(invoice_no="T-100")
        self.assertRedirects(r, f"/purchases/grn/{grn.pk}/")
        po.refresh_from_db()
        item.refresh_from_db()
        self.assertEqual(po.status, PurchaseOrder.PARTIAL)
        self.assertEqual(item.on_hand, before + 4)  # 4 billed + 1 free − 1 damaged
        self.assertEqual(grn.invoice_difference, D("0.00"))
        # same invoice again is refused
        self.owner.post("/purchases/grn/new/", {"po": po.pk, "lcount": 1, "l0-code": item.sku, "l0-qty": "1", "l0-unit_cost": "50",
                                                "l0-po_line": line.pk, "invoice_no": "t-100", "invoice_date": "2026-11-01", "invoice_total": "50"})
        self.assertEqual(GoodsReceipt.objects.filter(supplier=sup, invoice_no__iexact="t-100").count(), 1)
        self.assertContains(self.owner.get(f"/purchases/suppliers/{sup.pk}/"), "T-100")

    def test_import_preview_apply_undo(self):
        csv = ("SKU,English name,Selling price,MRP,Barcode\nMPC00003,Ponni rice · Brand X · 500 g,36,40,0890000000016\n"
               "MPC00004,Toor dal · Brand Y · 250 g,50,45,\nNEW1,,10,10,\n")
        f = io.BytesIO(csv.encode())
        f.name = "upd.csv"
        self.assertRedirects(self.owner.post("/products/import/", {"file": f}), "/products/import/preview/")
        page = self.owner.get("/products/import/preview/")
        self.assertContains(page, "Selling price is above MRP")
        self.assertContains(page, "New SKU needs")
        self.owner.post("/products/import/apply/")
        self.assertFalse(ImportBatch.objects.exists())  # errors block the whole file
        csv = "SKU,English name,Selling price,MRP,Barcode\nMPC00003,Ponni rice · Brand X · 500 g,36,40,0890000000016\n"
        f = io.BytesIO(csv.encode())
        f.name = "ok.csv"
        self.owner.post("/products/import/", {"file": f})
        self.owner.post("/products/import/apply/")
        it = Item.objects.get(sku="MPC00003")
        self.assertEqual((it.price, it.barcodes.get().code), (D("36"), "0890000000016"))
        self.owner.post(f"/products/import/{ImportBatch.objects.get().pk}/undo/")
        it.refresh_from_db()
        self.assertEqual((it.price, it.barcodes.count()), (None, 0))

    def test_stocktake_with_approval(self):
        cat = Category.objects.get(name="Rice & millets", department__name="Pantry")
        self.owner.post("/inventory/counts/", {"category": cat.pk, "title": "Rice count"})
        sc = StockCount.objects.latest("id")
        line = sc.lines.select_related("item").first()
        data = {f"c{l.pk}": str(l.expected) for l in sc.lines.all()}
        data[f"c{line.pk}"] = str(line.expected - 1)
        data[f"r{line.pk}"] = "one pack missing"
        data["action"] = "approve"
        self.owner.post(f"/inventory/counts/{sc.pk}/", data)
        sc.refresh_from_db()
        line.item.refresh_from_db()
        self.assertEqual(sc.status, StockCount.APPROVED)
        self.assertEqual(line.item.on_hand, line.expected - 1)

    def test_cash_expense_credit_sale_collection_and_close(self):
        cashier = User.objects.get(username="cashier")
        shift = S.open_shift()
        start = S.cash_summary(shift)["expected"]
        self.owner.post("/expenses/new/", {"spent_on": "2026-11-20", "category": ExpenseCategory.objects.first().pk, "description": "Ice",
                                           "amount": "30", "method": "cash", "reference": "V1"})
        self.assertEqual(S.cash_summary(shift)["expected"], start - 30)
        cust = Customer.objects.get(phone="9840099999")  # practice credit customer
        rice = Item.objects.get(sku="TRYRICE")
        st = self.api(self.cashier, "/api/pos/scan/", {"code": "TRYRICE"})
        self.api(self.cashier, "/api/pos/customer/", {"id": cust.pk})
        r = self.api(self.cashier, "/api/pos/checkout/", {"draft": st["draft"], "payments": [{"method": "credit", "amount": "75"}]})
        self.assertTrue(r.get("needs_approval"), r)  # cashier needs a manager to approve credit
        r = self.api(self.cashier, "/api/pos/checkout/", {"draft": st["draft"], "payments": [{"method": "credit", "amount": "75"}],
                                                          "approver": "manager", "pin": "1234"})
        self.assertTrue(r["ok"], r)
        self.assertEqual(cust.credit_balance, D("75"))
        self.owner.post(f"/customers/{cust.pk}/collect/", {"amount": "75", "method": "cash"})
        self.assertEqual(cust.credit_balance, D("0"))
        self.assertEqual(S.cash_summary(shift)["expected"], start - 30 + 75)  # credit sale: no cash; collection: cash in
        expected = S.cash_summary(shift)["expected"]
        self.owner.post(f"/cash/shift/{shift.pk}/close/", {"counted": str(expected), "retained": "1000"})
        shift.refresh_from_db()
        self.assertEqual((shift.status, shift.variance), (Shift.CLOSED, D("0")))
        self.assertEqual(rice.lots.count() > 0, True)

    def test_hold_recall_cancel(self):
        st = self.api(self.cashier, "/api/pos/scan/", {"code": "TRYRICE"})
        self.api(self.cashier, "/api/pos/hold/", {"label": "Lakshmi"})
        st2 = self.api(self.cashier, "/api/pos/state/")
        self.assertEqual(st2["lines"], [])
        self.assertEqual(st2["held"][0]["label"], "Lakshmi")
        self.api(self.cashier, "/api/pos/scan/", {"code": "TRYOIL1L"})
        r = self.api(self.cashier, f"/api/pos/recall/{st2['held'][0]['id']}/", {})
        self.assertFalse(r["ok"])  # finish or hold the bill on screen first
        self.api(self.cashier, "/api/pos/cancel/", {"reason": "customer left"})
        r = self.api(self.cashier, f"/api/pos/recall/{st2['held'][0]['id']}/", {})
        self.assertEqual([l["sku"] for l in r["lines"]], ["TRYRICE"])
        self.assertEqual(DraftBill.objects.filter(status="cancelled").count(), 1)

    def test_settlement_with_fees(self):
        unsettled = sum((p.amount for p in Payment.objects.filter(method="upi", settlement__isnull=True)), D(0))
        self.owner.post("/cash/settlements/new/", {"method": "upi", "upto": "2026-12-31", "credited": str(unsettled - 5), "fees": "5"})
        st = Settlement.objects.get()
        self.assertEqual((st.expected, st.difference), (unsettled, D("0")))
        self.assertFalse(Payment.objects.filter(method="upi", settlement__isnull=True).exists())
