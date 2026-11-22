from datetime import date, timedelta

from django.contrib import messages
from django.core.exceptions import PermissionDenied
from django.shortcuts import redirect, render
from django.utils import timezone

from accounts.permissions import require
from core.models import StoreSettings

from . import buylist, daysummary, losswatch, prices


def _wa(phone, text, cfg):
    """WhatsApp link for this shop's setting, or None if the number is not a valid Indian mobile."""
    from sales.whatsapp import PhoneError, links, normalise_phone

    try:
        ph = normalise_phone(phone)
    except PhoneError:
        return None
    return links(ph, text)["web" if cfg.whatsapp_open == "web" else "app"]


def _date(v, default):
    try:
        return date.fromisoformat(v)
    except (TypeError, ValueError):
        return default


def home(request):
    u = request.user
    if not any(u.can(p) for p in ("products", "purchase", "reports")):
        raise PermissionDenied
    return render(request, "owner/home.html", {"nav": "owner"})


@require("products")
def todays_prices(request):
    flt, q = request.GET.get("f", "loose"), request.GET.get("q", "").strip()
    if request.method == "POST":
        changes = {}
        for k, v in request.POST.items():
            if k.startswith("p_") or k.startswith("c_"):
                pk = int(k[2:])
                orig = request.POST.get(("op_" if k[0] == "p" else "oc_") + k[2:], "")
                if v.strip() and v.strip() != orig:
                    changes.setdefault(pk, {})["price" if k[0] == "p" else "cost"] = v
        try:
            n = prices.apply(changes, request.user)
            messages.success(request, f"{n} price{'s' if n != 1 else ''} changed. Each change is in the audit log." if n else "No prices were changed.")
        except ValueError as exc:
            messages.error(request, f"Nothing was saved. {exc}")
        return redirect(f"{request.path}?f={flt}&q={q}")
    return render(request, "owner/prices.html", {"nav": "owner", "items": prices.items_for(flt, q), "f": flt, "q": q,
                                                 "filters": prices.FILTERS})


@require("products")
def price_board(request):
    flt, q = request.GET.get("f", "loose"), request.GET.get("q", "").strip()
    items = [i for i in prices.items_for(flt, q) if i.price]
    return render(request, "owner/price_board.html", {"items": items, "cfg": StoreSettings.load(), "today": timezone.localdate(),
                                                      "big": request.GET.get("size") != "small"})


@require("purchase")
def buy_list(request):
    days = max(1, min(60, int(request.GET.get("days") or 7)))
    fresh = max(1, min(14, int(request.GET.get("fresh") or 1)))
    other = max(1, min(60, int(request.GET.get("other") or 7)))
    cfg = StoreSettings.load()
    groups = buylist.build(days, fresh, other)
    for g in groups:
        s = g["supplier"]
        g["wa"] = _wa(s.phone, buylist.message(g, cfg.name), cfg) if s and getattr(s, "phone", "") else None
    return render(request, "owner/buy_list.html", {"nav": "owner", "groups": groups, "days": days, "fresh": fresh, "other": other,
                                                   "total": sum(g["value"] for g in groups), "print": request.GET.get("print") == "1"})


@require("reports")
def loss_watch(request):
    today = timezone.localdate()
    start = _date(request.GET.get("start"), today)
    end = _date(request.GET.get("end"), today)
    if start > end:
        start, end = end, start
    return render(request, "owner/loss_watch.html", {"nav": "owner", "rows": losswatch.build(start, end), "start": start, "end": end,
                                                     "ranges": [("Today", today, today), ("Yesterday", today - timedelta(1), today - timedelta(1)),
                                                                ("Last 7 days", today - timedelta(6), today), ("This month", today.replace(day=1), today)]})


@require("reports")
def day_summary(request):
    cfg = StoreSettings.load()
    day = _date(request.GET.get("day"), timezone.localdate())
    text = daysummary.day_text(day, cfg)
    return render(request, "owner/day_summary.html", {"nav": "owner", "text": text, "day": day, "cfg": cfg,
                                                      "wa": _wa(cfg.owner_whatsapp, text, cfg) if cfg.owner_whatsapp else None})


@require("reports")
def credit_reminders(request):
    from customers.models import Customer

    cfg = StoreSettings.load()
    rows = []
    for c in Customer.objects.filter(credit_allowed=True).order_by("name"):
        bal = c.credit_balance
        if bal > 0:
            rows.append({"c": c, "bal": bal, "wa": _wa(c.phone or "", daysummary.credit_reminder_text(c, cfg), cfg)})
    rows.sort(key=lambda r: -r["bal"])
    return render(request, "owner/credit.html", {"nav": "owner", "rows": rows, "total": sum(r["bal"] for r in rows)})
