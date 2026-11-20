import csv
import io
import json
import uuid
from pathlib import Path

from django import forms
from django.conf import settings
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.core.paginator import Paginator
from django.db import transaction
from django.db.models import Q
from django.http import Http404, HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from accounts.permissions import require
from cholai.forms import BootstrapMixin
from core.barcodes import svg_any, svg_code128
from core.models import StoreSettings, audit

from . import importer
from .models import Barcode, BaseProduct, Category, Department, ImportBatch, Item


class ItemForm(BootstrapMixin, forms.ModelForm):
    base_name = forms.CharField(label="Base product", max_length=120, help_text="What it is, shared by every brand/pack, e.g. Ponni rice.")

    class Meta:
        model = Item
        fields = ["sku", "plu", "name", "name_ta", "brand", "variant", "pack_size", "department", "category", "subcategory",
                  "sale_unit", "purchase_unit", "units_per_purchase", "mrp", "cost", "price", "hsn", "tax_class", "gst_rate",
                  "preferred_supplier", "reorder_level", "shelf", "track_batch", "track_expiry", "status", "is_active"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance.pk:
            self.fields["base_name"].initial = self.instance.base.name
            self.fields["sku"].disabled = True
            if self.instance.on_hand or self.instance.sale_lines.exists():
                self.fields["sale_unit"].disabled = True
                self.fields["sale_unit"].help_text = "Fixed: this SKU already has stock or sales. Create a new SKU to sell it differently."

    def clean_sku(self):
        return self.cleaned_data["sku"].strip().upper()

    def clean_plu(self):
        return (self.cleaned_data.get("plu") or "").strip() or None

    def clean_hsn(self):
        h = (self.cleaned_data.get("hsn") or "").strip()
        if h and not (h.isdigit() and len(h) in (4, 6, 8)):
            raise forms.ValidationError("HSN must be 4, 6 or 8 digits.")
        return h

    def clean(self):
        c = super().clean()
        if c.get("category") and c.get("department") and c["category"].department_id != c["department"].pk:
            self.add_error("category", "This category belongs to a different department.")
        if c.get("price") is not None and c.get("mrp") is not None and c["price"] > c["mrp"]:
            self.add_error("price", "Selling price is above MRP.")
        if c.get("is_active") and c.get("price") is None:
            self.add_error("is_active", "Set a selling price before making the item active.")
        if c.get("tax_class") == "taxable" and c.get("gst_rate") is None:
            self.add_error("gst_rate", "Enter the GST rate for a taxable item.")
        return c

    def save(self, commit=True):
        item = super().save(commit=False)
        base, _ = BaseProduct.objects.get_or_create(name=self.cleaned_data["base_name"].strip(), defaults={"category": item.category})
        item.base = base
        if commit:
            item.save()
        return item


@login_required
def item_list(request):
    qs = Item.objects.select_related("category", "department")
    q = request.GET.get("q", "").strip()
    if q:
        bc = Barcode.objects.filter(code=q).values_list("item_id", flat=True)
        text = Q()
        for w in q.split():
            text &= Q(name__icontains=w) | Q(name_ta__icontains=w) | Q(brand__icontains=w)
        qs = qs.filter(Q(sku=q.upper()) | Q(plu=q) | Q(pk__in=bc) | text)
    for key in ("department", "category"):
        if request.GET.get(key):
            qs = qs.filter(**{f"{key}_id": request.GET[key]})
    status = request.GET.get("status", "active" if not q else "")
    if status == "active":
        qs = qs.filter(is_active=True)
    elif status == "inactive":
        qs = qs.filter(is_active=False)
    elif status == "candidate":
        qs = qs.filter(status=Item.CANDIDATE)
    elif status == "no_tamil":
        qs = qs.filter(name_ta="")
    elif status == "no_tax":
        qs = qs.filter(is_active=True, tax_class="unset")
    page = Paginator(qs.order_by("name"), 50).get_page(request.GET.get("page"))
    return render(request, "catalog/item_list.html", {
        "nav": "products", "page": page, "q": q, "status": status, "departments": Department.objects.all(),
        "categories": Category.objects.filter(department_id=request.GET.get("department")) if request.GET.get("department") else [],
        "counts": {"all": Item.objects.count(), "active": Item.objects.filter(is_active=True).count(),
                   "candidate": Item.objects.filter(status=Item.CANDIDATE).count()},
    })


@login_required
def item_detail(request, pk):
    item = get_object_or_404(Item.objects.select_related("base", "category", "department", "preferred_supplier"), pk=pk)
    from inventory.models import StockLot

    return render(request, "catalog/item_detail.html", {
        "nav": "products", "item": item, "barcodes": item.barcodes.all(),
        "lots": item.lots.filter(qty__gt=0).order_by("status", "expiry", "id"),
        "moves": item.moves.select_related("lot", "user")[:30], "kinds": Barcode.KINDS,
        "quarantine": item.lots.filter(status=StockLot.QUARANTINE, qty__gt=0).exists(),
    })


@require("products")
def item_edit(request, pk=None):
    item = get_object_or_404(Item, pk=pk) if pk else None
    before = {f: getattr(item, f) for f in ("price", "mrp", "cost", "is_active", "status", "tax_class", "gst_rate", "hsn")} if item else {}
    form = ItemForm(request.POST or None, instance=item, initial={"status": Item.VERIFIED} if not item else None)
    if form.is_valid():
        with transaction.atomic():
            obj = form.save()
            changes = {f: f"{before[f]} → {getattr(obj, f)}" for f in before if before[f] != getattr(obj, f)}
            if not item:
                audit("product_create", f"Created {obj.sku} {obj.name} at ₹{obj.price}", user=request.user, obj=obj)
            elif changes:
                audit("price_change" if "price" in changes or "mrp" in changes else "product_edit",
                      f"{obj.sku} {obj.name}: " + "; ".join(f"{k} {v}" for k, v in changes.items()), user=request.user, obj=obj)
        messages.success(request, "Product saved.")
        return redirect("item_detail", pk=obj.pk)
    return render(request, "form.html", {"nav": "products", "form": form, "title": f"Edit {item.sku}" if item else "New product",
                                         "subtitle": "Every price change is recorded with your name in the audit log.",
                                         "back": f"/products/{item.pk}/" if item else "/products/"})


@require("products")
@require_POST
def item_verify(request, pk):
    item = get_object_or_404(Item, pk=pk)
    if item.price is None:
        messages.error(request, "Set the selling price (and MRP) before verifying and activating.")
        return redirect("item_edit", pk=pk)
    item.status, item.is_active = Item.VERIFIED, True
    item.save(update_fields=["status", "is_active", "updated_at"])
    audit("product_verify", f"{item.sku} verified and activated at ₹{item.price}", user=request.user, obj=item)
    messages.success(request, f"{item.name} is verified and can be sold.")
    return redirect("item_detail", pk=pk)


@require("link_barcode")
@require_POST
def barcode_add(request, pk):
    item = get_object_or_404(Item, pk=pk)
    code = request.POST.get("code", "").strip()
    try:
        per = request.POST.get("qty_per_scan") or "1"
        from core.money import D

        per = D(per)
        if not code or len(code) > 32 or " " in code:
            raise ValueError("Scan or type the barcode exactly as printed (no spaces).")
        if per <= 0:
            raise ValueError("Units per scan must be more than zero.")
        if item.weighed and per != 1:
            raise ValueError("Weighed items take their weight from the scale; leave units per scan at 1.")
        other = Barcode.objects.filter(code=code).select_related("item").first()
        if other:
            raise ValueError(f"Barcode {code} already belongs to {other.item.sku} {other.item.name}.")
        Barcode.objects.create(code=code, item=item, kind=request.POST.get("kind") or Barcode.MANUFACTURER, qty_per_scan=per,
                               note=request.POST.get("note", "")[:80])
        audit("barcode_link", f"Barcode {code} ({per:f} per scan) linked to {item.sku} {item.name}", user=request.user, obj=item)
        messages.success(request, f"Barcode {code} linked.")
    except ValueError as exc:
        messages.error(request, str(exc))
    return redirect("item_detail", pk=pk)


@require("link_barcode")
@require_POST
def barcode_delete(request, pk, bid):
    b = get_object_or_404(Barcode, pk=bid, item_id=pk)
    audit("barcode_unlink", f"Barcode {b.code} removed from {b.item.sku}", user=request.user, obj=b.item)
    b.delete()
    messages.success(request, "Barcode removed.")
    return redirect("item_detail", pk=pk)


@login_required
def labels(request):
    """Shelf / item labels. ?ids=1,2,3&copies=2  Uses the SKU (or PLU for loose items) as a Code 128 barcode."""
    ids = [int(i) for i in request.GET.get("ids", "").split(",") if i.isdigit()]
    copies = max(1, min(50, int(request.GET.get("copies", "1") or 1)))
    items = Item.objects.filter(pk__in=ids)
    out = []
    for it in items:
        code = it.plu if it.weighed and it.plu else it.sku
        for _ in range(copies):
            out.append({"item": it, "svg": svg_code128(code), "code": code})
    return render(request, "catalog/labels.html", {"labels": out})


# ------------------------------------------------------------------ import
def _staging():
    d = Path(settings.DATA_DIR) / "imports"
    d.mkdir(exist_ok=True)
    return d


@require("products")
def import_start(request):
    if request.method == "POST" and request.FILES.get("file"):
        f = request.FILES["file"]
        if f.size > 20 * 1024 * 1024:
            messages.error(request, "File is larger than 20 MB.")
            return redirect("import_start")
        token = uuid.uuid4().hex
        path = _staging() / f"{token}{Path(f.name).suffix.lower()}"
        path.write_bytes(f.read())
        request.session["import"] = {"token": token, "path": str(path), "name": f.name}
        return redirect("import_preview")
    return render(request, "catalog/import_start.html", {"nav": "products", "batches": ImportBatch.objects.select_related("user")[:20],
                                                         "columns": importer.COLUMNS})


def _load(request):
    info = request.session.get("import")
    if not info or not Path(info["path"]).exists():
        raise Http404("Upload the file again.")
    headers, raw = importer.read_file(info["name"], Path(info["path"]).read_bytes())
    return info, importer.preview(headers, raw)


@require("products")
def import_preview(request):
    try:
        info, (rows, summary) = _load(request)
    except (UnicodeDecodeError, ValueError, KeyError) as exc:
        messages.error(request, f"Could not read the file: {exc}")
        return redirect("import_start")
    show = request.GET.get("show", "error" if summary.get("error") else "changes")
    if show == "error":
        visible = [r for r in rows if r.action == "error"]
    elif show == "changes":
        visible = [r for r in rows if r.action in ("create", "update")]
    else:
        visible = rows
    return render(request, "catalog/import_preview.html", {"nav": "products", "info": info, "summary": summary,
                                                           "rows": visible[:500], "show": show, "more": max(0, len(visible) - 500)})


@require("products")
@require_POST
def import_apply(request):
    info, (rows, summary) = _load(request)
    try:
        batch = importer.apply(rows, request.user, info["name"])
    except ValueError as exc:
        messages.error(request, str(exc))
        return redirect("import_preview")
    Path(info["path"]).unlink(missing_ok=True)
    request.session.pop("import", None)
    messages.success(request, f"Import applied: {batch.created_items} new, {batch.updated_items} updated, {batch.barcodes_added} barcodes linked. You can undo it below.")
    return redirect("import_start")


@require("products")
@require_POST
def import_undo(request, pk):
    try:
        importer.undo_batch(get_object_or_404(ImportBatch, pk=pk), request.user)
        messages.success(request, "Import undone. Previous values restored.")
    except ValueError as exc:
        messages.error(request, str(exc))
    return redirect("import_start")


@login_required
def import_template(request, fmt):
    rows = importer.template_rows()
    example = ["MPC90001", "08901234567896", "1", "", "Ponni rice · Brand X · 1 kg", "பொன்னி அரிசி · 1 kg", "Brand X", "Pantry",
               "Rice & millets", "", "Ponni rice", "Standard", "1 kg", "bag", "pcs", "1", "", "", "", "", "unset", "", "", "10", "A3",
               "no", "no", "no", "candidate"]
    if fmt == "xlsx":
        import openpyxl
        from openpyxl.styles import Font

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Products"
        ws.append(rows[0])
        ws.append(example)
        for cell in ws[1]:
            cell.font = Font(bold=True)
        for col in ws.columns:
            letter = col[0].column_letter
            ws.column_dimensions[letter].width = 18
            if col[0].value in ("SKU", "Barcode", "PLU", "HSN"):
                for c in col:
                    c.number_format = "@"
        notes = wb.create_sheet("How to fill")
        notes.append(["Column", "What to enter"])
        for h, _, n in importer.COLUMNS:
            notes.append([h, n])
        notes.append([])
        notes.append(["Rule", "Blank cells keep the current value. Never type a price, barcode or GST rate you have not checked on the pack or supplier invoice."])
        buf = io.BytesIO()
        wb.save(buf)
        resp = HttpResponse(buf.getvalue(), content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        resp["Content-Disposition"] = 'attachment; filename="madhuram_product_import_template.xlsx"'
        return resp
    resp = HttpResponse(content_type="text/csv; charset=utf-8")
    resp["Content-Disposition"] = 'attachment; filename="madhuram_product_import_template.csv"'
    resp.write("﻿")
    w = csv.writer(resp)
    w.writerow(rows[0])
    w.writerow(example)
    return resp


@require("products")
def export_products(request):
    resp = HttpResponse(content_type="text/csv; charset=utf-8")
    resp["Content-Disposition"] = 'attachment; filename="madhuram_products.csv"'
    resp.write("﻿")
    w = csv.writer(resp)
    w.writerow([h for h, _, _ in importer.COLUMNS])
    qs = Item.objects.select_related("department", "category", "base", "preferred_supplier").prefetch_related("barcodes")
    if request.GET.get("active"):
        qs = qs.filter(is_active=True)
    for it in qs.iterator(chunk_size=2000):
        bc = it.barcodes.all()[0] if it.barcodes.all() else None
        w.writerow([it.sku, bc.code if bc else "", bc.qty_per_scan if bc else "", it.plu or "", it.name, it.name_ta, it.brand,
                    it.department.name, it.category.name, it.subcategory, it.base.name, it.variant, it.pack_size, it.purchase_unit,
                    it.sale_unit, it.units_per_purchase, it.mrp or "", it.cost or "", it.price or "", it.hsn, it.tax_class,
                    it.gst_rate if it.gst_rate is not None else "", it.preferred_supplier.name if it.preferred_supplier else "",
                    it.reorder_level, it.shelf, "yes" if it.track_batch else "no", "yes" if it.track_expiry else "no",
                    "yes" if it.is_active else "no", it.status])
    return resp


@login_required
def practice_barcodes(request):
    """Printable practice sheet for the demo database and acceptance tests."""
    from core.scale import make_scale_label

    cfg = StoreSettings.load()
    rows = []
    for code, label in [("TRYRICE", "Practice Ponni rice 1 kg pack · ₹75"), ("TRYAPPLE", "Practice apple, loose, per kg · ₹180/kg"),
                        ("8901000000019", "Practice Ponni rice 1 kg – manufacturer barcode"), ("0890105800007", "Practice sunflower oil 1 L – barcode starts with 0"),
                        ("18901000000030", "Carton of 24 practice juice bottles (adds 24 pieces)"),
                        ("8909999999994", "Unknown barcode – must be refused")]:
        rows.append({"code": code, "label": label, "svg": svg_any(code)})
    try:
        if cfg.scale_enabled:
            lab = make_scale_label("101", __import__("decimal").Decimal("0.375"), cfg)
            rows.append({"code": lab, "label": "Scale label: PLU 101 apple, 0.375 kg", "svg": svg_any(lab)})
    except (ValueError, IndexError):
        pass
    return render(request, "catalog/practice.html", {"rows": rows})
