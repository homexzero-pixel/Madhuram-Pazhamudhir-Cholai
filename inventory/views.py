from datetime import timedelta

from django.contrib import messages
from django.core.exceptions import PermissionDenied
from django.core.paginator import Paginator
from django.db import transaction
from django.db.models import F, Max, Q, Sum
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views.decorators.http import require_POST

from accounts.permissions import authorise, require
from catalog.models import Category, Item
from core.models import StoreSettings, audit
from core.money import ZERO, D

from . import services as stock
from .models import StockCount, StockCountLine, StockLot, StockMove

VIEWS = [
    ("low", "Low stock"), ("out", "Out of stock"), ("expiry", "Near expiry"), ("expired", "Expired (blocked)"),
    ("dead", "Dead stock"), ("quarantine", "Quarantine"), ("wastage", "Wastage & damage"), ("lots", "All lots"),
]


@require("stock_view")
def stock_home(request):
    view = request.GET.get("view", "low")
    cfg = StoreSettings.load()
    today = timezone.localdate()
    ctx = {"nav": "inventory", "view": view, "views": VIEWS, "cfg": cfg, "q": request.GET.get("q", "")}
    active = Item.objects.filter(is_active=True).select_related("category")
    if view == "low":
        rows = active.filter(on_hand__gt=0, on_hand__lte=F("reorder_level")).order_by("on_hand")
    elif view == "out":
        rows = active.filter(on_hand__lte=0).order_by("name")
    elif view == "dead":
        cutoff = timezone.now() - timedelta(days=cfg.dead_stock_days)
        rows = active.filter(on_hand__gt=0).annotate(last_sale=Max("moves__at", filter=Q(moves__kind="sale"))).filter(
            Q(last_sale__lt=cutoff) | Q(last_sale__isnull=True)).order_by("last_sale")
    else:
        rows = None
    if rows is not None:
        ctx["page"] = Paginator(rows, 50).get_page(request.GET.get("page"))
    else:
        lots = StockLot.objects.select_related("item").filter(qty__gt=0)
        if view == "expiry":
            lots = lots.filter(status=StockLot.SELLABLE, expiry__gte=today, expiry__lte=today + timedelta(days=cfg.near_expiry_days)).order_by("expiry")
        elif view == "expired":
            lots = lots.filter(status=StockLot.SELLABLE, expiry__lt=today).order_by("expiry")
        elif view == "quarantine":
            lots = lots.filter(status=StockLot.QUARANTINE)
        elif view == "wastage":
            ctx["moves"] = Paginator(StockMove.objects.select_related("item", "user", "approved_by").filter(
                kind__in=["waste", "damage", "expiry"]).order_by("-at"), 50).get_page(request.GET.get("page"))
            ctx["waste_value"] = sum((-m.qty * m.unit_cost for m in StockMove.objects.filter(kind__in=["waste", "damage", "expiry"], at__date__gte=today - timedelta(days=30))), ZERO)
            return render(request, "inventory/home.html", ctx)
        if ctx["q"]:
            lots = lots.filter(Q(item__name__icontains=ctx["q"]) | Q(item__sku=ctx["q"].upper()) | Q(batch__icontains=ctx["q"]))
        ctx["lots"] = Paginator(lots.order_by("expiry", "id") if view == "lots" else lots, 50).get_page(request.GET.get("page"))
    return render(request, "inventory/home.html", ctx)


@require("write_off")
def write_off(request, lot_id):
    lot = get_object_or_404(StockLot.objects.select_related("item"), pk=lot_id)
    if request.method == "POST":
        kind = request.POST.get("kind")
        try:
            if kind == "quarantine":
                stock.quarantine(lot, request.POST.get("qty"), reason=request.POST.get("reason", ""), user=request.user)
            elif kind == "release":
                if not request.user.can("stocktake_approve"):
                    raise PermissionDenied("Only a manager can release quarantined stock for sale.")
                with transaction.atomic():
                    q = D(request.POST.get("qty"))
                    stock.remove_from_lot(lot, q, "transfer_out", reason=request.POST.get("reason", "") or "Released after check", user=request.user)
                    stock.add_lot(lot.item, q, lot.unit_cost, kind="transfer_in", batch=lot.batch, expiry=lot.expiry, ref=f"REL-{lot.pk}",
                                  supplier=lot.supplier, user=request.user, origin=lot, reason="Released from quarantine")
            elif kind in ("waste", "damage", "expiry"):
                stock.remove_from_lot(lot, request.POST.get("qty"), kind, reason=request.POST.get("reason", ""), user=request.user)
            else:
                raise ValueError("Choose what happened to the stock.")
            messages.success(request, "Recorded in the stock ledger.")
            return redirect(f"/products/{lot.item_id}/")
        except (ValueError, PermissionDenied) as exc:
            messages.error(request, str(exc))
    return render(request, "inventory/write_off.html", {"nav": "inventory", "lot": lot})


# ------------------------------------------------------------------ stocktake
@require("stocktake")
def counts(request):
    if request.method == "POST":
        cat = Category.objects.filter(pk=request.POST.get("category")).first()
        items = Item.objects.filter(is_active=True)
        if cat:
            items = items.filter(category=cat)
        title = request.POST.get("title") or f"Count {cat or 'all active items'} {timezone.localdate():%d-%m-%Y}"
        with transaction.atomic():
            sc = StockCount.objects.create(title=title[:100], created_by=request.user)
            lines = []
            for it in items.order_by("name"):
                lots = list(it.lots.filter(status=StockLot.SELLABLE, qty__gt=0))
                if it.track_batch or it.track_expiry:
                    lines += [StockCountLine(count=sc, item=it, lot=l, expected=l.qty) for l in lots]
                if not (it.track_batch or it.track_expiry) or not lots:
                    lines.append(StockCountLine(count=sc, item=it, expected=it.on_hand))
            StockCountLine.objects.bulk_create(lines)
        messages.success(request, f"Count sheet created with {len(lines)} lines. Enter the counted quantities.")
        return redirect("count_detail", pk=sc.pk)
    return render(request, "inventory/counts.html", {"nav": "inventory", "counts": StockCount.objects.select_related("created_by", "approved_by")[:30],
                                                     "categories": Category.objects.select_related("department")})


@require("stocktake")
def count_detail(request, pk):
    sc = get_object_or_404(StockCount, pk=pk)
    lines = sc.lines.select_related("item", "lot").order_by("item__name")
    if request.method == "POST" and sc.status == StockCount.OPEN:
        action = request.POST.get("action")
        with transaction.atomic():
            for l in lines:
                v = request.POST.get(f"c{l.pk}", "").strip()
                l.counted = D(v) if v != "" else None
                l.reason = request.POST.get(f"r{l.pk}", "")[:120]
                l.save(update_fields=["counted", "reason"])
        if action == "approve":
            try:
                approver = authorise(request.user, "stocktake_approve", request.POST.get("approver", ""), request.POST.get("pin", ""))
                _approve(sc, approver, request.user)
                messages.success(request, "Stock adjusted to the counted quantities.")
            except (ValueError, PermissionDenied) as exc:
                messages.error(request, str(exc))
        else:
            messages.success(request, "Counts saved.")
        return redirect("count_detail", pk=pk)
    return render(request, "inventory/count_detail.html", {"nav": "inventory", "sc": sc, "lines": lines})


@transaction.atomic
def _approve(sc, approver, user):
    sc = StockCount.objects.select_for_update().get(pk=sc.pk)
    if sc.status != StockCount.OPEN:
        raise ValueError("Already approved.")
    lines = list(sc.lines.select_related("item", "lot"))
    for l in lines:
        if l.counted is None or l.counted == l.expected:
            continue
        if not l.reason.strip():
            raise ValueError(f"{l.item.name}: enter a reason for the difference.")
        ref = f"COUNT-{sc.pk}"
        reason = f"Stocktake: expected {l.expected:f}, counted {l.counted:f} ({l.reason})"
        if l.lot_id:
            stock.adjust_lot(l.lot, l.lot.qty + (l.counted - l.expected), reason=reason, user=user, approved_by=approver, ref=ref)
        else:
            diff = l.counted - l.expected
            if diff > 0:
                cost = l.item.cost or ZERO
                lot = stock.add_lot(l.item, diff, cost, kind="adjust", ref=ref, user=user, reason=reason)
                StockMove.objects.filter(lot=lot).update(approved_by=approver)
            else:
                remaining = -diff
                for lot in stock.sellable_lots(l.item) + list(l.item.lots.filter(status=StockLot.SELLABLE, qty__gt=0, expiry__lt=timezone.localdate())):
                    if remaining <= 0:
                        break
                    take = min(lot.qty, remaining)
                    stock.adjust_lot(lot, lot.qty - take, reason=reason, user=user, approved_by=approver, ref=ref)
                    remaining -= take
        audit("stocktake_adjust", f"{l.item.sku} {l.item.name}: expected {l.expected:f}, counted {l.counted:f} ({l.reason})",
              user=user, approved_by=approver, obj=l.item)
    sc.status, sc.approved_by, sc.approved_at = StockCount.APPROVED, approver, timezone.now()
    sc.save()


@require("stock_view")
def ledger(request):
    moves = StockMove.objects.select_related("item", "user")
    if request.GET.get("kind"):
        moves = moves.filter(kind=request.GET["kind"])
    if request.GET.get("q"):
        q = request.GET["q"]
        moves = moves.filter(Q(item__name__icontains=q) | Q(item__sku=q.upper()) | Q(ref__icontains=q))
    return render(request, "inventory/ledger.html", {"nav": "inventory", "page": Paginator(moves, 60).get_page(request.GET.get("page")),
                                                     "kinds": StockMove.KINDS})
