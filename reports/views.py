import csv
import io
from datetime import date, timedelta
from decimal import Decimal

from django.db.models import F, Sum
from django.http import Http404, HttpResponse
from django.shortcuts import render
from django.utils import timezone

from accounts.permissions import require
from core.models import StoreSettings
from core.money import ZERO, inr

from .registry import DEFINITIONS, R, summary


def _d(v, default):
    try:
        return date.fromisoformat(v)
    except (TypeError, ValueError):
        return default


@require("reports")
def dashboard(request):
    from catalog.models import Item
    from inventory.models import StockLot
    from sales.models import Payment, Sale
    from sales.services import cash_summary, open_shift

    today = timezone.localdate()
    cfg = StoreSettings.load()
    shift = open_shift()
    days = [today - timedelta(days=i) for i in range(13, -1, -1)]
    chart = {"labels": [d.strftime("%d %b") for d in days], "values": [float(summary(d, d)["net_after_returns"]) for d in days]}
    tenders = {m: Payment.objects.filter(sale__business_date=today, method=m).aggregate(s=Sum("amount"))["s"] or ZERO for m in ("cash", "upi", "card", "credit")}
    return render(request, "reports/dashboard.html", {
        "nav": "dashboard", "t": summary(today, today), "m": summary(today.replace(day=1), today), "tenders": tenders,
        "shift": shift, "cash": cash_summary(shift) if shift else None, "chart": chart, "defs": DEFINITIONS,
        "low": Item.objects.filter(is_active=True, on_hand__lte=F("reorder_level")).count(),
        "expiring": StockLot.objects.filter(qty__gt=0, status="sellable", expiry__range=(today, today + timedelta(days=cfg.near_expiry_days))).count(),
        "expired": StockLot.objects.filter(qty__gt=0, status="sellable", expiry__lt=today).count(),
        "unsettled": Payment.objects.filter(method__in=["upi", "card"], settlement__isnull=True).aggregate(s=Sum("amount"))["s"] or ZERO,
        "recent": Sale.objects.select_related("cashier")[:8], "today": today,
    })


@require("reports")
def report_index(request):
    groups = {}
    for r in R.values():
        if r["key"] in ("bills", "category_lines"):
            continue
        groups.setdefault(r["group"], []).append(r)
    return render(request, "reports/index.html", {"nav": "reports", "groups": groups})


def _cell(v):
    if isinstance(v, dict):
        return v["v"]
    return v


@require("reports")
def report_view(request):
    key = request.GET.get("report", "daily")
    if key not in R:
        raise Http404
    rep = R[key]
    today = timezone.localdate()
    start, end = _d(request.GET.get("start"), today.replace(day=1)), _d(request.GET.get("end"), today)
    if start > end:
        start, end = end, start
    cols, rows, totals = rep["fn"](start, end, request=request)
    fmt = request.GET.get("format")
    title = f"{rep['title']} {start:%d-%m-%Y} to {end:%d-%m-%Y}" if rep["dates"] else rep["title"]
    if fmt in ("csv", "xlsx"):
        data = [[_cell(c) for c in r] for r in rows] + ([[_cell(c) for c in totals]] if totals else [])
        fname = f"madhuram_{key}_{start:%Y%m%d}_{end:%Y%m%d}"
        if fmt == "csv":
            resp = HttpResponse(content_type="text/csv; charset=utf-8")
            resp["Content-Disposition"] = f'attachment; filename="{fname}.csv"'
            resp.write("﻿")
            w = csv.writer(resp)
            w.writerow([title])
            w.writerow([f"Date basis: {rep['basis']}"])
            w.writerow(cols)
            for r in data:
                w.writerow([("'" + c if isinstance(c, str) and c[:1] in "=+-@" else c) for c in r])
            return resp
        import openpyxl
        from openpyxl.styles import Font

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "".join(ch for ch in rep["title"] if ch not in "/\\?*[]:")[:30] or "Report"
        ws.append([title])
        ws.append([f"Date basis: {rep['basis']}"])
        ws.append(cols)
        for c in ws[3]:
            c.font = Font(bold=True)
        for r in data:
            ws.append([float(c) if isinstance(c, Decimal) else c for c in r])
        buf = io.BytesIO()
        wb.save(buf)
        resp = HttpResponse(buf.getvalue(), content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        resp["Content-Disposition"] = f'attachment; filename="{fname}.xlsx"'
        return resp
    return render(request, "reports/view.html", {"nav": "reports", "rep": rep, "cols": cols, "rows": rows, "totals": totals,
                                                 "start": start, "end": end, "defs": DEFINITIONS if key in ("daily", "margin", "categories") else None,
                                                 "reports": [r for r in R.values() if r["key"] not in ("bills", "category_lines")]})
