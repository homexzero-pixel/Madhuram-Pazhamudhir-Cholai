"""The shop PC can hand its data to the cloud edition."""
import gzip
import json
import tempfile
from pathlib import Path

from django.core.management import call_command
from django.test import TestCase

from core import testing as T


class ExportForCloudTests(TestCase):
    def test_export_has_products_stock_customers_and_logins(self):
        T.user("kumar", "manager")
        T.item("RICE", "Ponni rice", 75, barcode="111", stock_qty=10, name_ta="பொன்னி அரிசி")
        out = Path(tempfile.mkdtemp()) / "x.json.gz"
        call_command("export_for_cloud", out=str(out), stdout=open("/dev/null", "w"))
        data = json.loads(gzip.open(out, "rt", encoding="utf-8").read())
        self.assertEqual(data["format"], "madhuram-cloud-export")
        rice = next(i for i in data["items"] if i["name"] == "Ponni rice")
        self.assertEqual((rice["price"], rice["barcodes"][0][0], rice["lots"][0]["qty"]), ("75.00", "111", "10.000"))
        u = next(u for u in data["users"] if u["username"] == "kumar")
        self.assertTrue(u["password_hash"].startswith("pbkdf2_sha256$") and u["pin_hash"].startswith("pbkdf2_sha256$"))
