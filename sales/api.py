"""JSON endpoints used by the billing screen. Every change is saved on the server at once,
so a browser refresh or a power cut never loses the bill on the counter."""
from decimal import Decimal
import json
from functools import wraps

from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.urls import reverse
from django.views.decorators.http import require_GET, require_POST

from accounts.permissions import authorise, require
from catalog.models import Barcode, Item
from core.models import audit
from core.money import D, fmt_qty, money
from core.scale import ScaleLabelError
from customers.models import Customer

from . import services as S
from .models import DraftBill, DraftLine


def api(view):
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        try:
            body = json.loads(request.body or b"{}") if request.method == "POST" else {}
        except ValueError:
            return JsonResponse({"ok": False, "error": "Bad request."}, status=400)
        try:
            return view(request, body, *args, **kwargs)
        except (S.BillingError, ScaleLabelError, ValueError) as exc:
            return JsonResponse({"ok": False, "error": str(exc), **state(request.user)}, status=200)
        except PermissionDenied as exc:
            return JsonResponse({"ok": False, "error": str(exc), "needs_approval": True, **state(request.user)}, status=200)

    return require("bill")(wrapped)


def _line_dict(ql):
    it, dl = ql.item, ql.draft_line
    return {
        "id": dl.pk, "sku": it.sku, "name": it.name, "name_ta": it.name_ta, "pack": it.pack_size, "unit": it.unit_label,
        "weighed": it.weighed, "qty": fmt_qty(ql.qty), "rate": str(ql.rate), "list_price": str(ql.list_price),
        "gross": str(ql.gross), "discount": str(ql.discount), "net": str(ql.net), "notes": ql.notes,
        "override": dl.price_override is not None, "mrp": str(it.mrp) if it.mrp else None,
    }


def state(user):
    draft = S.current_draft(user)
    q = S.quote(draft)
    shift = S.open_shift()
    cust = draft.customer
    held = DraftBill.objects.filter(status=DraftBill.HELD).order_by("updated_at")
    return {
        "draft": str(draft.uuid),
        "lines": [_line_dict(l) for l in q.lines],
        "gross": str(q.gross), "discount": str(q.discount), "total": str(q.total),
        "count": len(q.lines), "problems": q.problems,
        "customer": None if cust is None else {
            "id": cust.pk, "name": cust.name, "phone": cust.phone or "", "points": str(cust.points),
            "credit_allowed": cust.credit_allowed, "credit_left": str(cust.credit_limit - cust.credit_balance),
        },
        "shift": None if shift is None else {"id": shift.pk, "cashier": shift.cashier.display, "mine": shift.cashier_id == user.pk},
        "held": [{"id": h.pk, "label": h.label, "lines": h.lines.count(), "at": h.updated_at.strftime("%H:%M")} for h in held],
    }


@require_GET
@api
def pos_state(request, body):
    return JsonResponse({"ok": True, **state(request.user)})


@require_POST
@api
def pos_scan(request, body):
    code = (body.get("code") or "").strip()
    if not code:
        raise S.BillingError("Scan or type a barcode, SKU or PLU.")
    resolved = S.resolve_code(code)
    if resolved is None:
        # Bill untouched. The screen offers 'link this barcode' to authorised staff.
        audit("unknown_barcode", f"Unknown code scanned: {code}", user=request.user)
        return JsonResponse({"ok": False, "unknown": code, "error": f"Unknown barcode {code}. Nothing was added to the bill.",
                             "can_link": request.user.can("link_barcode"), "can_add": request.user.can("products"),
                             **state(request.user)})
    item = resolved.item
    entered = body.get("qty")
    quantity = resolved.qty
    if quantity is None:
        if entered in (None, ""):
            return JsonResponse({"ok": False, "needs_qty": True, "item": item.as_dict(), "code": code,
                                 "error": "", **state(request.user)})
        quantity = D(entered)
    elif entered not in (None, "") and resolved.source not in ("scale",):
        quantity = quantity * D(entered)  # e.g. "3 ×" then scan
    line = S.add_item(S.current_draft(request.user), item, quantity, source=resolved.source, code=code)
    return JsonResponse({"ok": True, "added": line.pk, "note": resolved.note, **state(request.user)})


@require_POST
@api
def pos_add(request, body):
    item = get_object_or_404(Item, pk=body.get("item"))
    if body.get("qty") in (None, ""):
        if item.weighed:
            return JsonResponse({"ok": False, "needs_qty": True, "item": item.as_dict(), "code": item.sku, "error": "", **state(request.user)})
        body["qty"] = 1
    line = S.add_item(S.current_draft(request.user), item, body["qty"], source="search", code=item.sku)
    return JsonResponse({"ok": True, "added": line.pk, **state(request.user)})


@require_GET
@api
def pos_search(request, body):
    items = S.search_items(request.GET.get("q", ""), limit=30, active_only=request.GET.get("all") != "1")
    return JsonResponse({"ok": True, "results": [i.as_dict() for i in items]})


def _my_line(request, pk):
    return get_object_or_404(DraftLine.objects.select_related("item", "draft"), pk=pk, draft__cashier=request.user,
                             draft__status=DraftBill.OPEN)


@require_POST
@api
def pos_line_qty(request, body, pk):
    S.set_line_qty(_my_line(request, pk), body.get("qty"))
    return JsonResponse({"ok": True, **state(request.user)})


@require_POST
@api
def pos_line_remove(request, body, pk):
    line = _my_line(request, pk)
    value = (line.qty * (line.price_override if line.price_override is not None else (line.item.price or 0))).quantize(Decimal("0.01"))
    audit("line_remove", f"Removed {line.item.name} × {line.qty:f} (₹{value}) before payment", user=request.user, obj=line.item, value=value)
    line.delete()
    return JsonResponse({"ok": True, **state(request.user)})


@require_POST
@api
def pos_line_price(request, body, pk):
    S.override_price(_my_line(request, pk), request.user, body.get("price"), body.get("reason", ""),
                     body.get("approver", ""), body.get("pin", ""))
    return JsonResponse({"ok": True, **state(request.user)})


@require_POST
@api
def pos_line_discount(request, body, pk):
    S.line_discount(_my_line(request, pk), request.user, body.get("amount"), body.get("reason", ""),
                    body.get("approver", ""), body.get("pin", ""))
    return JsonResponse({"ok": True, **state(request.user)})


@require_POST
@api
def pos_hold(request, body):
    S.hold(S.current_draft(request.user), body.get("label", ""))
    return JsonResponse({"ok": True, **state(request.user)})


@require_POST
@api
def pos_recall(request, body, pk):
    S.recall(request.user, pk)
    return JsonResponse({"ok": True, **state(request.user)})


@require_POST
@api
def pos_cancel(request, body):
    S.cancel(S.current_draft(request.user), request.user, body.get("reason", ""), body.get("approver", ""), body.get("pin", ""))
    return JsonResponse({"ok": True, **state(request.user)})


@require_POST
@api
def pos_customer(request, body):
    draft = S.current_draft(request.user)
    if body.get("clear"):
        draft.customer = None
    else:
        draft.customer = get_object_or_404(Customer, pk=body.get("id"))
    draft.save(update_fields=["customer", "updated_at"])
    return JsonResponse({"ok": True, **state(request.user)})


@require_GET
@api
def customer_search(request, body):
    q = request.GET.get("q", "").strip()
    qs = Customer.objects.all()
    if q:
        qs = qs.filter(phone__startswith=q) | Customer.objects.filter(name__icontains=q)
    return JsonResponse({"ok": True, "results": [
        {"id": c.pk, "name": c.name, "phone": c.phone or "", "points": str(c.points)} for c in qs.order_by("name")[:15]
    ]})


@require_POST
@api
def customer_quick_add(request, body):
    name, phone = (body.get("name") or "").strip(), (body.get("phone") or "").strip() or None
    if not name:
        raise S.BillingError("Enter the customer's name.")
    if phone and (not phone.isdigit() or len(phone) != 10):
        raise S.BillingError("Phone number should be 10 digits.")
    if phone and Customer.objects.filter(phone=phone).exists():
        raise S.BillingError("A customer with this phone already exists. Search for them instead.")
    c = Customer.objects.create(name=name, phone=phone)
    draft = S.current_draft(request.user)
    draft.customer = c
    draft.save(update_fields=["customer", "updated_at"])
    return JsonResponse({"ok": True, **state(request.user)})


@require_POST
@api
def pos_checkout(request, body):
    sale, created = S.checkout(body.get("draft"), request.user, body.get("payments") or [],
                               customer_id=body.get("customer"), approver=body.get("approver", ""), pin=body.get("pin", ""))
    return JsonResponse({
        "ok": True, "created": created, "sale": sale.pk, "bill_no": sale.bill_no, "sale_total": str(sale.total),
        "change": str(sale.change), "receipt": reverse("sale_receipt", args=[sale.pk]), **state(request.user),
    })


@require_POST
@api
def pos_link_barcode(request, body):
    """Link an unknown barcode to an existing product, then add it to the bill."""
    who = authorise(request.user, "link_barcode", body.get("approver", ""), body.get("pin", ""))
    code = (body.get("code") or "").strip()
    item = get_object_or_404(Item, pk=body.get("item"))
    if not code or len(code) > 32:
        raise S.BillingError("Barcode missing.")
    with transaction.atomic():
        if Barcode.objects.filter(code=code).exists():
            raise S.BillingError("That barcode is already linked to a product.")
        per = money(body.get("qty_per_scan") or 1)
        Barcode.objects.create(code=code, item=item, qty_per_scan=per, note=f"Linked at counter by {who.username}")
        audit("barcode_link", f"Barcode {code} linked to {item.sku} {item.name}", user=request.user, approved_by=who, obj=item)
    return JsonResponse({"ok": True, "linked": code, **state(request.user)})


@require_POST
@api
def product_quick_add(request, body):
    """Create a sellable product in one step (new barcode at the counter, or Products → Quick add)."""
    from catalog.quick import QuickAddError, quick_add

    who = authorise(request.user, "products", body.get("approver", ""), body.get("pin", ""))
    try:
        item = quick_add(body, request.user, approved_by=who)
    except QuickAddError as exc:
        raise S.BillingError(str(exc)) from None
    return JsonResponse({"ok": True, "item": item.as_dict(), **state(request.user)})


@require_POST
@api
def sale_whatsapp(request, body, pk):
    """Build the WhatsApp bill for a saved sale and return the links that open it in the shop's WhatsApp."""
    from core.models import StoreSettings

    from . import whatsapp as W
    from .views import _visible_sales

    sale = get_object_or_404(_visible_sales(request.user).prefetch_related("lines", "payments"), pk=pk)
    cfg = StoreSettings.load()
    if not cfg.whatsapp_enabled:
        raise S.BillingError("WhatsApp bills are turned off (Settings → WhatsApp bills).")
    raw = body.get("phone") or (sale.customer.phone if sale.customer and sale.customer.phone else "")
    try:
        phone = W.normalise_phone(raw)
    except W.PhoneError as exc:
        raise S.BillingError(str(exc)) from None
    text = W.bill_text(sale, cfg)
    audit("bill_whatsapp", f"Bill {sale.bill_no} opened in WhatsApp for {W.mask(phone)}", user=request.user, obj=sale)
    return JsonResponse({"ok": True, "text": text, "open": cfg.whatsapp_open, "to": W.mask(phone), **W.links(phone, text)})


@require_POST
@api
def printed(request, body, pk):
    from .models import Sale

    sale = get_object_or_404(Sale, pk=pk)
    S.record_print(sale, request.user, reprint=bool(body.get("reprint")))
    return JsonResponse({"ok": True})
