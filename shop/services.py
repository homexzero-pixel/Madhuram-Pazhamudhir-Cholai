"""Online shop rules: what customers can see and order, time slots, placing orders, and turning an order into a
normal counter bill (so stock, cash, GST and receipts work exactly as for walk-in customers)."""
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone

from catalog.models import Item
from core.models import Sequence, StoreSettings, audit

from .models import OnlineOrder, OnlineOrderLine

ZERO = Decimal(0)
DELIVERY_SKU = "DELIVERY"
MAX_LINES = 60
SLOT_FMT = "%Y-%m-%dT%H:%M"   # how a slot travels between the page and the server (shop's local time)


class OrderError(ValueError):
    pass


# ------------------------------------------------------------------ availability
def reserved(item_ids=None):
    """Quantity already promised to open online orders that are not billed yet."""
    qs = OnlineOrderLine.objects.filter(order__status__in=OnlineOrder.OPEN_STATUSES, order__sale__isnull=True)
    if item_ids is not None:
        qs = qs.filter(item_id__in=item_ids)
    return {r["item_id"]: r["q"] for r in qs.values("item_id").annotate(q=Sum("qty"))}


def item_dict(it, held):
    avail = max(it.on_hand - held.get(it.pk, ZERO), ZERO)
    return {"id": it.pk, "name": it.name, "name_ta": it.name_ta, "price": str(it.price), "mrp": str(it.mrp) if it.mrp else "",
            "weighed": it.weighed, "unit": it.unit_label, "available": f"{avail.normalize():f}", "in_stock": avail > 0,
            "category": it.category.name}


def catalogue(q="", cat="", code="", limit=120):
    qs = Item.objects.filter(is_active=True, price__isnull=False).exclude(sku=DELIVERY_SKU).select_related("category")
    if code:
        from catalog.models import Barcode

        b = Barcode.objects.select_related("item").filter(code=code.strip()).first()
        qs = qs.filter(pk=b.item_id) if b else qs.filter(Q(sku__iexact=code) | Q(plu=code))
    elif q:
        for w in q.split()[:5]:
            qs = qs.filter(Q(name__icontains=w) | Q(name_ta__icontains=w) | Q(brand__icontains=w))
    if cat and cat.isdigit():
        qs = qs.filter(category_id=int(cat))
    items = list(qs.order_by("-on_hand", "name")[:limit] if not (q or code or cat) else qs.order_by("name")[:limit])
    held = reserved([i.pk for i in items])
    return [item_dict(i, held) for i in items]


def categories():
    from catalog.models import Category

    return list(Category.objects.filter(items__is_active=True, items__price__isnull=False).exclude(items__sku=DELIVERY_SKU)
                .distinct().order_by("name").values("id", "name"))


# ------------------------------------------------------------------ time slots
def slots(cfg=None, now=None):
    """[(date, [slot datetimes])] customers may choose: from now + lead time, within opening hours, days ahead."""
    cfg = cfg or StoreSettings.load()
    now = timezone.localtime(now or timezone.now())
    earliest = now + timedelta(minutes=cfg.online_lead_minutes)
    step = timedelta(minutes=max(15, cfg.online_slot_minutes))
    out = []
    for d in range(max(1, cfg.online_days_ahead) + 1):
        day = (now + timedelta(days=d)).date()
        t = timezone.make_aware(datetime.combine(day, cfg.online_open))
        close = timezone.make_aware(datetime.combine(day, cfg.online_close))
        day_slots = []
        while t + step <= close + timedelta(seconds=1):
            if t >= earliest:
                day_slots.append(t)
            t += step
        if day_slots:
            out.append((day, day_slots))
    return out


def slot_label(t, cfg=None):
    cfg = cfg or StoreSettings.load()
    t = timezone.localtime(t)
    end = t + timedelta(minutes=max(15, cfg.online_slot_minutes))
    return f"{t:%a %d %b}, {t:%I:%M %p}–{end:%I:%M %p}".replace(" 0", " ")


def delivery_charge(cfg, mode, items_total):
    if mode != OnlineOrder.DELIVERY or cfg.online_delivery_charge <= 0:
        return ZERO
    if cfg.online_free_delivery_above and items_total >= cfg.online_free_delivery_above:
        return ZERO
    return cfg.online_delivery_charge


# ------------------------------------------------------------------ placing an order
def _qty(v, weighed):
    try:
        d = Decimal(str(v))
    except (InvalidOperation, TypeError):
        raise OrderError("A quantity is not a number.") from None
    if d <= 0 or d > 1000:
        raise OrderError("A quantity must be more than 0.")
    if weighed:
        if d != d.quantize(Decimal("0.001")):
            raise OrderError("Weights can have at most 3 decimals (e.g. 0.250 kg).")
    elif d != d.to_integral_value():
        raise OrderError("Packed items are ordered in whole pieces.")
    return d


@transaction.atomic
def place_order(data, ip=""):
    from sales.whatsapp import PhoneError, normalise_phone

    cfg = StoreSettings.load()
    if not cfg.online_enabled:
        raise OrderError("Online orders are closed at the moment. Please call the shop.")
    name = " ".join(str(data.get("name") or "").split())[:80]
    if len(name) < 2:
        raise OrderError("Please enter your name.")
    try:
        phone = normalise_phone(data.get("phone"))
    except PhoneError as exc:
        raise OrderError(str(exc)) from None
    mode = data.get("mode")
    if mode == OnlineOrder.PICKUP and not cfg.online_pickup or mode == OnlineOrder.DELIVERY and not cfg.online_delivery \
            or mode not in (OnlineOrder.PICKUP, OnlineOrder.DELIVERY):
        raise OrderError("Choose takeaway or home delivery.")
    address = " ".join(str(data.get("address") or "").split())[:300]
    if mode == OnlineOrder.DELIVERY and len(address) < 10:
        raise OrderError("Please enter the full delivery address with a landmark.")
    try:
        slot = timezone.make_aware(datetime.strptime(str(data.get("slot") or "")[:16], SLOT_FMT))
    except ValueError:
        raise OrderError("Please choose a time slot.") from None
    valid = {timezone.localtime(t).replace(second=0, microsecond=0) for _, ts in slots(cfg) for t in ts}
    if timezone.localtime(slot).replace(second=0, microsecond=0) not in valid:
        raise OrderError("That time slot is no longer available. Please choose another.")
    # limits against mistakes and abuse
    hour_ago = timezone.now() - timedelta(hours=1)
    if ip and OnlineOrder.objects.filter(ip=ip, created_at__gte=hour_ago).count() >= 5:
        raise OrderError("Too many orders from this connection. Please call the shop.")
    if OnlineOrder.objects.filter(phone=phone, status__in=OnlineOrder.OPEN_STATUSES).count() >= 3:
        raise OrderError("You already have 3 open orders. Please wait until one is completed, or call the shop.")
    raw = data.get("lines") or []
    if not raw:
        raise OrderError("Your cart is empty.")
    if len(raw) > MAX_LINES:
        raise OrderError(f"At most {MAX_LINES} different products in one order.")
    ids = [int(r.get("id", 0)) for r in raw if str(r.get("id", "")).isdigit()]
    items = {i.pk: i for i in Item.objects.select_for_update().filter(pk__in=ids, is_active=True, price__isnull=False).exclude(sku=DELIVERY_SKU)}
    held = reserved(list(items))
    lines, total, seen = [], ZERO, set()
    for r in raw:
        it = items.get(int(r.get("id", 0)) if str(r.get("id", "")).isdigit() else 0)
        if it is None:
            raise OrderError("A product in your cart is no longer sold online. Please refresh the page.")
        if it.pk in seen:
            continue
        seen.add(it.pk)
        q = _qty(r.get("qty"), it.weighed)
        avail = it.on_hand - held.get(it.pk, ZERO)
        if q > avail:
            raise OrderError(f"Only {max(avail, ZERO).normalize():f} {it.unit_label} of {it.name} available now. Please change the quantity.")
        lines.append((it, q))
        total += (q * it.price).quantize(Decimal("0.01"))
    if mode == OnlineOrder.DELIVERY and total < cfg.online_min_order:
        raise OrderError(f"Minimum order for home delivery is ₹{cfg.online_min_order:,.0f}. Add more, or choose takeaway.")
    seq = Sequence.next("online-order")
    order = OnlineOrder.objects.create(
        number=f"ON-{seq:05d}", name=name, phone=phone, mode=mode, slot=slot, address=address if mode == OnlineOrder.DELIVERY else "",
        notes=" ".join(str(data.get("notes") or "").split())[:300], pay_pref="upi" if data.get("pay") == "upi" else "cash",
        est_items=total, delivery_charge=delivery_charge(cfg, mode, total), ip=ip[:45])
    OnlineOrderLine.objects.bulk_create([OnlineOrderLine(order=order, item=it, name=it.name, name_ta=it.name_ta, unit=it.unit_label,
                                                         qty=q, price=it.price) for it, q in lines])
    audit("online_order", f"Online order {order.number} from {name} ({mode}, {len(lines)} items, about ₹{order.est_total})", obj=order)
    return order


# ------------------------------------------------------------------ staff actions
def set_status(order, status, user, note=""):
    allowed = {
        OnlineOrder.ACCEPTED: (OnlineOrder.NEW,),
        OnlineOrder.READY: (OnlineOrder.NEW, OnlineOrder.ACCEPTED),
        OnlineOrder.OUT: (OnlineOrder.NEW, OnlineOrder.ACCEPTED, OnlineOrder.READY),
        OnlineOrder.CANCELLED: OnlineOrder.OPEN_STATUSES,
    }
    if order.status not in allowed.get(status, ()):
        raise OrderError(f"Order {order.number} is {order.get_status_display().lower()}; it cannot be changed to that.")
    if status == OnlineOrder.CANCELLED:
        if not note.strip():
            raise OrderError("Enter why the order is cancelled (the customer will see it).")
        if order.sale_id:
            raise OrderError("This order is already billed; use a return instead.")
    order.status, order.status_note = status, note.strip()[:200] or order.status_note
    if status == OnlineOrder.ACCEPTED or (status in (OnlineOrder.READY, OnlineOrder.OUT) and not order.accepted_at):
        order.accepted_by, order.accepted_at = user, timezone.now()
    order.save()
    audit("online_order", f"Online order {order.number}: {order.get_status_display()}" + (f" – {note}" if note else ""), user=user, obj=order)
    return order


def ensure_delivery_item(charge):
    """A 'Delivery charge' line for the bill. It is a service: a large stock keeps the normal stock rules out of its way."""
    from catalog.models import BaseProduct, Category, Department
    from inventory import services as stock

    it = Item.objects.filter(sku=DELIVERY_SKU).first()
    if it is None:
        d, _ = Department.objects.get_or_create(name="Services")
        c, _ = Category.objects.get_or_create(department=d, name="Delivery")
        b, _ = BaseProduct.objects.get_or_create(name="Home delivery charge", defaults={"category": c})
        it = Item.objects.create(sku=DELIVERY_SKU, name="Home delivery charge", base=b, department=d, category=c,
                                 price=charge, cost=ZERO, is_active=True, status=Item.VERIFIED, reorder_level=0)
    if it.price != charge or not it.is_active:
        it.price, it.is_active = charge, True
        it.save(update_fields=["price", "is_active", "updated_at"])
    if it.on_hand < 100:
        stock.add_lot(it, Decimal(100000), ZERO, kind="opening", ref="SERVICE", reason="Delivery charge is a service, not stock")
    return it


@transaction.atomic
def load_to_counter(order, user):
    """Put the order on this cashier's bill. Weighed items can then be corrected to the actual weight (F4)."""
    from customers.models import Customer
    from sales import services as S

    order = OnlineOrder.objects.select_for_update().get(pk=order.pk)
    if order.sale_id:
        raise OrderError(f"{order.number} is already billed ({order.sale.bill_no}).")
    if not order.is_open:
        raise OrderError(f"{order.number} is {order.get_status_display().lower()}.")
    draft = S.current_draft(user)
    if draft.lines.exists():
        raise OrderError("Finish, hold (F8) or cancel the bill on the screen first.")
    for line in order.lines.select_related("item"):
        try:
            S.add_item(draft, line.item, line.qty, source="online", code=order.number)
        except S.BillingError as exc:
            raise OrderError(f"{line.name}: {exc}") from None
    if order.delivery_charge > 0:
        S.add_item(draft, ensure_delivery_item(order.delivery_charge), 1, source="online", code=order.number)
    last10 = order.phone[-10:]
    cust = Customer.objects.filter(phone__endswith=last10).first() or Customer.objects.create(name=order.name, phone=last10)
    draft.customer, draft.label = cust, order.number
    draft.save(update_fields=["customer", "label", "updated_at"])
    order.draft_uuid = draft.uuid
    if order.status == OnlineOrder.NEW:
        order.status, order.accepted_by, order.accepted_at = OnlineOrder.ACCEPTED, user, timezone.now()
    order.save()
    audit("online_order", f"Online order {order.number} loaded onto the counter bill", user=user, obj=order)
    return draft


def mark_billed(draft_uuid, sale):
    """Called by checkout: the order this bill came from is now completed."""
    OnlineOrder.objects.filter(draft_uuid=draft_uuid, sale__isnull=True).update(sale=sale, status=OnlineOrder.DONE, done_at=timezone.now())


def status_message(order, cfg=None):
    """WhatsApp text for the customer at the current status."""
    from core.money import inr

    cfg = cfg or StoreSettings.load()
    when = slot_label(order.slot, cfg)
    link = f"{cfg.public_url.rstrip('/')}/shop/o/{order.token}/" if cfg.public_url else ""
    head = f"*{cfg.name}* – order *{order.number}*\n"
    body = {
        OnlineOrder.NEW: f"We have received your order. We will confirm it shortly.\n{when}",
        OnlineOrder.ACCEPTED: f"Your order is confirmed and being packed. {'Pickup' if order.mode == 'pickup' else 'Delivery'}: {when}.",
        OnlineOrder.READY: f"Your order is ready for pickup at the counter. Approx. {inr(order.est_total)}.",
        OnlineOrder.OUT: "Your order is out for delivery. Please keep cash/UPI ready.",
        OnlineOrder.DONE: "Thank you! Your order is complete." + (f" Bill {order.sale.bill_no}, {inr(order.sale.total)}." if order.sale_id else ""),
        OnlineOrder.CANCELLED: f"Sorry, your order was cancelled: {order.status_note}",
    }[order.status]
    return head + body + (f"\nTrack: {link}" if link and order.is_open else "") + "\nநன்றி 🙏"
