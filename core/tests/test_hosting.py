from django.core.cache import cache
from django.test import Client, TestCase

from core import testing as T
from sales import services as S


class LockoutTests(TestCase):
    def setUp(self):
        cache.clear()
        self.cashier = T.user("priya", "cashier", password="right-pass-1")
        T.user("karthik", "manager")

    def test_login_locks_after_five_wrong_passwords(self):
        c = Client()
        for _ in range(5):
            r = c.post("/accounts/login/", {"username": "priya", "password": "wrong"})
            self.assertContains(r, "Wrong user name or password")
        r = c.post("/accounts/login/", {"username": "priya", "password": "right-pass-1"})
        self.assertContains(r, "Too many wrong attempts")
        self.assertNotIn("_auth_user_id", c.session)

    def test_approval_pin_locks_after_five_wrong_pins(self):
        T.item("RICE", "Rice", 75, barcode="111", stock_qty=5, mrp=80)
        S.start_shift(self.cashier, 0)
        d = S.current_draft(self.cashier)
        line = S.add_item(d, S.resolve_code("111").item, 1)
        for _ in range(5):
            with self.assertRaisesMessage(Exception, "PIN is wrong"):
                S.override_price(line, self.cashier, "70", "x", "karthik", "0000")
        with self.assertRaisesMessage(Exception, "Too many wrong attempts"):
            S.override_price(line, self.cashier, "70", "x", "karthik", "1234")
