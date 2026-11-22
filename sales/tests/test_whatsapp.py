"""Free WhatsApp bills: correct number, correct message, never for another cashier's bill, audited."""
import json
from urllib.parse import unquote

from django.test import Client, TestCase

from core import testing as T
from core.models import AuditLog, StoreSettings
from sales import services as S
from sales.whatsapp import PhoneError, normalise_phone


class WhatsAppBillTests(TestCase):
    def setUp(self):
        self.cashier = T.user("priya", "cashier")
        self.other = T.user("kavi", "cashier")
        rice = T.item("RICE", "Rice 1 kg", 75, barcode="111", stock_qty=10, mrp=80)
        S.start_shift(self.cashier, 500)
        d = S.current_draft(self.cashier)
        S.add_item(d, rice, 2)
        self.sale, _ = S.checkout(d.uuid, self.cashier, [{"method": "cash", "tendered": "200"}])
        self.c = Client()

    def post(self, who, body, pk=None):
        self.c.force_login(who)
        return json.loads(self.c.post(f"/api/sales/{pk or self.sale.pk}/whatsapp/", json.dumps(body), content_type="application/json").content)

    def test_phone_numbers(self):
        for raw in ("98765 43210", "+91 98765-43210", "098765 43210", "919876543210"):
            self.assertEqual(normalise_phone(raw), "919876543210")
        for bad in ("12345", "5876543210", "", "98765 4321"):
            with self.assertRaises(PhoneError):
                normalise_phone(bad)

    def test_message_and_links(self):
        d = self.post(self.cashier, {"phone": "98765 43210"})
        self.assertTrue(d["ok"], d)
        self.assertTrue(d["app"].startswith("whatsapp://send?phone=919876543210&text="))
        self.assertTrue(d["web"].startswith("https://wa.me/919876543210?text="))
        text = unquote(d["web"].split("text=", 1)[1])
        self.assertEqual(text, d["text"])
        for part in (self.sale.bill_no, "Rice 1 kg", "2 pc × ₹75.00 = ₹150.00", "*TOTAL: ₹150.00*", "Cash ₹200.00 · Change ₹50.00", "You saved ₹10.00"):
            self.assertIn(part, text)
        log = AuditLog.objects.filter(action="bill_whatsapp").get()
        self.assertIn("+91 98xxxxxx10", log.summary)          # the full number is not kept in the log
        self.assertNotIn("9876543210", log.summary)

    def test_refusals(self):
        self.assertIn("10-digit", self.post(self.cashier, {"phone": "12345"})["error"])
        r = self.c.post(f"/api/sales/{self.sale.pk}/whatsapp/", json.dumps({"phone": "9876543210"}), content_type="application/json")
        self.c.force_login(self.other)
        r = self.c.post(f"/api/sales/{self.sale.pk}/whatsapp/", json.dumps({"phone": "9876543210"}), content_type="application/json")
        self.assertEqual(r.status_code, 404)                 # another cashier cannot send this bill
        cfg = StoreSettings.load(); cfg.whatsapp_enabled = False; cfg.save()
        self.assertIn("turned off", self.post(self.cashier, {"phone": "9876543210"})["error"])
