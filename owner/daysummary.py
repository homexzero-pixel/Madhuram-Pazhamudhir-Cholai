"""The owner's day on one WhatsApp message, and polite credit (udhaar) reminders. Free: opened in the shop's WhatsApp."""
from datetime import timedelta
from decimal import Decimal

from django.db.models import F, Sum
from django.utils import timezone

from core.money import inr

ZERO = Decimal(0)


def day_text(day, cfg):
    from catalog.models import Item
    from inventory.models import StockLot, StockMove
    from reports.registry import summary
    from sales.models import Payment, SaleLine, Shift

    from . import losswatch

    t = summary(day, day)
    m = summary(day.replace(day=1), day)
    tend = {k: Payment.objects.filter(sale__business_date=day, method=k).aggregate(s=Sum("amount"))["s"] or ZERO
            for k in ("cash", "upi", "card", "credit")}
    waste = StockMove.objects.filter(at__date=day, kind__in=["waste", "damage", "expiry"]).aggregate(
        v=Sum(F("qty") * F("unit_cost")))["v"] or ZERO
    shifts = Shift.objects.filter(business_date=day, status=Shift.CLOSED)
    variance = shifts.aggregate(s=Sum("variance"))["s"] or ZERO
    top = (SaleLine.objects.filter(sale__business_date=day).values("name").annotate(v=Sum("net")).order_by("-v")[:5])
    low = Item.objects.filter(is_active=True, on_hand__lte=F("reorder_level"), reorder_level__gt=0).count()
    exp = StockLot.objects.filter(qty__gt=0, status="sellable", expiry__range=(day, day + timedelta(days=cfg.near_expiry_days))).count()
    flags = [(r["name"], f) for r in losswatch.build(day, day) for f in r["flags"]]

    L = [f"*{cfg.name} – {day:%a %d-%m-%Y}*", "",
         f"Net sales: *{inr(t['net'])}* ({t['bills']} bills, avg {inr(t['avg_bill'])})"]
    if t["returns"]:
        L.append(f"Returns: -{inr(t['returns'])}")
    L += [f"Cash {inr(tend['cash'])} · UPI {inr(tend['upi'])} · Card {inr(tend['card'])}" + (f" · Credit {inr(tend['credit'])}" if tend["credit"] else ""),
          f"Gross margin: {inr(t['margin'])}" + (f" · Expenses {inr(t['expenses'])}" if t["expenses"] else "")]
    if waste:
        L.append(f"Wastage / damage / expired: {inr(abs(waste))}")
    if shifts:
        L.append(f"Cash closing: {shifts.count()} shift(s), difference {inr(variance)}" + (" ✅" if variance == 0 else " ⚠️"))
    else:
        L.append("Cash closing: no shift closed yet ⚠️")
    if top:
        L += ["", "Top sellers today:"] + [f"• {x['name']} {inr(x['v'])}" for x in top]
    L += ["", f"This month so far: {inr(m['net'])} net, margin {inr(m['margin'])}"]
    alerts = []
    if low:
        alerts.append(f"{low} items at or below reorder level (see Buy list)")
    if exp:
        alerts.append(f"{exp} lots expiring within {cfg.near_expiry_days} days")
    alerts += [f"{n}: {f}" for n, f in flags]
    try:
        from core.backup import health
        alerts += [f"{h['label']} not up to date" for h in health() if not h["ok"]]
    except Exception:  # noqa: BLE001
        pass
    L += ["", "*Needs a look:*"] + [f"⚠️ {a}" for a in alerts] if alerts else ["", "Nothing unusual today ✅"]
    return "\n".join(L)


def credit_reminder_text(customer, cfg):
    bal = customer.credit_balance
    return (f"Dear {customer.name},\n"
            f"This is a friendly reminder from *{cfg.name}*. Your pending balance is *{inr(bal)}* as of "
            f"{timezone.localdate():%d-%m-%Y}. Please pay at the counter or by UPI at your convenience.\n"
            f"அன்புடையீர், உங்கள் நிலுவைத் தொகை {inr(bal)}. வசதியான நேரத்தில் செலுத்தவும்.\n"
            f"Thank you! 🙏" + (f"\n{cfg.phone}" if cfg.phone else ""))
