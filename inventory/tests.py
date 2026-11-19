from decimal import Decimal

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from accounts.tests import make_user

from .models import Category, Product, Purchase


class PurchaseStockTests(TestCase):
    def setUp(self):
        self.manager = make_user("mgr", "Manager")
        self.client.login(username="mgr", password="pass12345!")
        self.product = Product.objects.create(
            name="Mango", category=Category.objects.create(name="Fruits"), selling_price=Decimal("90"), stock=Decimal("5")
        )

    def _post(self, url, **data):
        payload = {"purchased_on": timezone.localdate(), "product": self.product.pk, "quantity": "10", "unit_cost": "60"}
        payload.update(data)
        return self.client.post(url, payload)

    def test_purchase_adds_stock_and_updates_cost(self):
        self._post(reverse("purchase_create"))
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, Decimal("15"))
        self.assertEqual(self.product.cost_price, Decimal("60"))
        self.assertEqual(Purchase.objects.get().total_cost, Decimal("600.00"))

    def test_edit_and_delete_purchase_adjusts_stock(self):
        self._post(reverse("purchase_create"))
        purchase = Purchase.objects.get()
        self._post(reverse("purchase_edit", args=[purchase.pk]), quantity="4")
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, Decimal("9"))
        self.client.post(reverse("purchase_delete", args=[purchase.pk]))
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, Decimal("5"))

    def test_product_api(self):
        data = self.client.get(reverse("api_products"), {"q": "man"}).json()
        self.assertEqual(data["results"][0]["name"], "Mango")
