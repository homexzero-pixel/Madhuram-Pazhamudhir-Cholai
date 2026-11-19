import csv
from datetime import date, timedelta

from django.http import HttpResponse
from django.shortcuts import render
from django.utils import timezone

from accounts.permissions import manager_required
from expenses.models import Expense
from inventory.models import Product, Purchase
from sales.models import SaleItem

from . import analytics


def _date_range(request):
    today = timezone.localdate()
    try:
        start = date.fromisoformat(request.GET.get("start", ""))
    except ValueError:
        start = today.replace(day=1)
    try:
        end = date.fromisoformat(request.GET.get("end", ""))
    except ValueError:
        end = today
    if start > end:
        start, end = end, start
    if (end - start).days > 366:
        start = end - timedelta(days=366)
    return start, end


@manager_required
def overview(request):
    start, end = _date_range(request)
    daily = analytics.daily_sales(start, end)
    expenses = analytics.expenses_by_category(start, end)
    payments = analytics.payment_split(start, end)
    chart = {
        "daily": {"labels": [d["day"].strftime("%d %b") for d in daily], "values": [float(d["total"]) for d in daily]},
        "expenses": {"labels": [e["category__name"] for e in expenses], "values": [float(e["total"]) for e in expenses]},
        "payments": {"labels": [p["method"] for p in payments], "values": [float(p["total"]) for p in payments]},
    }
    return render(
        request,
        "reports/overview.html",
        {
            "start": start,
            "end": end,
            "summary": analytics.summary(start, end),
            "top_products": analytics.top_products(start, end),
            "payments": payments,
            "expenses": expenses,
            "chart": chart,
        },
    )


@manager_required
def stock_report(request):
    products = Product.objects.filter(is_active=True).select_related("category")
    total_value = sum((p.stock_value for p in products), 0)
    return render(
        request,
        "reports/stock.html",
        {"products": products, "total_value": total_value, "low": analytics.low_stock()},
    )


def _csv_response(filename, header, rows):
    response = HttpResponse(content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    response.write("﻿")  # BOM so Excel shows ₹ and Tamil names correctly
    writer = csv.writer(response)
    writer.writerow(header)
    writer.writerows(rows)
    return response


@manager_required
def export_csv(request, kind):
    start, end = _date_range(request)
    suffix = f"{start:%Y%m%d}-{end:%Y%m%d}.csv"
    if kind == "sales":
        items = SaleItem.objects.filter(sale__in=analytics.completed_sales(start, end)).select_related(
            "sale", "sale__cashier"
        )
        return _csv_response(
            f"sales_{suffix}",
            ["Bill no", "Date", "Cashier", "Customer", "Payment", "Item", "Qty", "Unit", "Rate", "Amount"],
            (
                [
                    i.sale.bill_no, timezone.localtime(i.sale.created_at).strftime("%Y-%m-%d %H:%M"),
                    i.sale.cashier.username, i.sale.customer_name, i.sale.get_payment_method_display(),
                    i.product_name, i.quantity, i.unit, i.unit_price, i.line_total,
                ]
                for i in items
            ),
        )
    if kind == "purchases":
        rows = Purchase.objects.filter(purchased_on__range=(start, end)).select_related("product", "supplier")
        return _csv_response(
            f"purchases_{suffix}",
            ["Date", "Supplier", "Invoice", "Product", "Qty", "Unit cost", "Total"],
            ([p.purchased_on, p.supplier or "", p.invoice_no, p.product.name, p.quantity, p.unit_cost, p.total_cost]
             for p in rows),
        )
    if kind == "expenses":
        rows = Expense.objects.filter(spent_on__range=(start, end)).select_related("category")
        return _csv_response(
            f"expenses_{suffix}",
            ["Date", "Category", "Description", "Amount"],
            ([e.spent_on, e.category.name, e.description, e.amount] for e in rows),
        )
    if kind == "stock":
        rows = Product.objects.filter(is_active=True).select_related("category")
        return _csv_response(
            f"stock_{timezone.localdate():%Y%m%d}.csv",
            ["Product", "Tamil name", "Category", "Unit", "Stock", "Reorder level", "Cost", "Selling", "Value"],
            ([p.name, p.tamil_name, p.category.name, p.unit, p.stock, p.reorder_level, p.cost_price,
              p.selling_price, p.stock_value] for p in rows),
        )
    return HttpResponse(status=404)
