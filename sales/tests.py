from decimal import Decimal

from django.test import TestCase
from django.urls import reverse

from accounts.tests import make_user
from inventory.models import Category, Product

from .models import Sale


class BillingTests(TestCase):
    def setUp(self):
        self.cashier = make_user("cash", "Cashier")
        self.client.login(username="cash", password="pass12345!")
        fruits = Category.objects.create(name="Fruits")
        self.apple = Product.objects.create(name="Apple", category=fruits, selling_price=Decimal("180"),
                                            cost_price=Decimal("140"), stock=Decimal("10"))
        self.banana = Product.objects.create(name="Banana", category=fruits, unit="dozen",
                                             selling_price=Decimal("55"), cost_price=Decimal("40"), stock=Decimal("3"))

    def add(self, product, qty):
        self.client.post(reverse("cart_add"), {"product": product.pk, "quantity": qty})

    def test_checkout_creates_bill_and_reduces_stock(self):
        self.add(self.apple, "1.5")
        self.add(self.banana, "2")
        response = self.client.post(reverse("checkout"), {
            "payment_method": "cash", "amount_received": "500", "discount": "10",
        })
        sale = Sale.objects.get()
        self.assertRedirects(response, reverse("sale_receipt", args=[sale.pk]))
        self.assertEqual(sale.subtotal, Decimal("380.00"))
        self.assertEqual(sale.total, Decimal("370.00"))
        self.assertEqual(sale.change_due, Decimal("130.00"))
        self.assertEqual(sale.items.count(), 2)
        self.apple.refresh_from_db()
        self.assertEqual(self.apple.stock, Decimal("8.5"))
        self.assertEqual(self.client.get(reverse("sale_receipt", args=[sale.pk])).status_code, 200)

    def test_cannot_oversell(self):
        self.add(self.banana, "5")
        self.client.post(reverse("checkout"), {"payment_method": "upi"})
        self.assertFalse(Sale.objects.exists())
        self.banana.refresh_from_db()
        self.assertEqual(self.banana.stock, Decimal("3"))

    def test_short_cash_rejected(self):
        self.add(self.apple, "1")
        self.client.post(reverse("checkout"), {"payment_method": "cash", "amount_received": "100"})
        self.assertFalse(Sale.objects.exists())

    def test_void_restores_stock_and_needs_manager(self):
        self.add(self.apple, "2")
        self.client.post(reverse("checkout"), {"payment_method": "upi"})
        sale = Sale.objects.get()
        self.client.post(reverse("sale_void", args=[sale.pk]))
        sale.refresh_from_db()
        self.assertEqual(sale.status, Sale.STATUS_COMPLETED)  # cashier not allowed

        make_user("mgr", "Manager")
        self.client.login(username="mgr", password="pass12345!")
        self.client.post(reverse("sale_void", args=[sale.pk]))
        sale.refresh_from_db()
        self.apple.refresh_from_db()
        self.assertEqual(sale.status, Sale.STATUS_VOID)
        self.assertEqual(self.apple.stock, Decimal("10"))

    def test_bill_numbers_are_sequential(self):
        for _ in range(2):
            self.add(self.apple, "1")
            self.client.post(reverse("checkout"), {"payment_method": "upi"})
        first, second = Sale.objects.order_by("id").values_list("bill_no", flat=True)
        self.assertTrue(second.endswith("0002") and first.endswith("0001"))

    def test_cashier_only_sees_own_bills(self):
        other = make_user("other", "Cashier")
        Sale.objects.create(bill_no="X1", cashier=other, total=10)
        self.assertEqual(self.client.get(reverse("sale_detail", args=[Sale.objects.get().pk])).status_code, 404)
