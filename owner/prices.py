"""Today's prices: change many selling prices (and today's buying rate) in one go, e.g. every morning after the mandi."""
from decimal import Decimal, InvalidOperation

from django.db import transaction

from catalog.models import Item
from core.models import audit

FILTERS = [("loose", "Loose (sold by kg)"), ("produce", "Fresh produce"), ("all", "Everything on sale")]


def items_for(flt, q=""):
    qs = Item.objects.filter(is_active=True).select_related("department", "category")
    if flt == "loose":
        qs = qs.filter(sale_unit=Item.KG)
    elif flt == "produce":
        qs = qs.filter(department__name__iexact="Fresh produce")
    if q:
        from django.db.models import Q
        qs = qs.filter(Q(name__icontains=q) | Q(name_ta__icontains=q) | Q(sku__iexact=q) | Q(plu=q))
    return qs.order_by("category__name", "name")[:400]


def _money(v, label):
    v = (v or "").strip().replace(",", "").replace("₹", "")
    if v == "":
        return None
    try:
        d = Decimal(v)
    except InvalidOperation:
        raise ValueError(f"{label}: '{v}' is not a number.") from None
    if d <= 0 or d != d.quantize(Decimal("0.01")):
        raise ValueError(f"{label}: must be more than ₹0 with at most 2 decimals.")
    return d


@transaction.atomic
def apply(changes, user):
    """changes: {item_id: {"price": "..", "cost": ".."}}. All-or-nothing. Returns the number of products changed."""
    items = {i.pk: i for i in Item.objects.select_for_update().filter(pk__in=changes.keys())}
    errors, done = [], []
    for pk, c in changes.items():
        it = items.get(pk)
        if not it:
            continue
        try:
            price, cost = _money(c.get("price"), it.name), _money(c.get("cost"), it.name + " (buying rate)")
        except ValueError as exc:
            errors.append(str(exc))
            continue
        if price is not None and it.mrp and price > it.mrp:
            errors.append(f"{it.name}: ₹{price} is above the MRP ₹{it.mrp}.")
            continue
        parts = []
        if price is not None and price != it.price:
            parts.append(f"price ₹{it.price} → ₹{price}")
            it.price = price
        if cost is not None and cost != it.cost:
            parts.append(f"buying rate ₹{it.cost} → ₹{cost}")
            it.cost = cost
        if parts:
            done.append((it, parts))
    if errors:
        transaction.set_rollback(True)
        raise ValueError(" ".join(errors[:8]) + (f" (+{len(errors) - 8} more)" if len(errors) > 8 else ""))
    for it, parts in done:
        it.save(update_fields=["price", "cost", "updated_at"])
        audit("price_change", f"Today's prices – {it.sku} {it.name}: " + "; ".join(parts), user=user, obj=it)
    return len(done)
