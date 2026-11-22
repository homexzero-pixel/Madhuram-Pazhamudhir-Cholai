"""Buy list: what to buy next, worked out from what actually sold.

For each product on sale: average daily sales over the last N days, stock now, what is already ordered and not yet received.
Target stock = average daily sales × days to cover (short for fresh produce, longer for packed goods), never below the reorder
level. Suggested quantity = target − stock − already ordered, rounded up to whole pieces / 0.5 kg / whole cartons."""
import math
from datetime import timedelta
from decimal import Decimal

from django.db.models import F, Q, Sum
from django.utils import timezone

from catalog.models import Item

ZERO = Decimal(0)


def is_fresh(item):
    return item.sale_unit == Item.KG or (item.department.name or "").lower() in ("fresh produce", "dairy & chilled", "bakery")


def build(days=7, fresh_cover=1, other_cover=7, supplier=None):
    from purchasing.models import POLine, PurchaseOrder
    from sales.models import SaleLine

    today = timezone.localdate()
    since = today - timedelta(days=days)
    sold = dict(SaleLine.objects.filter(sale__business_date__gt=since, sale__business_date__lte=today)
                .values("item").annotate(q=Sum(F("qty") - F("returned_qty"))).values_list("item", "q"))
    on_order = {}
    for pl in POLine.objects.filter(order__status__in=[PurchaseOrder.ORDERED, PurchaseOrder.PARTIAL]).select_related("item"):
        on_order[pl.item_id] = on_order.get(pl.item_id, ZERO) + (pl.qty - pl.received_qty) * pl.item.units_per_purchase
    qs = Item.objects.filter(is_active=True).filter(Q(pk__in=sold.keys()) | Q(on_hand__lte=F("reorder_level"), reorder_level__gt=0))
    if supplier:
        qs = qs.filter(preferred_supplier_id=supplier)
    groups = {}
    for it in qs.select_related("department", "preferred_supplier"):
        avg = Decimal(sold.get(it.pk) or 0) / days
        fresh = is_fresh(it)
        cover = fresh_cover if fresh else other_cover
        target = max(avg * cover, it.reorder_level)
        have = it.on_hand + on_order.get(it.pk, ZERO)
        need = target - have
        if need <= 0:
            continue
        if it.sale_unit == Item.KG:
            qty = Decimal(math.ceil(need * 2)) / 2
        else:
            qty = Decimal(math.ceil(need))
        upp = it.units_per_purchase or Decimal(1)
        packs = math.ceil(qty / upp) if upp > 1 else None
        if packs:
            qty = packs * upp
        key = it.preferred_supplier_id or 0
        g = groups.setdefault(key, {"supplier": it.preferred_supplier, "rows": [], "value": ZERO})
        value = (qty * (it.cost or 0)).quantize(Decimal("0.01"))
        g["rows"].append({"item": it, "avg": avg.quantize(Decimal("0.001")), "stock": it.on_hand, "on_order": on_order.get(it.pk, ZERO),
                          "target": target.quantize(Decimal("0.001")), "qty": qty, "packs": packs, "pack_unit": it.purchase_unit,
                          "fresh": fresh, "cover": cover, "value": value,
                          "days_left": (it.on_hand / avg).quantize(Decimal("0.1")) if avg else None})
        g["value"] += value
    out = sorted(groups.values(), key=lambda g: (g["supplier"] is None, g["supplier"].name if g["supplier"] else ""))
    for g in out:
        g["rows"].sort(key=lambda r: (r["days_left"] if r["days_left"] is not None else Decimal(9999), r["item"].name))
    return out


def message(group, store_name):
    """Order text for the supplier's WhatsApp."""
    from core.money import inr

    lines = [f"*Order from {store_name}*", timezone.localdate().strftime("%d-%m-%Y"), ""]
    for i, r in enumerate(group["rows"], 1):
        it = r["item"]
        q = f"{r['packs']} {r['pack_unit']} ({r['qty']:g} {it.unit_label})" if r["packs"] else f"{r['qty']:g} {it.unit_label}"
        lines.append(f"{i}. {it.name} – {q}")
    lines += ["", f"Approx. value {inr(group['value'])}", "Please confirm availability and rate. Thank you."]
    return "\n".join(lines)
