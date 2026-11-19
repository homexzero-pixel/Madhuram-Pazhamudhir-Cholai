"""Aggregations shared by the dashboard and the reports pages."""
from datetime import timedelta
from decimal import Decimal

from django.db.models import Count, DecimalField, ExpressionWrapper, F, Sum
from django.db.models.functions import TruncDate

from expenses.models import Expense
from inventory.models import Product, Purchase
from sales.models import Sale, SaleItem

ZERO = Decimal("0")


def completed_sales(start, end):
    return Sale.objects.filter(
        status=Sale.STATUS_COMPLETED, created_at__date__gte=start, created_at__date__lte=end
    )


def summary(start, end):
    sales = completed_sales(start, end)
    agg = sales.aggregate(revenue=Sum("total"), discount=Sum("discount"), bills=Count("id"))
    cost = SaleItem.objects.filter(sale__in=sales).aggregate(
        c=Sum(ExpressionWrapper(F("quantity") * F("unit_cost"), output_field=DecimalField()))
    )["c"] or ZERO
    revenue = agg["revenue"] or ZERO
    purchases = Purchase.objects.filter(purchased_on__range=(start, end)).aggregate(s=Sum("total_cost"))["s"] or ZERO
    expenses = Expense.objects.filter(spent_on__range=(start, end)).aggregate(s=Sum("amount"))["s"] or ZERO
    gross = revenue - cost
    return {
        "revenue": revenue,
        "bills": agg["bills"],
        "discount": agg["discount"] or ZERO,
        "avg_bill": (revenue / agg["bills"]).quantize(Decimal("0.01")) if agg["bills"] else ZERO,
        "cost_of_goods": Decimal(cost).quantize(Decimal("0.01")),
        "gross_profit": Decimal(gross).quantize(Decimal("0.01")),
        "purchases": purchases,
        "expenses": expenses,
        "net_profit": Decimal(gross - expenses).quantize(Decimal("0.01")),
    }


def daily_sales(start, end):
    rows = (
        completed_sales(start, end)
        .annotate(day=TruncDate("created_at"))
        .values("day")
        .annotate(total=Sum("total"), bills=Count("id"))
        .order_by("day")
    )
    by_day = {r["day"]: r for r in rows}
    out, day = [], start
    while day <= end:
        r = by_day.get(day)
        out.append({"day": day, "total": r["total"] if r else ZERO, "bills": r["bills"] if r else 0})
        day += timedelta(days=1)
    return out


def top_products(start, end, limit=10):
    return list(
        SaleItem.objects.filter(sale__in=completed_sales(start, end))
        .values("product_name", "unit")
        .annotate(qty=Sum("quantity"), revenue=Sum("line_total"))
        .order_by("-revenue")[:limit]
    )


def payment_split(start, end):
    labels = dict(Sale.PAYMENT_CHOICES)
    return [
        {"method": labels.get(r["payment_method"], r["payment_method"]), "total": r["total"], "bills": r["bills"]}
        for r in completed_sales(start, end)
        .values("payment_method")
        .annotate(total=Sum("total"), bills=Count("id"))
        .order_by("-total")
    ]


def expenses_by_category(start, end):
    return list(
        Expense.objects.filter(spent_on__range=(start, end))
        .values("category__name")
        .annotate(total=Sum("amount"))
        .order_by("-total")
    )


def low_stock(limit=None):
    qs = Product.objects.filter(is_active=True, stock__lte=F("reorder_level")).order_by("stock")
    return qs[:limit] if limit else qs
