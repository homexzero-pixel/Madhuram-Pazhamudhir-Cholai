from decimal import Decimal

from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse

from accounts.models import User
from store.templatetags.cholai import money, qty


class FilterTests(TestCase):
    def test_money_uses_indian_grouping(self):
        self.assertEqual(money(Decimal("1234567.5")), "₹12,34,567.50")
        self.assertEqual(money(999), "₹999.00")
        self.assertEqual(money(-1500), "-₹1,500.00")

    def test_qty_trims_zeros(self):
        self.assertEqual(qty(Decimal("2.500")), "2.5")
        self.assertEqual(qty(Decimal("3.000")), "3")


class ReportPagesTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_demo", days=5, verbosity=0)

    def setUp(self):
        self.client.force_login(User.objects.get(username="manager"))

    def test_pages_render(self):
        for name in ["dashboard", "report_overview", "report_stock", "product_list", "purchase_list",
                     "expense_list", "sale_list", "pos", "supplier_list", "category_list", "expense_category_list"]:
            self.assertEqual(self.client.get(reverse(name)).status_code, 200, name)

    def test_csv_exports(self):
        for kind in ["sales", "purchases", "expenses", "stock"]:
            response = self.client.get(reverse("report_export", args=[kind]))
            self.assertEqual(response.status_code, 200, kind)
            self.assertIn("text/csv", response["Content-Type"])

    def test_admin_pages_render(self):
        self.client.force_login(User.objects.get(username="admin"))
        for name in ["staff_list", "role_list", "store_settings", "staff_create", "profile", "change_password"]:
            self.assertEqual(self.client.get(reverse(name)).status_code, 200, name)
