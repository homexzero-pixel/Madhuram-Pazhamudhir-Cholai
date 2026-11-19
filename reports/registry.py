"""Store reports. Each returns columns, rows and totals, and states its date basis.

Date basis: sales use the bill's business date (Asia/Kolkata); returns use the date the
refund was given, so a refund on a later day reduces that later day, not the original day.
"""
from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from django.db.models import Count, F, Q, Sum
from django.db.models.functions import ExtractHour
from django.urls import reverse
from django.utils import timezone

from core.money import ZERO

Q0 = Decimal("0.000")

R = {}


def report(key, title, group, basis, needs_dates=True):
    def deco(fn):
        R[key] = {"key": key, "title": title, "group": group, "basis": basis, "fn": fn, "dates": needs_dates}
        return fn
    return deco


def link(text, url):
    return {"v": text, "href": url}


def _sales(start, end):
    from sales.models import Sale

    return Sale.objects.filter(business_date__range=(start, end))


def _returns(start, end):
    from sales.models import SaleReturn

    return SaleReturn.objects.filter(business_date__range=(start, end))


def _rl(start, end):
    from sales.models import ReturnLine

    return ReturnLine.objects.filter(ret__business_date__range=(start, end))


def _sl(start, end):
    from sales.models import SaleLine

    return SaleLine.objects.filter(sale__business_date__range=(start, end))


def zsum(qs, f):
    return qs.aggregate(s=Sum(f))["s"] or ZERO


def summary(start, end):
    """Definitions used on the dashboard and in Daily sales."""
    from expenses.models import Expense

    lines = _sl(start, end)
    rl = _rl(start, end)
    gross = zsum(lines, "gross")
    disc = zsum(lines, "discount")
    net = gross - disc
    returns = zsum(rl, "amount")
    cogs = zsum(lines, "cost") - zsum(rl, "cost")
    expenses = zsum(Expense.objects.filter(spent_on__range=(start, end)), "amount")
    bills = _sales(start, end).count()
    return {"gross": gross, "discount": disc, "net": net, "returns": returns, "net_after_returns": net - returns, "cogs": cogs,
            "margin": net - returns - cogs, "expenses": expenses, "bills": bills, "avg_bill": (net / bills).quantize(Decimal("0.01")) if bills else ZERO,
            "operating": net - returns - cogs - expenses}


DEFINITIONS = [
    ("Gross sales", "Σ quantity × price charged, before offers and discounts"),
    ("Discounts", "offer and manual discounts on the bills"),
    ("Net sales", "gross sales − discounts = total of the bills"),
    ("Returns", "refunds given in the period (by refund date), at the price actually paid"),
    ("Cost of goods sold", "actual lot cost of what was sold, minus the cost of items returned"),
    ("Gross margin", "net sales − returns − cost of goods sold"),
]


@report("daily", "Daily sales", "Sales", "Sales by bill date; returns by refund date.")
def daily(start, end, **kw):
    rows, d = [], start
    from sales.models import Payment

    while d <= end:
        s = summary(d, d)
        cash = zsum(Payment.objects.filter(sale__business_date=d, method="cash"), "amount")
        rows.append([link(d.strftime("%d-%m-%Y (%a)"), f"?report=bills&start={d}&end={d}"), s["bills"], s["gross"], s["discount"], s["net"],
                     s["returns"], s["net_after_returns"], s["cogs"], s["margin"], cash])
        d += timedelta(days=1)
    t = summary(start, end)
    cols = ["Date", "Bills", "Gross", "Discounts", "Net sales", "Returns", "Net after returns", "COGS", "Gross margin", "of which cash"]
    totals = ["Total", t["bills"], t["gross"], t["discount"], t["net"], t["returns"], t["net_after_returns"], t["cogs"], t["margin"],
              sum((r[-1] for r in rows), ZERO)]
    return cols, rows, totals


@report("bills", "Bills (drill-down)", "Sales", "Bill date.")
def bills(start, end, request=None, **kw):
    qs = _sales(start, end).select_related("cashier", "customer").order_by("id")
    rows = [[link(s.bill_no, reverse("sale_detail", args=[s.pk])), timezone.localtime(s.created_at).strftime("%d-%m %H:%M"),
             s.cashier.username, str(s.customer or ""), s.gross, s.discount, s.total] for s in qs]
    return (["Bill", "Time", "Cashier", "Customer", "Gross", "Discount", "Total"], rows,
            ["Total", "", "", "", zsum(qs, "gross"), zsum(qs, "discount"), zsum(qs, "total")])


@report("items", "Item-wise sales", "Sales", "Sales by bill date; returns by refund date.")
def items(start, end, **kw):
    agg = defaultdict(lambda: {"name": "", "unit": "", "qty": Q0, "net": ZERO, "rq": Q0, "ra": ZERO, "cost": ZERO, "id": None})
    for r in _sl(start, end).values("item_id", "sku", "name", "unit").annotate(q=Sum("qty"), n=Sum("net"), c=Sum("cost")):
        a = agg[r["sku"]]
        a.update(name=r["name"], unit=r["unit"], id=r["item_id"])
        a["qty"] += r["q"]
        a["net"] += r["n"]
        a["cost"] += r["c"]
    for r in _rl(start, end).values("sale_line__sku", "sale_line__name", "sale_line__item_id").annotate(q=Sum("qty"), a=Sum("amount"), c=Sum("cost")):
        a = agg[r["sale_line__sku"]]
        a["name"] = a["name"] or r["sale_line__name"]
        a["id"] = a["id"] or r["sale_line__item_id"]
        a["rq"] += r["q"]
        a["ra"] += r["a"]
        a["cost"] -= r["c"]
    rows = sorted(([link(k, reverse("item_detail", args=[v["id"]])), v["name"], v["qty"], v["net"], v["rq"], v["ra"], v["net"] - v["ra"], v["cost"],
                    v["net"] - v["ra"] - v["cost"]] for k, v in agg.items()), key=lambda r: -r[6])
    cols = ["SKU", "Item", "Qty sold", "Net sales", "Qty returned", "Returns", "Net after returns", "COGS", "Margin"]
    return cols, rows, ["Total", "", "", sum((r[3] for r in rows), ZERO), "", sum((r[5] for r in rows), ZERO),
                        sum((r[6] for r in rows), ZERO), sum((r[7] for r in rows), ZERO), sum((r[8] for r in rows), ZERO)]


@report("categories", "Category-wise sales", "Sales", "Sales by bill date; returns by refund date. Click a category to see every bill line behind it.")
def categories(start, end, **kw):
    agg = defaultdict(lambda: [0, ZERO, ZERO, ZERO, ZERO])
    for r in _sl(start, end).values("category").annotate(n=Count("id"), g=Sum("gross"), d=Sum("discount"), c=Sum("cost")):
        a = agg[r["category"]]
        a[0] += r["n"]
        a[1] += r["g"] - r["d"]
        a[3] += r["c"]
    for r in _rl(start, end).values("sale_line__category").annotate(a=Sum("amount"), c=Sum("cost")):
        a = agg[r["sale_line__category"]]
        a[2] += r["a"]
        a[3] -= r["c"]
    rows = []
    for cat, (n, net, ret, cost, _) in sorted(agg.items(), key=lambda kv: -(kv[1][1] - kv[1][2])):
        rows.append([link(cat, f"?report=category_lines&category={cat}&start={start}&end={end}"), n, net, ret, net - ret, cost, net - ret - cost])
    cols = ["Category", "Lines", "Net sales", "Returns", "Net after returns", "COGS", "Margin"]
    return cols, rows, ["Total"] + [sum((r[i] for r in rows), ZERO if i > 1 else 0) for i in range(1, 7)]


@report("category_lines", "Category drill-down", "Sales", "Every bill line and return line in the category. The total equals the category row.")
def category_lines(start, end, request=None, **kw):
    cat = request.GET.get("category", "") if request else ""
    rows = []
    for l in _sl(start, end).filter(category=cat).select_related("sale").order_by("sale_id"):
        rows.append([link(l.sale.bill_no, reverse("sale_detail", args=[l.sale_id])), "Sale", l.sale.business_date.strftime("%d-%m-%Y"), l.name,
                     l.qty, l.gross, l.discount, l.net])
    for r in _rl(start, end).filter(sale_line__category=cat).select_related("ret", "sale_line"):
        rows.append([link(r.ret.number, reverse("return_detail", args=[r.ret_id])), "Return", r.ret.business_date.strftime("%d-%m-%Y"), r.sale_line.name,
                     -r.qty, ZERO, ZERO, -r.amount])
    return (["Bill / credit note", "Type", "Date", "Item", "Qty", "Gross", "Discount", "Net"], rows,
            ["Total (= net after returns)", "", "", cat, "", sum((r[5] for r in rows), ZERO), sum((r[6] for r in rows), ZERO), sum((r[7] for r in rows), ZERO)])


@report("hourly", "Hourly sales", "Sales", "Bill time (Asia/Kolkata).")
def hourly(start, end, **kw):
    data = {r["h"]: r for r in _sales(start, end).annotate(h=ExtractHour("created_at")).values("h").annotate(n=Count("id"), t=Sum("total"))}
    rows = [[f"{h:02d}:00–{h:02d}:59", data.get(h, {}).get("n", 0), data.get(h, {}).get("t") or ZERO] for h in range(6, 24) if h in data or 8 <= h <= 21]
    return ["Hour", "Bills", "Sales"], rows, ["Total", sum(r[1] for r in rows), sum((r[2] for r in rows), ZERO)]


@report("cashiers", "Cashier performance", "Sales", "Bills by bill date; refunds and cancellations by their own date.")
def cashiers(start, end, **kw):
    from accounts.models import User
    from sales.models import DraftBill

    rows = []
    for u in User.objects.all():
        s = _sales(start, end).filter(cashier=u)
        n = s.count()
        cancels = DraftBill.objects.filter(status="cancelled", cancelled_by=u, updated_at__date__range=(start, end)).count()
        refunds = _returns(start, end).filter(user=u)
        if not (n or cancels or refunds.exists()):
            continue
        total = zsum(s, "total")
        rows.append([u.display, n, total, (total / n).quantize(Decimal("0.01")) if n else ZERO, zsum(s, "discount"),
                     _sl(start, end).filter(sale__cashier=u, override_by__isnull=False).count(), cancels, zsum(refunds, "total")])
    return ["Cashier", "Bills", "Sales", "Average bill", "Discounts", "Price overrides", "Bills cancelled", "Refunds issued"], rows, None


@report("tenders", "Payment-method summary", "Sales", "Payments by bill date; refunds by refund date. Recording a payment is not the same as the bank settling it.")
def tenders(start, end, **kw):
    from sales.models import Payment

    rows = []
    for m, label in [("cash", "Cash"), ("upi", "UPI"), ("card", "Card"), ("credit", "Customer credit")]:
        p = Payment.objects.filter(sale__business_date__range=(start, end), method=m)
        paid = zsum(p, "amount")
        ref = zsum(_returns(start, end).filter(method=m), "total")
        unsettled = zsum(p.filter(settlement__isnull=True), "amount") if m in ("upi", "card") else ""
        rows.append([label, p.count(), paid, ref, paid - ref, unsettled])
    return ["Method", "Payments", "Received", "Refunded", "Net", "Not yet settled by bank"], rows, ["Total", sum(r[1] for r in rows),
                                                                                                    sum((r[2] for r in rows), ZERO), sum((r[3] for r in rows), ZERO), sum((r[4] for r in rows), ZERO), ""]


@report("discounts", "Discounts & offers", "Sales", "Bill date.")
def discounts(start, end, **kw):
    qs = _sl(start, end).filter(discount__gt=0).select_related("sale", "offer", "override_by").order_by("sale_id")
    rows = [[link(l.sale.bill_no, reverse("sale_detail", args=[l.sale_id])), l.name, l.qty, l.gross, l.discount, l.offer.name if l.offer else "Manual",
             l.discount_note] for l in qs]
    return ["Bill", "Item", "Qty", "Gross", "Discount", "Offer", "Note / approval"], rows, ["Total", "", "", sum((r[3] for r in rows), ZERO), sum((r[4] for r in rows), ZERO), "", ""]


@report("returns", "Returns register", "Sales", "Refund date. The original bill date is shown beside it.")
def returns(start, end, **kw):
    qs = _returns(start, end).select_related("sale", "user", "approved_by")
    rows = [[link(r.number, reverse("return_detail", args=[r.pk])), r.business_date.strftime("%d-%m-%Y"), link(r.sale.bill_no, reverse("sale_detail", args=[r.sale_id])),
             r.sale.business_date.strftime("%d-%m-%Y"), r.reason, r.get_method_display(), r.user.username, r.approved_by.username if r.approved_by else "", r.total] for r in qs]
    return ["Credit note", "Refund date", "Original bill", "Bill date", "Reason", "Refund by", "By", "Approved", "Amount"], rows, ["Total"] + [""] * 7 + [zsum(qs, "total")]


@report("margin", "Gross margin by department", "Sales", "Sales by bill date; returns by refund date.")
def margin(start, end, **kw):
    agg = defaultdict(lambda: [ZERO, ZERO, ZERO])
    for r in _sl(start, end).values("department").annotate(n=Sum("net"), c=Sum("cost")):
        agg[r["department"]][0] += r["n"]
        agg[r["department"]][2] += r["c"]
    for r in _rl(start, end).values("sale_line__department").annotate(a=Sum("amount"), c=Sum("cost")):
        agg[r["sale_line__department"]][1] += r["a"]
        agg[r["sale_line__department"]][2] -= r["c"]
    rows = []
    for d, (n, ret, c) in sorted(agg.items()):
        sales = n - ret
        rows.append([d, n, ret, sales, c, sales - c, f"{((sales - c) / sales * 100):.1f}%" if sales else "—"])
    t = [sum((r[i] for r in rows), ZERO) for i in range(1, 6)]
    return ["Department", "Net sales", "Returns", "Net after returns", "COGS", "Margin", "Margin %"], rows, ["Total"] + t + [f"{(t[4] / t[2] * 100):.1f}%" if t[2] else "—"]


@report("movers", "Fast & slow movers", "Stock", "Quantity sold by bill date. Slow movers: active items with stock that sold little or nothing.")
def movers(start, end, **kw):
    from catalog.models import Item

    sold = {r["item_id"]: r for r in _sl(start, end).values("item_id").annotate(q=Sum("qty"), n=Sum("net"), b=Count("sale", distinct=True))}
    rows = []
    for it in Item.objects.filter(Q(is_active=True) | Q(pk__in=sold.keys())).select_related("category"):
        s = sold.get(it.pk, {})
        rows.append([link(it.sku, reverse("item_detail", args=[it.pk])), it.name, it.category.name, s.get("q") or Q0, s.get("b") or 0, s.get("n") or ZERO, it.on_hand])
    rows.sort(key=lambda r: -r[5])
    return ["SKU", "Item", "Category", "Qty sold", "Bills", "Net sales", "Stock now"], rows, None


@report("purchases", "Purchase register", "Purchases", "Goods receipt date.")
def purchases(start, end, **kw):
    from purchasing.models import GoodsReceipt

    qs = GoodsReceipt.objects.filter(received_at__date__range=(start, end)).select_related("supplier")
    rows = [[link(g.number, reverse("grn_detail", args=[g.pk])), g.received_at.date().strftime("%d-%m-%Y"), g.supplier.name, g.invoice_no,
             g.invoice_date.strftime("%d-%m-%Y"), g.lines_total, g.invoice_total, g.invoice_difference] for g in qs]
    return ["GRN", "Received", "Supplier", "Invoice", "Invoice date", "Lines total", "Invoice total", "Difference"], rows, \
        ["Total", "", "", "", "", sum((r[5] for r in rows), ZERO), sum((r[6] for r in rows), ZERO), sum((r[7] for r in rows), ZERO)]


@report("suppliers", "Supplier outstanding", "Purchases", "As of now.", needs_dates=False)
def suppliers(start, end, **kw):
    from purchasing.models import Supplier

    rows = [[link(s.name, reverse("supplier_detail", args=[s.pk])), s.phone, s.payment_terms_days, s.outstanding()] for s in Supplier.objects.all()]
    return ["Supplier", "Phone", "Terms (days)", "Outstanding"], rows, ["Total", "", "", sum((r[3] for r in rows), ZERO)]


@report("valuation", "Stock valuation", "Stock", "As of now, at actual lot cost.", needs_dates=False)
def valuation(start, end, **kw):
    from inventory.models import StockLot

    agg = defaultdict(lambda: [0, Q0, ZERO])
    for l in StockLot.objects.filter(qty__gt=0).select_related("item__category").only("qty", "unit_cost", "status", "item__category__name"):
        a = agg[(l.item.category.name, l.status)]
        a[0] += 1
        a[1] += l.qty
        a[2] += (l.qty * l.unit_cost).quantize(Decimal("0.01"))
    rows = [[c, "Sellable" if s == "sellable" else "Quarantine", n, q, v] for (c, s), (n, q, v) in sorted(agg.items())]
    return ["Category", "Status", "Lots", "Units", "Value at cost"], rows, ["Total", "", sum(r[2] for r in rows), "", sum((r[4] for r in rows), ZERO)]


@report("movements", "Stock movements", "Stock", "Movement date.")
def movements(start, end, **kw):
    from inventory.models import StockMove

    qs = StockMove.objects.filter(at__date__range=(start, end))
    rows = []
    for r in qs.values("kind").annotate(n=Count("id"), q=Sum("qty")).order_by("kind"):
        val = sum((m.qty * m.unit_cost for m in qs.filter(kind=r["kind"]).only("qty", "unit_cost")), ZERO).quantize(Decimal("0.01"))
        rows.append([link(dict(StockMove.KINDS).get(r["kind"], r["kind"]), f"/inventory/ledger/?kind={r['kind']}"), r["n"], r["q"], val])
    return ["Movement", "Entries", "Net units", "Value at cost"], rows, None


@report("expiry", "Expiry", "Stock", "Lots with an expiry date between the From and To dates.")
def expiry(start, end, **kw):
    from inventory.models import StockLot

    qs = StockLot.objects.filter(qty__gt=0, expiry__range=(start, end)).select_related("item").order_by("expiry")
    rows = [[l.expiry.strftime("%d-%m-%Y"), link(l.item.name, reverse("item_detail", args=[l.item_id])), l.batch, l.pk, l.qty, l.get_status_display(),
             (l.qty * l.unit_cost).quantize(Decimal("0.01"))] for l in qs]
    return ["Expiry", "Item", "Batch", "Lot", "On hand", "Status", "Value at cost"], rows, ["Total", "", "", "", "", "", sum((r[6] for r in rows), ZERO)]


@report("wastage", "Wastage & write-offs", "Stock", "Write-off date.")
def wastage(start, end, **kw):
    from inventory.models import StockMove

    qs = StockMove.objects.filter(at__date__range=(start, end), kind__in=["waste", "damage", "expiry"]).select_related("item", "user", "approved_by")
    rows = [[timezone.localtime(m.at).strftime("%d-%m-%Y %H:%M"), m.item.name, m.get_kind_display(), -m.qty, -m.value, m.reason, m.user.username if m.user else "",
             m.approved_by.username if m.approved_by else ""] for m in qs]
    return ["When", "Item", "Type", "Qty", "Value at cost", "Reason", "By", "Approved"], rows, ["Total", "", "", "", sum((r[4] for r in rows), ZERO), "", "", ""]


@report("credit", "Customer credit", "Customers", "As of now.", needs_dates=False)
def credit(start, end, **kw):
    from customers.models import Customer

    rows = [[link(c.name, reverse("customer_detail", args=[c.pk])), c.phone or "", c.credit_limit, c.credit_balance]
            for c in Customer.objects.filter(Q(credit_allowed=True) | Q(credit_entries__isnull=False)).distinct()]
    return ["Customer", "Phone", "Limit", "Owes"], rows, ["Total", "", "", sum((r[3] for r in rows), ZERO)]


@report("expenses", "Expense register", "Money", "Expense date.")
def expenses(start, end, **kw):
    from expenses.models import Expense

    qs = Expense.objects.filter(spent_on__range=(start, end)).select_related("category", "created_by")
    rows = [[e.spent_on.strftime("%d-%m-%Y"), e.category.name, e.description, e.get_method_display(), e.reference, e.created_by.username, e.amount] for e in qs]
    return ["Date", "Category", "Description", "Paid by", "Voucher", "By", "Amount"], rows, ["Total", "", "", "", "", "", zsum(qs, "amount")]


@report("tax", "Tax summary (HSN / rate)", "Money",
        "Sales by bill date minus returns by refund date. Lines whose GST treatment is 'not set' are listed separately for the accountant.")
def tax(start, end, **kw):
    agg = defaultdict(lambda: [ZERO, ZERO, ZERO, ZERO])
    for r in _sl(start, end).values("tax_class", "hsn", "gst_rate").annotate(n=Sum("net"), t=Sum("taxable"), c=Sum("cgst"), s=Sum("sgst")):
        a = agg[(r["tax_class"], r["hsn"], r["gst_rate"])]
        a[0] += r["n"]
        a[1] += r["t"]
        a[2] += r["c"]
        a[3] += r["s"]
    for r in _rl(start, end).values("sale_line__tax_class", "sale_line__hsn", "sale_line__gst_rate").annotate(n=Sum("amount"), t=Sum("taxable"), c=Sum("cgst"), s=Sum("sgst")):
        a = agg[(r["sale_line__tax_class"], r["sale_line__hsn"], r["sale_line__gst_rate"])]
        a[0] -= r["n"]
        a[1] -= r["t"]
        a[2] -= r["c"]
        a[3] -= r["s"]
    labels = {"unset": "NOT SET – review", "taxable": "Taxable", "exempt": "Exempt", "nil": "Nil-rated", "non_gst": "Non-GST"}
    rows = [[labels.get(k[0], k[0]), k[1] or "—", f"{k[2]:g}%", *v] for k, v in sorted(agg.items(), key=lambda kv: (kv[0][0], kv[0][1]))]
    return ["Treatment", "HSN", "GST rate", "Net value (incl. tax)", "Taxable value", "CGST", "SGST"], rows, \
        ["Total", "", "", *[sum((r[i] for r in rows), ZERO) for i in range(3, 7)]]


@report("shifts", "Shift reconciliation", "Money", "Shift business date. Only cash affects the drawer.")
def shifts(start, end, **kw):
    from sales.models import Shift
    from sales.services import cash_summary

    rows = []
    for s in Shift.objects.filter(business_date__range=(start, end)).select_related("cashier").order_by("id"):
        c = cash_summary(s)
        rows.append([link(str(s.pk), reverse("shift_detail", args=[s.pk])), s.cashier.display, s.business_date.strftime("%d-%m-%Y"), s.status,
                     c["opening"], c["cash_sales"], c["other_in"], c["refunds"], c["expenses"], c["removed"], c["expected"], s.counted if s.counted is not None else "",
                     s.variance if s.variance is not None else "", c["tenders"]["upi"], c["tenders"]["card"]])
    return ["Shift", "Cashier", "Date", "Status", "Float", "Cash sales", "Other cash in", "Cash refunds", "Cash expenses", "Cash removed", "Expected",
            "Counted", "Variance", "UPI", "Card"], rows, None


@report("settlements", "UPI / card settlements", "Money", "Settlement date.")
def settlements_report(start, end, **kw):
    from sales.models import Settlement

    qs = Settlement.objects.filter(settled_on__range=(start, end))
    rows = [[s.settled_on.strftime("%d-%m-%Y"), s.get_method_display(), s.provider, s.bank_reference, s.expected, s.credited, s.fees, s.difference] for s in qs]
    return ["Date", "Method", "Provider", "Bank ref", "Expected", "Credited", "Fees", "Unexplained"], rows, None
