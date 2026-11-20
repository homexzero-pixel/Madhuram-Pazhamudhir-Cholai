"""Helpers shared by the automated tests and the practice-data command."""
from datetime import timedelta
from decimal import Decimal

from django.utils import timezone

from accounts.models import User
from catalog.models import Barcode, BaseProduct, Category, Department, Item, TaxClass
from inventory import services as stock


def user(username, role, pin="1234", password="pass-1234"):
    u = User.objects.filter(username=username).first()
    if u:
        return u
    u = User.objects.create_user(username=username, password=password, role=role, first_name=username.title())
    u.set_pin(pin)
    u.save()
    return u


def item(sku, name, price, *, unit="pcs", barcode=None, stock_qty=None, cost=None, dept="Pantry", cat="Rice & millets",
         plu=None, mrp=None, tax_class=TaxClass.EXEMPT, gst=None, expiry=None, name_ta="", qty_per_scan=1, upp=1,
         track_expiry=False):
    d, _ = Department.objects.get_or_create(name=dept)
    c, _ = Category.objects.get_or_create(department=d, name=cat)
    b, _ = BaseProduct.objects.get_or_create(name=name.split("·")[0].strip(), defaults={"category": c})
    it = Item.objects.create(
        sku=sku, name=name, name_ta=name_ta, base=b, department=d, category=c, sale_unit=Item.KG if unit == "kg" else Item.PCS,
        price=Decimal(str(price)), mrp=Decimal(str(mrp if mrp is not None else price)), cost=Decimal(str(cost or 0)),
        is_active=True, plu=plu, tax_class=tax_class, gst_rate=gst, units_per_purchase=upp, track_expiry=track_expiry,
    )
    if barcode:
        Barcode.objects.create(code=barcode, item=it, qty_per_scan=qty_per_scan)
    if stock_qty:
        stock.add_lot(it, Decimal(str(stock_qty)), Decimal(str(cost or 0)), kind="opening", ref="OPENING", expiry=expiry)
    return it


def days(n):
    return timezone.localdate() + timedelta(days=n)
