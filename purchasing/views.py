from datetime import date

from django import forms
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.core.exceptions import PermissionDenied
from django.db.models import Sum
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from accounts.permissions import require
from catalog.models import Barcode, Item
from cholai.forms import BootstrapMixin
from core.money import ZERO, D
from inventory.models import StockLot

from . import services as P
from .models import GoodsReceipt, PurchaseOrder, PurchaseReturn, Supplier, SupplierPayment


def _can_view(user):
    if not (user.can("purchase") or user.can("reports")):
        raise PermissionDenied


def _find_item(code):
    code = (code or "").strip()
    if not code:
        return None
    b = Barcode.objects.select_related("item").filter(code=code).first()
    if b:
        return b.item
    return Item.objects.filter(sku=code.upper()).first() or Item.objects.filter(plu=code).first()


def _date(v):
    try:
        return date.fromisoformat(v) if v else None
    except ValueError:
        raise ValueError(f"'{v}' is not a date (use the date picker).")


@login_required
def purchase_home(request):
    _can_view(request.user)
    return render(request, "purchasing/home.html", {
        "nav": "purchases", "orders": PurchaseOrder.objects.select_related("supplier").exclude(status__in=["received", "closed"])[:50],
        "done": PurchaseOrder.objects.select_related("supplier").filter(status__in=["received", "closed"])[:15],
        "grns": GoodsReceipt.objects.select_related("supplier", "received_by")[:30],
        "returns": PurchaseReturn.objects.select_related("supplier")[:15],
    })


def _lines_from_post(post, prefix, fields):
    rows = []
    for i in range(int(post.get(f"{prefix}count", 0) or 0)):
        code = post.get(f"{prefix}{i}-code", "").strip()
        if not code:
            continue
        item = _find_item(code)
        if item is None:
            raise ValueError(f"Line {i + 1}: '{code}' is not a known SKU, PLU or barcode.")
        row = {"item": item}
        for f in fields:
            row[f] = post.get(f"{prefix}{i}-{f}", "").strip()
        rows.append(row)
    return rows


@require("purchase")
def po_new(request):
    suppliers = Supplier.objects.filter(is_active=True)
    pre = Item.objects.filter(pk=request.GET.get("item")).first()
    if request.method == "POST":
        try:
            sup = get_object_or_404(Supplier, pk=request.POST.get("supplier"))
            rows = _lines_from_post(request.POST, "l", ["qty", "unit_cost"])
            po = P.create_po(sup, request.user, rows, expected_on=_date(request.POST.get("expected_on")), notes=request.POST.get("notes", ""))
            messages.success(request, f"Purchase order {po.number} saved.")
            return redirect("po_detail", pk=po.pk)
        except ValueError as exc:
            messages.error(request, str(exc))
    return render(request, "purchasing/po_new.html", {"nav": "purchases", "suppliers": suppliers, "pre": pre, "rows": range(12)})


@login_required
def po_detail(request, pk):
    _can_view(request.user)
    po = get_object_or_404(PurchaseOrder.objects.select_related("supplier"), pk=pk)
    return render(request, "purchasing/po_detail.html", {"nav": "purchases", "po": po, "lines": po.lines.select_related("item"),
                                                         "receipts": po.receipts.all()})


@require("purchase")
@require_POST
def po_close(request, pk):
    po = get_object_or_404(PurchaseOrder, pk=pk)
    po.status = PurchaseOrder.CLOSED
    po.save(update_fields=["status"])
    messages.info(request, f"{po.number} closed. Outstanding quantities will not be delivered.")
    return redirect("po_detail", pk=pk)


@require("purchase")
def grn_new(request):
    po = PurchaseOrder.objects.filter(pk=request.GET.get("po") or request.POST.get("po")).first()
    pre_item = Item.objects.filter(pk=request.GET.get("item")).first()
    if request.method == "POST":
        try:
            sup = po.supplier if po else get_object_or_404(Supplier, pk=request.POST.get("supplier"))
            rows = _lines_from_post(request.POST, "l", ["qty", "free_qty", "damaged_qty", "unit_cost", "units_per_purchase", "batch", "expiry", "po_line"])
            for r in rows:
                r["expiry"] = _date(r["expiry"])
                pl = r.pop("po_line")
                r["po_line"] = po.lines.get(pk=pl) if po and pl else None
                if not r["units_per_purchase"]:
                    r.pop("units_per_purchase")
            grn = P.receive(sup, request.user, invoice_no=request.POST.get("invoice_no", ""), invoice_date=_date(request.POST.get("invoice_date")),
                            invoice_total=request.POST.get("invoice_total") or 0, lines=rows, order=po, notes=request.POST.get("notes", ""))
            if grn.invoice_difference:
                messages.warning(request, f"{grn.number} saved, but the invoice total differs from the received lines by ₹{grn.invoice_difference}. Check with the supplier.")
            else:
                messages.success(request, f"{grn.number} saved. Stock added. Invoice matches the received lines.")
            return redirect("grn_detail", pk=grn.pk)
        except ValueError as exc:
            messages.error(request, str(exc))
    lines = []
    if po:
        lines = [{"code": l.item.sku, "name": l.item.name, "qty": l.outstanding, "cost": l.unit_cost, "upp": l.item.units_per_purchase,
                  "po_line": l.pk, "expiry": l.item.track_expiry} for l in po.lines.select_related("item") if l.outstanding > 0]
    elif pre_item:
        lines = [{"code": pre_item.sku, "name": pre_item.name, "qty": "", "cost": "", "upp": pre_item.units_per_purchase, "po_line": "",
                  "expiry": pre_item.track_expiry}]
    lines += [{}] * max(0, 10 - len(lines))
    return render(request, "purchasing/grn_new.html", {"nav": "purchases", "po": po, "lines": lines,
                                                       "suppliers": Supplier.objects.filter(is_active=True)})


@login_required
def grn_detail(request, pk):
    _can_view(request.user)
    grn = get_object_or_404(GoodsReceipt.objects.select_related("supplier", "order", "received_by"), pk=pk)
    return render(request, "purchasing/grn_detail.html", {"nav": "purchases", "grn": grn, "lines": grn.lines.select_related("item"),
                                                          "lots": StockLot.objects.filter(grn_line__grn=grn).select_related("item")})


@require("purchase")
def purchase_return_new(request):
    sup = Supplier.objects.filter(pk=request.GET.get("supplier") or request.POST.get("supplier")).first()
    lots = StockLot.objects.filter(supplier=sup, qty__gt=0).select_related("item").order_by("item__name") if sup else []
    if request.method == "POST" and sup:
        try:
            chosen = [(lot, request.POST.get(f"q{lot.pk}", "").strip()) for lot in lots if request.POST.get(f"q{lot.pk}", "").strip()]
            pr = P.return_to_supplier(sup, request.user, chosen, request.POST.get("reason", ""))
            messages.success(request, f"Return {pr.number} saved: ₹{pr.total} reduces what you owe {sup}.")
            return redirect("supplier_detail", pk=sup.pk)
        except ValueError as exc:
            messages.error(request, str(exc))
    return render(request, "purchasing/return_new.html", {"nav": "purchases", "sup": sup, "lots": lots, "suppliers": Supplier.objects.all()})


# ------------------------------------------------------------------ suppliers
class SupplierForm(BootstrapMixin, forms.ModelForm):
    class Meta:
        model = Supplier
        fields = ["name", "phone", "gstin", "address", "payment_terms_days", "opening_balance", "is_active", "notes"]


@login_required
def supplier_list(request):
    _can_view(request.user)
    sups = list(Supplier.objects.all())
    for s in sups:
        s.balance = s.outstanding()
    return render(request, "purchasing/supplier_list.html", {"nav": "suppliers", "suppliers": sups, "total": sum((s.balance for s in sups), ZERO)})


@require("purchase")
def supplier_edit(request, pk=None):
    s = get_object_or_404(Supplier, pk=pk) if pk else None
    form = SupplierForm(request.POST or None, instance=s)
    if form.is_valid():
        s = form.save()
        messages.success(request, "Supplier saved.")
        return redirect("supplier_detail", pk=s.pk)
    return render(request, "form.html", {"nav": "suppliers", "form": form, "title": "Supplier", "back": "/purchases/suppliers/"})


@login_required
def supplier_detail(request, pk):
    _can_view(request.user)
    s = get_object_or_404(Supplier, pk=pk)
    entries = [{"date": g.invoice_date, "what": f"Invoice {g.invoice_no} ({g.number})", "debit": ZERO, "credit": g.invoice_total, "link": f"/purchases/grn/{g.pk}/"} for g in s.receipts.all()]
    entries += [{"date": r.created_at.date(), "what": f"Return {r.number}: {r.reason}", "debit": r.total, "credit": ZERO, "link": ""} for r in s.returns.all()]
    entries += [{"date": p.paid_on, "what": f"Payment {p.get_method_display()} {p.reference}", "debit": p.amount, "credit": ZERO, "link": ""} for p in s.payments.all()]
    entries.sort(key=lambda e: e["date"])
    bal = s.opening_balance
    for e in entries:
        bal += e["credit"] - e["debit"]
        e["balance"] = bal
    return render(request, "purchasing/supplier_detail.html", {"nav": "suppliers", "s": s, "entries": entries, "balance": s.outstanding(),
                                                               "methods": SupplierPayment.METHODS})


@require("supplier_pay")
@require_POST
def supplier_pay(request, pk):
    s = get_object_or_404(Supplier, pk=pk)
    try:
        P.pay_supplier(s, request.user, request.POST.get("amount"), request.POST.get("method"), request.POST.get("reference", ""),
                       _date(request.POST.get("paid_on")))
        messages.success(request, "Payment recorded.")
    except ValueError as exc:
        messages.error(request, str(exc))
    return redirect("supplier_detail", pk=pk)
