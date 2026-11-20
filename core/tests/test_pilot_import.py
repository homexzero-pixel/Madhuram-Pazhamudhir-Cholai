import importlib.util
import tempfile
from decimal import Decimal
from pathlib import Path

from django.conf import settings
from django.core.management import call_command
from django.test import TestCase

from catalog.models import Item
from core import testing as T
from inventory.models import StockLot
from sales.models import Sale, SaleReturn, Shift

D = Decimal


def pilot_store():
    spec = importlib.util.spec_from_file_location("pilot_store", Path(settings.BASE_DIR) / "legacy_pilot" / "store.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.Store


class PilotImportTests(TestCase):
    def test_pilot_database_is_carried_over(self):
        T.user("owner", "owner")
        with tempfile.TemporaryDirectory() as tmp:
            cat = Path(tmp) / "cat.csv"
            cat.write_text("SKU,Product name,Department,Category,Sale unit\nMPC00003,Ponni rice · Standard · 500 g,Pantry,Rice & millets,pack\n", encoding="utf-8")
            db = Path(tmp) / "counter.sqlite"
            s = pilot_store()(db, cat)
            s.setup("TRYAPPLE", "Apple · loose", "Practice", "Fruit", "kg", "", "180", "180")
            s.setup("TRYRICE", "Ponni rice · 1 kg", "Practice", "Rice & millets", "pack", "0890105800007", "75", "80")
            s.receive("TRYAPPLE", "12", "120", "Koyambedu", "INV-1", "B1", "")
            s.receive("TRYRICE", "20", "60", "Dindigul", "INV-2", "", "")
            s.set_tax("TRYRICE", "1006", "5")
            s.open("Priya", "500")
            sale = s.checkout({"TRYRICE": "2", "TRYAPPLE": "0.375"}, "Cash", "250", "Lakshmi")
            line = s.db.execute("select id from line where sale_id=? and sku='TRYAPPLE'", (sale,)).fetchone()[0]
            s.refund(line, "bruised")
            s.expense("Tea", "40", "Cash", "staff tea")
            s.close("610")  # 500 float + 217.50 cash sale − 67.50 cash refund − 40 cash expense
            s.db.close()
            call_command("import_pilot", str(db), verbosity=0)
        rice = Item.objects.get(sku="TRYRICE")
        self.assertEqual((rice.price, rice.mrp, rice.gst_rate, rice.hsn), (D("75.00"), D("80.00"), D("5.00"), "1006"))
        self.assertEqual(rice.barcodes.get().code, "0890105800007")
        self.assertEqual(rice.on_hand, D("18"))
        apple = Item.objects.get(sku="TRYAPPLE")
        self.assertEqual(apple.on_hand, D("11.625"))
        self.assertEqual(StockLot.objects.get(item=apple).batch, "B1")
        bill = Sale.objects.get(bill_no="PILOT-000001")
        self.assertEqual((bill.total, bill.change, bill.lines.count()), (D("217.50"), D("32.50"), 2))
        self.assertEqual(SaleReturn.objects.get().total, D("67.50"))
        shift = Shift.objects.get(counter="Pilot counter")
        self.assertEqual((shift.counted, shift.variance, shift.expected), (D("610.00"), D("0.00"), D("610.00")))
