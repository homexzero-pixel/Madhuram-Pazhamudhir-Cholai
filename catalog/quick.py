"""Quick add: create (or activate) a sellable product in one step – from the billing counter when a new
barcode is scanned, or from Products → Quick add. Barcode, price, GST and opening stock in one transaction."""
import re
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import Max

from core.models import audit

from .models import Barcode, BaseProduct, Category, Item, TaxClass

GST_CHOICES = [("0", "0 % – exempt (fresh fruit, vegetables, milk, eggs…)"), ("5", "5 %"), ("12", "12 %"), ("18", "18 %"),
               ("28", "28 %"), ("", "Not sure – accountant to set")]


class QuickAddError(ValueError):
    pass


def _dec(v, label, places=2, required=False):
    v = ("" if v is None else str(v)).strip().replace(",", "").replace("₹", "")
    if not v:
        if required:
            raise QuickAddError(f"Enter the {label}.")
        return None
    try:
        d = Decimal(v)
    except InvalidOperation:
        raise QuickAddError(f"{label.capitalize()} must be a number.") from None
    if d < 0 or d != d.quantize(Decimal(1).scaleb(-places)):
        raise QuickAddError(f"{label.capitalize()} must be 0 or more, with at most {places} decimals.")
    return d


def next_sku():
    last = Item.objects.filter(sku__regex=r"^MPC[0-9]{5,}$").aggregate(m=Max("sku"))["m"]
    n = int(last[3:]) + 1 if last else 1
    while Item.objects.filter(sku=f"MPC{n:05d}").exists():
        n += 1
    return f"MPC{n:05d}"


@transaction.atomic
def quick_add(data, user, approved_by=None):
    """data: code, name, name_ta, category, unit (pcs|kg), mrp, price, gst ('' = not set), hsn, stock, cost, candidate.
    Returns the sellable Item."""
    from inventory.services import add_lot

    code = (data.get("code") or "").strip()
    if code and (len(code) > 32 or re.search(r"\s", code)):
        raise QuickAddError("A barcode has no spaces and at most 32 characters.")
    if code and Barcode.objects.filter(code=code).exists():
        b = Barcode.objects.select_related("item").get(code=code)
        raise QuickAddError(f"Barcode {code} already belongs to {b.item.sku} {b.item.name}.")
    name = " ".join((data.get("name") or "").split())
    candidate = Item.objects.filter(pk=data.get("candidate")).first() if data.get("candidate") else None
    if not name and not candidate:
        raise QuickAddError("Enter the product name as printed on the pack.")
    price = _dec(data.get("price"), "selling price", required=True)
    if price <= 0:
        raise QuickAddError("The selling price must be more than ₹0.")
    mrp = _dec(data.get("mrp"), "MRP")
    if mrp is not None and price > mrp:
        raise QuickAddError(f"The selling price ₹{price} is above the MRP ₹{mrp}. Selling above MRP is not allowed.")
    unit = data.get("unit") or Item.PCS
    if unit not in dict(Item.SALE_UNITS):
        raise QuickAddError("Choose pieces or kg.")
    stock = _dec(data.get("stock"), "opening stock", places=3)
    if stock is not None and unit == Item.PCS and stock != stock.to_integral_value():
        raise QuickAddError("Opening stock in pieces must be a whole number.")
    if data.get("stock_required") and not stock:
        raise QuickAddError("Count how many are on the shelf now and enter it as opening stock (at least the quantity being sold).")
    cost = _dec(data.get("cost"), "purchase cost", places=4)
    gst = (data.get("gst") if data.get("gst") is not None else "").strip()
    if gst not in {c for c, _ in GST_CHOICES}:
        raise QuickAddError("Choose the GST rate.")

    if candidate:  # activate a product from the starter catalogue instead of creating a duplicate
        item, created = candidate, False
        if name:
            item.name = name[:160]
    else:
        same = Item.objects.filter(name__iexact=name, is_active=True).first()
        if same and not data.get("allow_duplicate"):
            raise QuickAddError(f"{same.name} is already on sale as {same.sku} at ₹{same.price}. If this pack is the same product, "
                                "go back and choose “link this barcode”; if it is different, add the size or brand to the name.")
        cat = Category.objects.filter(pk=data.get("category")).select_related("department").first()
        if not cat:
            raise QuickAddError("Choose the category.")
        base_name = name[:120]
        base = BaseProduct.objects.filter(name__iexact=base_name).first() or BaseProduct.objects.create(
            name=base_name, name_ta=(data.get("name_ta") or "")[:120], category=cat)
        item, created = Item(sku=next_sku(), base=base, department=cat.department, category=cat, name=name[:160]), True
    if data.get("name_ta"):
        item.name_ta = data["name_ta"].strip()[:160]
    item.sale_unit = unit
    item.price, item.mrp = price, mrp
    if cost is not None:
        item.cost = cost
    if gst == "":
        item.tax_class, item.gst_rate = TaxClass.UNSET, None
    elif gst == "0":
        item.tax_class, item.gst_rate = TaxClass.EXEMPT, Decimal(0)
    else:
        item.tax_class, item.gst_rate = TaxClass.TAXABLE, Decimal(gst)
    if data.get("hsn"):
        item.hsn = str(data["hsn"]).strip()[:8]
    item.status, item.is_active = Item.VERIFIED, True
    item.save()
    if code:
        Barcode.objects.create(code=code, item=item, qty_per_scan=1, note=f"Quick add by {user.username}")
    if stock:
        add_lot(item, stock, cost if cost is not None else (item.cost or Decimal(0)), kind="opening",
                ref=f"QUICK-{item.sku}", user=user, reason="Opening stock entered at quick add")
    audit("product_create" if created else "product_verify",
          f"{'Quick-added' if created else 'Activated'} {item.sku} {item.name} at ₹{price}"
          f"{f' (MRP ₹{mrp})' if mrp else ''}, GST {gst or 'not set'}{f', barcode {code}' if code else ''}"
          f"{f', opening stock {stock}' if stock else ''}", user=user, approved_by=approved_by if approved_by != user else None, obj=item)
    return item
