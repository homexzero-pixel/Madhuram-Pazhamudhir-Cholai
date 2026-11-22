"""Loss watch: every action that can hide a loss, per cashier, with a plain-language flag when something needs a look.

Cancelled bills and removed items (the classic "take the cash, then cancel" pattern), price overrides, manual discounts,
refunds, reprints, unknown barcodes, cash shortages and bills that were never printed."""
from collections import defaultdict
from datetime import datetime, time
from decimal import Decimal

from django.db.models import Count, F, Sum
from django.utils import timezone

from accounts.models import User
from core.models import AuditLog

ZERO = Decimal(0)


def _dec(v):
    try:
        return Decimal(str(v))
    except Exception:  # noqa: BLE001
        return ZERO


def build(start, end):
    from sales.models import Sale, SaleLine, SaleReturn, Shift

    tz = timezone.get_current_timezone()
    t0, t1 = datetime.combine(start, time.min, tz), datetime.combine(end, time.max, tz)
    rows = defaultdict(lambda: defaultdict(lambda: ZERO))

    for s in Sale.objects.filter(business_date__range=(start, end)).values("cashier").annotate(n=Count("id"), v=Sum("total")):
        rows[s["cashier"]]["bills"] = Decimal(s["n"]); rows[s["cashier"]]["sales"] = s["v"] or ZERO
    for s in Sale.objects.filter(business_date__range=(start, end), print_count=0).values("cashier").annotate(n=Count("id")):
        rows[s["cashier"]]["unprinted"] = Decimal(s["n"])
    for a in AuditLog.objects.filter(at__range=(t0, t1), action__in=["bill_cancel", "line_remove", "reprint", "unknown_barcode"]):
        if a.user_id is None:
            continue
        r = rows[a.user_id]
        r[a.action] += 1
        r[a.action + "_value"] += _dec(a.data.get("value", 0))
    for l in SaleLine.objects.filter(sale__business_date__range=(start, end), override_by__isnull=False).select_related("sale"):
        r = rows[l.sale.cashier_id]
        r["overrides"] += 1
        r["overrides_value"] += max((l.list_price - l.rate) * l.qty, ZERO)
    for l in (SaleLine.objects.filter(sale__business_date__range=(start, end), offer__isnull=True, discount__gt=0)
              .values("sale__cashier").annotate(n=Count("id"), v=Sum("discount"))):
        rows[l["sale__cashier"]]["discounts"] = Decimal(l["n"]); rows[l["sale__cashier"]]["discounts_value"] = l["v"] or ZERO
    for rt in SaleReturn.objects.filter(business_date__range=(start, end)).values("user", "method").annotate(n=Count("id"), v=Sum("total")):
        r = rows[rt["user"]]
        r["refunds"] += rt["n"]; r["refunds_value"] += rt["v"] or ZERO
        if rt["method"] == "cash":
            r["cash_refunds_value"] += rt["v"] or ZERO
    for sh in Shift.objects.filter(business_date__range=(start, end), status=Shift.CLOSED).values("cashier").annotate(v=Sum("variance"), n=Count("id")):
        rows[sh["cashier"]]["variance"] = sh["v"] or ZERO
        rows[sh["cashier"]]["shifts"] = Decimal(sh["n"])

    users = {u.pk: u for u in User.objects.filter(pk__in=rows.keys())}
    days = (end - start).days + 1
    out = []
    for uid, r in rows.items():
        bills = r["bills"] or Decimal(1)
        flags = []
        if r["bill_cancel"] >= 2 * days or r["bill_cancel_value"] >= 1000 * days:
            flags.append(f"{int(r['bill_cancel'])} bills cancelled (₹{r['bill_cancel_value']:.0f}) – check the reasons and the CCTV time")
        if r["line_remove"] and r["line_remove"] / bills > Decimal("0.15"):
            flags.append(f"items removed on {int(r['line_remove'])} occasions – high for {int(r['bills'])} bills")
        if r["overrides"] >= 3 * days:
            flags.append(f"{int(r['overrides'])} price changes at the counter (₹{r['overrides_value']:.0f} below list)")
        if r["discounts_value"] > max(Decimal(200) * days, r["sales"] * Decimal("0.02")):
            flags.append(f"manual discounts ₹{r['discounts_value']:.0f}")
        if r["cash_refunds_value"] >= 500 * days or r["refunds"] >= 3 * days:
            flags.append(f"{int(r['refunds'])} refunds (₹{r['refunds_value']:.0f}, cash ₹{r['cash_refunds_value']:.0f})")
        if r["variance"] < 0:
            flags.append(f"cash short by ₹{-r['variance']:.2f}")
        if r["unprinted"]:
            flags.append(f"{int(r['unprinted'])} bills never printed")
        if r["reprint"] >= 5 * days:
            flags.append(f"{int(r['reprint'])} reprints")
        u = users.get(uid)
        out.append({"user": u, "name": u.display if u else "—", "r": dict(r), "flags": flags})
    out.sort(key=lambda x: (-len(x["flags"]), x["name"]))
    return out
