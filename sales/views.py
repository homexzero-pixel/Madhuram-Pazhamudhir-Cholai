import uuid
from datetime import date, timedelta

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.core.exceptions import PermissionDenied
from django.core.paginator import Paginator
from django.db.models import Q, Sum
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views.decorators.http import require_POST

from accounts.permissions import require
from core.models import StoreSettings
from core.money import ZERO, D

from . import services as S
from .models import CashMovement, Payment, ReturnLine, Sale, SaleReturn, Settlement, Shift


@require("bill")
def pos(request):
    return render(request, "sales/pos.html", {"nav": "billing"})


def _visible_sales(user):
    qs = Sale.objects.select_related("cashier", "customer")
    if user.can("reports") or user.can("refund"):
        return qs
    return qs.filter(cashier=user)


def _date(value, default):
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        return default


@login_required
def sale_list(request):
    q = request.GET.get("q", "").strip()
    today = timezone.localdate()
    start = _date(request.GET.get("start"), today - timedelta(days=6))
    end = _date(request.GET.get("end"), today)
    sales = _visible_sales(request.user)
    if q:
        sales = sales.filter(Q(bill_no__icontains=q) | Q(customer__name__icontains=q) | Q(customer__phone__icontains=q))
    else:
        sales = sales.filter(business_date__range=(start, end))
    page = Paginator(sales.order_by("-id"), 30).get_page(request.GET.get("page"))
    returns = SaleReturn.objects.select_related("sale").filter(business_date__range=(start, end))[:50] if not q else SaleReturn.objects.filter(
        Q(number__icontains=q) | Q(sale__bill_no__icontains=q))[:50]
    return render(request, "sales/sale_list.html", {"nav": "sales", "page": page, "q": q, "start": start, "end": end,
                                                    "returns": returns})


@login_required
def sale_detail(request, pk):
    sale = get_object_or_404(_visible_sales(request.user).prefetch_related("lines", "payments", "returns__lines"), pk=pk)
    return render(request, "sales/sale_detail.html", {
        "nav": "sales", "sale": sale, "refundable": S.refundable_left(sale), "dispositions": ReturnLine.DISPOSITIONS,
        "return_key": uuid.uuid4(), "can_refund": request.user.can("refund"),
    })


@login_required
def sale_receipt(request, pk):
    sale = get_object_or_404(_visible_sales(request.user).prefetch_related("lines", "payments"), pk=pk)
    width = request.GET.get("w") or StoreSettings.load().receipt_width
    tax_rows = {}
    for l in sale.lines.all():
        if l.gst_rate:
            r = tax_rows.setdefault(l.gst_rate, {"rate": l.gst_rate, "taxable": ZERO, "cgst": ZERO, "sgst": ZERO})
            r["taxable"] += l.taxable
            r["cgst"] += l.cgst
            r["sgst"] += l.sgst
    return render(request, "sales/receipt.html", {
        "sale": sale, "w": width, "id": sale.identity, "tax_rows": sorted(tax_rows.values(), key=lambda r: r["rate"]),
        "auto": request.GET.get("print") == "1", "reprint": request.GET.get("reprint") == "1" or sale.print_count > 0,
        "savings": sum(((l.mrp or l.rate) * l.qty - l.net for l in sale.lines.all() if l.mrp), ZERO),
    })


@require("refund")
@require_POST
def sale_return(request, pk):
    sale = get_object_or_404(Sale, pk=pk)
    rows = []
    for line in sale.lines.all():
        v = request.POST.get(f"qty_{line.pk}", "").strip()
        if v:
            rows.append({"line": line.pk, "qty": v, "disposition": request.POST.get(f"disp_{line.pk}", "quarantine")})
    try:
        ret, created = S.process_return(
            sale, request.user, rows, method=request.POST.get("method", ""), reason=request.POST.get("reason", ""),
            reference=request.POST.get("reference", ""), approver=request.POST.get("approver", ""),
            pin=request.POST.get("pin", ""), key=request.POST.get("key") or None,
        )
    except (ValueError, PermissionDenied) as exc:
        messages.error(request, str(exc))
        return redirect("sale_detail", pk=pk)
    if created:
        messages.success(request, f"Return {ret.number} saved. Refund {ret.total} by {ret.get_method_display()}.")
    return redirect("return_detail", pk=ret.pk)


@login_required
def return_detail(request, pk):
    ret = get_object_or_404(SaleReturn.objects.select_related("sale", "user"), pk=pk)
    if not (request.user.can("refund") or request.user.can("reports") or ret.user_id == request.user.pk):
        raise PermissionDenied
    return render(request, "sales/return_detail.html", {"nav": "sales", "ret": ret, "id": ret.sale.identity,
                                                        "w": request.GET.get("w") or StoreSettings.load().receipt_width})


# ------------------------------------------------------------------ cash closing
@login_required
def cash_home(request):
    if not (request.user.can("cash") or request.user.can("reports")):
        raise PermissionDenied
    shift = S.open_shift()
    summary = S.cash_summary(shift) if shift else None
    recent = Shift.objects.select_related("cashier", "closed_by").all()[:15]
    last = Shift.objects.filter(status=Shift.CLOSED).order_by("-closed_at").first()
    return render(request, "sales/cash_home.html", {
        "nav": "cash", "shift": shift, "summary": summary, "recent": recent, "last": last,
        "moves": shift.cash_moves.all() if shift else [], "kinds": CashMovement.KINDS,
        "notes": [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1],
    })


@require("cash")
@require_POST
def shift_open(request):
    try:
        S.start_shift(request.user, request.POST.get("opening") or 0)
        messages.success(request, "Shift opened. You can start billing.")
    except (ValueError, PermissionDenied) as exc:
        messages.error(request, str(exc))
    return redirect("cash_home")


@require("cash")
@require_POST
def shift_close(request, pk):
    shift = get_object_or_404(Shift, pk=pk)
    notes = {}
    total = ZERO
    for n in [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1]:
        c = request.POST.get(f"n{n}", "").strip()
        if c:
            notes[str(n)] = int(c)
            total += D(n) * int(c)
    counted = request.POST.get("counted", "").strip() or total
    try:
        s = S.close_shift(shift, request.user, counted, denominations=notes, retained=request.POST.get("retained", "").strip() or None,
                          note=request.POST.get("note", ""))
        messages.success(request, f"Shift {s.pk} closed. Variance ₹{s.variance}.")
        from core.backup import auto_backup

        auto_backup(f"after-shift-{s.pk}")
    except (ValueError, PermissionDenied) as exc:
        messages.error(request, str(exc))
        return redirect("cash_home")
    return redirect("shift_detail", pk=shift.pk)


@require("reopen_shift")
@require_POST
def shift_reopen(request, pk):
    try:
        S.reopen_shift(get_object_or_404(Shift, pk=pk), request.user, request.POST.get("reason", ""))
        messages.warning(request, "Shift reopened. This is recorded in the audit log.")
    except (ValueError, PermissionDenied) as exc:
        messages.error(request, str(exc))
    return redirect("cash_home")


@require("cash")
@require_POST
def cash_move(request):
    try:
        S.cash_move(request.user, request.POST.get("kind"), request.POST.get("amount"), request.POST.get("reason", ""),
                    request.POST.get("reference", ""))
        messages.success(request, "Cash movement recorded.")
    except (ValueError, PermissionDenied) as exc:
        messages.error(request, str(exc))
    return redirect("cash_home")


@login_required
def shift_detail(request, pk):
    if not (request.user.can("cash") or request.user.can("reports")):
        raise PermissionDenied
    shift = get_object_or_404(Shift.objects.select_related("cashier", "closed_by"), pk=pk)
    return render(request, "sales/shift_detail.html", {"nav": "cash", "shift": shift, "summary": S.cash_summary(shift),
                                                       "moves": shift.cash_moves.all(), "sales": shift.sales.all()[:200]})


# ------------------------------------------------------------------ settlements
@require("settlement")
def settlements(request):
    method = request.GET.get("method", "upi")
    upto = _date(request.GET.get("upto"), timezone.localdate())
    unsettled = Payment.objects.filter(method=method, settlement__isnull=True, sale__business_date__lte=upto).select_related("sale")
    unsettled_total = unsettled.aggregate(s=Sum("amount"))["s"] or ZERO
    refunds_unsettled = SaleReturn.objects.filter(method=method, settlement__isnull=True, business_date__lte=upto)
    refunds_total = refunds_unsettled.aggregate(s=Sum("total"))["s"] or ZERO
    old = Payment.objects.filter(method__in=["upi", "card"], settlement__isnull=True,
                                 sale__business_date__lt=timezone.localdate() - timedelta(days=3)).count()
    by_day = (unsettled.values("sale__business_date").annotate(total=Sum("amount")).order_by("sale__business_date"))
    return render(request, "sales/settlements.html", {
        "nav": "cash", "method": method, "upto": upto, "unsettled": unsettled[:300], "unsettled_total": unsettled_total,
        "refunds": refunds_unsettled, "refunds_total": refunds_total, "net_expected": unsettled_total - refunds_total,
        "old": old, "by_day": by_day, "history": Settlement.objects.all()[:30],
    })


@require("settlement")
@require_POST
def settlement_create(request):
    from django.db import transaction

    from core.models import audit
    from core.money import money

    method = request.POST.get("method")
    upto = _date(request.POST.get("upto"), None)
    if method not in ("upi", "card") or upto is None:
        messages.error(request, "Choose UPI or card and the last business date covered.")
        return redirect("settlements")
    try:
        credited, fees = money(request.POST.get("credited")), money(request.POST.get("fees") or 0)
    except ValueError as exc:
        messages.error(request, str(exc))
        return redirect("settlements")
    with transaction.atomic():
        pays = Payment.objects.select_for_update().filter(method=method, settlement__isnull=True, sale__business_date__lte=upto)
        refunds = SaleReturn.objects.filter(method=method, settlement__isnull=True, business_date__lte=upto)
        expected = (pays.aggregate(s=Sum("amount"))["s"] or ZERO) - (refunds.aggregate(s=Sum("total"))["s"] or ZERO)
        if not pays.exists():
            messages.error(request, "No unsettled payments up to that date.")
            return redirect("settlements")
        st = Settlement.objects.create(method=method, provider=request.POST.get("provider", ""), settled_on=_date(request.POST.get("settled_on"), timezone.localdate()),
                                       expected=expected, fees=fees, credited=credited, bank_reference=request.POST.get("bank_reference", ""),
                                       notes=request.POST.get("notes", ""), created_by=request.user)
        pays.update(settlement=st)
        refunds.update(settlement=st)
        audit("settlement", f"{method.upper()} settlement ₹{credited} + fees ₹{fees} vs expected ₹{expected}", user=request.user, obj=st)
    if st.difference:
        messages.warning(request, f"Settlement saved with an unexplained difference of ₹{st.difference}. Check with the bank / provider.")
    else:
        messages.success(request, "Settlement matched exactly.")
    return redirect(f"/cash/settlements/?method={method}")
