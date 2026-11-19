"""Product import from CSV or Excel: parse → preview (row errors, duplicates) → apply all-or-nothing → undo.

Blank cells leave existing values unchanged. Barcodes, SKUs, PLUs and HSN codes are
always read as text so leading zeros survive.
"""
import csv
import io
from dataclasses import dataclass, field
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from core.models import audit
from core.money import D

from .models import Barcode, BaseProduct, Category, Department, ImportBatch, Item, TaxClass

COLUMNS = [
    ("SKU", "sku", "Required. Store code, e.g. MPC00003. Existing SKU = update."),
    ("Barcode", "barcode", "Manufacturer barcode exactly as printed. Format the column as Text in Excel."),
    ("Barcode units per scan", "qty_per_scan", "1 normally; 24 if this barcode is on a carton of 24 of this SKU."),
    ("PLU", "plu", "Short code for loose produce / scale labels."),
    ("English name", "name", "Required for a new SKU. Include brand and pack."),
    ("Tamil name", "name_ta", ""),
    ("Brand", "brand", ""),
    ("Department", "department", "Required for a new SKU."),
    ("Category", "category", "Required for a new SKU."),
    ("Subcategory", "subcategory", ""),
    ("Base product", "base", "e.g. Ponni rice. Defaults to the English name."),
    ("Variant", "variant", ""),
    ("Pack size", "pack_size", "e.g. 1 kg, 500 ml, 6 × 200 g, Loose kg"),
    ("Purchase unit", "purchase_unit", "e.g. carton, bag, kg"),
    ("Sale unit", "sale_unit", "pcs or kg. kg = sold by weight."),
    ("Sale units per purchase unit", "units_per_purchase", "e.g. 24 bottles per carton."),
    ("MRP", "mrp", "₹"),
    ("Purchase cost", "cost", "₹ per sale unit"),
    ("Selling price", "price", "₹ per piece, or per kg for weighed items. GST inclusive."),
    ("HSN", "hsn", "4, 6 or 8 digits, as confirmed by the accountant."),
    ("GST treatment", "tax_class", "taxable / exempt / nil / non_gst / unset"),
    ("GST rate", "gst_rate", "% for taxable items, e.g. 5"),
    ("Preferred supplier", "supplier", "Supplier name exactly as in Suppliers."),
    ("Reorder level", "reorder_level", ""),
    ("Shelf location", "shelf", ""),
    ("Batch tracking", "track_batch", "yes / no"),
    ("Expiry tracking", "track_expiry", "yes / no"),
    ("Active", "is_active", "yes = can be sold (needs a price)"),
    ("Status", "status", "verified / candidate"),
]
ALIASES = {
    "product name": "name", "pack barcode": "barcode", "mrp inr": "mrp", "selling price inr": "price", "pack": "pack_size",
    "gst rate %": "gst_rate", "selling price": "price", "english name": "name", "tamil name": "name_ta",
}
HEADER_TO_KEY = {h.lower(): k for h, k, _ in COLUMNS}
HEADER_TO_KEY.update(ALIASES)
TEXT_KEYS = {"sku", "barcode", "plu", "hsn"}
YES = {"yes", "y", "true", "1"}
NO = {"no", "n", "false", "0"}


@dataclass
class Row:
    line: int
    data: dict
    errors: list = field(default_factory=list)
    warnings: list = field(default_factory=list)
    action: str = ""  # create / update / unchanged / error
    changes: dict = field(default_factory=dict)


def read_file(name, content: bytes):
    """Return (headers, list of dict of str) from CSV or XLSX bytes."""
    if name.lower().endswith((".xlsx", ".xlsm")):
        import openpyxl

        wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        ws = wb.worksheets[0]
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            return [], []
        headers = [str(h or "").strip() for h in rows[0]]
        out = []
        for r in rows[1:]:
            d = {}
            for h, v in zip(headers, r):
                if isinstance(v, (int, float)) and HEADER_TO_KEY.get(h.lower()) in TEXT_KEYS:
                    d[h] = ("__NUMBER__", v)
                else:
                    d[h] = "" if v is None else (str(v).strip() if not isinstance(v, float) else repr(v))
            out.append(d)
        return headers, out
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    return [h.strip() for h in (reader.fieldnames or [])], [{(k or "").strip(): (v or "").strip() for k, v in r.items()} for r in reader]


def _bool(v, row, label):
    s = str(v).strip().lower()
    if s in YES:
        return True
    if s in NO:
        return False
    row.errors.append(f"{label}: use yes or no.")
    return None


def preview(headers, raw_rows):
    """Validate everything without writing. Returns (rows, summary)."""
    from purchasing.models import Supplier

    keys = {h: HEADER_TO_KEY.get(h.lower()) for h in headers}
    if "sku" not in keys.values():
        return [], {"fatal": "The file needs a SKU column. Download the template to see the headings."}
    unknown = [h for h, k in keys.items() if k is None and h]
    rows, seen_sku, seen_bc, seen_plu = [], {}, {}, {}
    existing = {i.sku: i for i in Item.objects.filter(sku__in=[(r.get(next(h for h in headers if keys[h] == "sku")) or "").strip().upper() for r in raw_rows])}
    suppliers = {s.name.lower(): s for s in Supplier.objects.all()}
    for n, raw in enumerate(raw_rows, start=2):
        data = {}
        row = Row(n, data)
        for h, v in raw.items():
            k = keys.get(h)
            if not k:
                continue
            if isinstance(v, tuple):
                row.errors.append(f"{h} was saved as a number in Excel ({v[1]}). Leading zeros may be lost: format the column as Text and re-enter.")
                continue
            if v != "":
                data[k] = v
        if not any(data.values()):
            continue
        sku = data.get("sku", "").upper()
        data["sku"] = sku
        if not sku:
            row.errors.append("SKU is missing.")
        elif sku in seen_sku:
            row.errors.append(f"SKU {sku} appears again on row {seen_sku[sku]}.")
        else:
            seen_sku[sku] = n
        for key, seen, label in (("barcode", seen_bc, "Barcode"), ("plu", seen_plu, "PLU")):
            v = data.get(key)
            if v:
                if v in seen:
                    row.errors.append(f"{label} {v} also on row {seen[v]}.")
                seen[v] = n
        bc = data.get("barcode")
        if bc:
            if len(bc) > 32 or " " in bc:
                row.errors.append("Barcode looks wrong (spaces or too long).")
            other = Barcode.objects.filter(code=bc).exclude(item__sku=sku).select_related("item").first()
            if other:
                row.errors.append(f"Barcode {bc} already belongs to {other.item.sku} {other.item.name}.")
        plu = data.get("plu")
        if plu and Item.objects.filter(plu=plu).exclude(sku=sku).exists():
            row.errors.append(f"PLU {plu} already used by another SKU.")
        for k in ("mrp", "cost", "price", "gst_rate", "reorder_level", "units_per_purchase", "qty_per_scan"):
            if k in data:
                try:
                    v = D(data[k])
                    if v < 0:
                        raise ValueError
                    data[k] = v
                except ValueError:
                    row.errors.append(f"{k.replace('_', ' ').title()} '{data[k]}' is not a valid number.")
        if "sale_unit" in data:
            su = data["sale_unit"].lower()
            data["sale_unit"] = {"pack": "pcs", "pcs": "pcs", "pc": "pcs", "piece": "pcs", "kg": "kg"}.get(su)
            if not data["sale_unit"]:
                row.errors.append("Sale unit must be pcs or kg.")
        if "tax_class" in data:
            tc = data["tax_class"].lower().replace("-", "_").replace(" ", "_")
            if tc not in TaxClass.values:
                row.errors.append("GST treatment must be taxable, exempt, nil, non_gst or unset.")
            data["tax_class"] = tc
        if data.get("hsn") and not (data["hsn"].isdigit() and len(data["hsn"]) in (4, 6, 8)):
            row.errors.append("HSN must be 4, 6 or 8 digits.")
        if data.get("tax_class") == "taxable" and "gst_rate" not in data and not (existing.get(sku) and existing[sku].gst_rate is not None):
            row.errors.append("Taxable items need a GST rate.")
        if isinstance(data.get("mrp"), Decimal) and isinstance(data.get("price"), Decimal) and data["price"] > data["mrp"]:
            row.errors.append("Selling price is above MRP.")
        for k, label in (("track_batch", "Batch tracking"), ("track_expiry", "Expiry tracking"), ("is_active", "Active")):
            if k in data:
                data[k] = _bool(data[k], row, label)
        if "status" in data:
            data["status"] = data["status"].lower()
            if data["status"] not in ("verified", "candidate"):
                row.errors.append("Status must be verified or candidate.")
        if data.get("supplier"):
            s = suppliers.get(data["supplier"].lower())
            if s is None:
                row.errors.append(f"Supplier '{data['supplier']}' not found. Add it in Suppliers first.")
            data["supplier"] = s
        item = existing.get(sku)
        if item is None and not row.errors:
            missing = [lbl for k, lbl in (("name", "English name"), ("department", "Department"), ("category", "Category"), ("sale_unit", "Sale unit")) if not data.get(k)]
            if missing:
                row.errors.append("New SKU needs: " + ", ".join(missing) + ".")
        if item is not None and data.get("sale_unit") and data["sale_unit"] != item.sale_unit and (item.on_hand or item.sale_lines.exists()):
            row.errors.append("Cannot change pcs/kg on a SKU that has stock or sales. Create a new SKU.")
        if data.get("is_active") and not (data.get("price") or (item and item.price)):
            row.errors.append("An active item needs a selling price.")
        if row.errors:
            row.action = "error"
        elif item is None:
            row.action = "create"
        else:
            for k, v in data.items():
                if k in ("sku", "department", "category", "base", "barcode", "qty_per_scan"):
                    continue
                cur = getattr(item, "preferred_supplier" if k == "supplier" else k, None)
                if (cur if not isinstance(cur, Decimal) else cur.normalize()) != (v if not isinstance(v, Decimal) else v.normalize()):
                    row.changes[k] = (cur, v)
            if data.get("barcode") and not item.barcodes.filter(code=data["barcode"]).exists():
                row.changes["barcode"] = ("", data["barcode"])
            row.action = "update" if row.changes else "unchanged"
        rows.append(row)
    summary = {k: sum(1 for r in rows if r.action == k) for k in ("create", "update", "unchanged", "error")}
    summary["unknown_columns"] = unknown
    summary["total"] = len(rows)
    return rows, summary


FIELDS = ["name", "name_ta", "brand", "subcategory", "variant", "pack_size", "purchase_unit", "sale_unit", "units_per_purchase",
          "mrp", "cost", "price", "hsn", "tax_class", "gst_rate", "reorder_level", "shelf", "track_batch", "track_expiry",
          "is_active", "status", "plu"]


def _snapshot(item):
    snap = {f: (str(getattr(item, f)) if isinstance(getattr(item, f), Decimal) else getattr(item, f)) for f in FIELDS}
    snap["preferred_supplier_id"] = item.preferred_supplier_id
    return snap


@transaction.atomic
def apply(rows, user, filename):
    if any(r.action == "error" for r in rows):
        raise ValueError("Fix the rows with errors first. Nothing was imported.")
    batch = ImportBatch.objects.create(user=user, filename=filename[:200])
    undo = {"created": [], "updated": {}, "barcodes": []}
    for r in rows:
        if r.action == "unchanged":
            continue
        d = r.data
        if r.action == "create":
            dept, _ = Department.objects.get_or_create(name=d["department"])
            cat, _ = Category.objects.get_or_create(department=dept, name=d["category"])
            base, _ = BaseProduct.objects.get_or_create(name=d.get("base") or d["name"], defaults={"category": cat})
            item = Item(sku=d["sku"], base=base, department=dept, category=cat, name=d["name"])
            undo["created"].append(d["sku"])
        else:
            item = Item.objects.get(sku=d["sku"])
            undo["updated"][item.sku] = _snapshot(item)
            if d.get("department") or d.get("category"):
                dept, _ = Department.objects.get_or_create(name=d.get("department") or item.department.name)
                cat, _ = Category.objects.get_or_create(department=dept, name=d.get("category") or item.category.name)
                item.department, item.category = dept, cat
        for f in FIELDS:
            if f in d and d[f] is not None:
                setattr(item, f, d[f])
        if "supplier" in d:
            item.preferred_supplier = d["supplier"]
        item.save()
        if d.get("barcode") and not Barcode.objects.filter(code=d["barcode"]).exists():
            Barcode.objects.create(code=d["barcode"], item=item, qty_per_scan=d.get("qty_per_scan") or 1, note=f"Import {batch.pk}")
            undo["barcodes"].append(d["barcode"])
    batch.created_items = len(undo["created"])
    batch.updated_items = len(undo["updated"])
    batch.barcodes_added = len(undo["barcodes"])
    batch.undo = undo
    batch.save()
    audit("import", f"Product import {filename}: {batch.created_items} new, {batch.updated_items} updated, {batch.barcodes_added} barcodes",
          user=user, obj=batch)
    return batch


@transaction.atomic
def undo_batch(batch, user):
    if batch.undone_at:
        raise ValueError("This import was already undone.")
    later = ImportBatch.objects.filter(pk__gt=batch.pk, undone_at__isnull=True).exists()
    if later:
        raise ValueError("Undo the later imports first (newest first).")
    u = batch.undo
    Barcode.objects.filter(code__in=u.get("barcodes", [])).delete()
    for sku, snap in u.get("updated", {}).items():
        item = Item.objects.get(sku=sku)
        for f in FIELDS:
            v = snap.get(f)
            setattr(item, f, Decimal(v) if isinstance(v, str) and f in ("units_per_purchase", "mrp", "cost", "price", "gst_rate", "reorder_level") and v not in ("None",) else (None if v == "None" else v))
        item.preferred_supplier_id = snap.get("preferred_supplier_id")
        item.save()
    for sku in u.get("created", []):
        item = Item.objects.filter(sku=sku).first()
        if item and (item.lots.exists() or item.sale_lines.exists()):
            raise ValueError(f"{sku} already has stock or sales; cannot undo its creation.")
        if item:
            item.barcodes.all().delete()
            item.delete()
    batch.undone_at = timezone.now()
    batch.save(update_fields=["undone_at"])
    audit("import_undo", f"Undid product import {batch.pk} ({batch.filename})", user=user, obj=batch)


def template_rows():
    return [[h for h, _, _ in COLUMNS], [n for _, _, n in COLUMNS]]
