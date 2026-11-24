import json

from django.contrib import messages
from django.http import Http404, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

from accounts.permissions import require
from core.models import StoreSettings

from . import services as SH
from .models import OnlineOrder


def _ip(request):
    return request.META.get("HTTP_CF_CONNECTING_IP") if request.META.get("REMOTE_ADDR") == "127.0.0.1" and \
        request.META.get("HTTP_CF_CONNECTING_IP") else request.META.get("REMOTE_ADDR", "")


# ================================================================== customers (no login)
@ensure_csrf_cookie
def shop_home(request):
    cfg = StoreSettings.load()
    slot_days = [{"date": d.isoformat(), "label": d.strftime("%a %d %b"),
                  "slots": [{"v": timezone.localtime(t).strftime(SH.SLOT_FMT), "l": SH.slot_label(t, cfg).split(", ", 1)[1]} for t in ts]}
                 for d, ts in SH.slots(cfg)]
    return render(request, "shop/home.html", {"cfg": cfg, "cats": SH.categories(), "slot_days": slot_days})


@require_GET
def shop_items(request):
    if not StoreSettings.load().online_enabled:
        return JsonResponse({"ok": False, "items": []})
    return JsonResponse({"ok": True, "items": SH.catalogue(request.GET.get("q", "")[:60], request.GET.get("cat", "")[:10],
                                                          request.GET.get("code", "")[:32])})


@require_POST
def shop_order(request):
    try:
        data = json.loads(request.body or b"{}")
    except ValueError:
        return JsonResponse({"ok": False, "error": "Bad request."}, status=400)
    if data.get("website"):               # hidden field only robots fill in
        return JsonResponse({"ok": False, "error": "Please try again."}, status=400)
    try:
        order = SH.place_order(data, ip=_ip(request))
    except SH.OrderError as exc:
        return JsonResponse({"ok": False, "error": str(exc)})
    return JsonResponse({"ok": True, "number": order.number, "url": f"/shop/o/{order.token}/"})


def shop_track(request, token):
    order = get_object_or_404(OnlineOrder.objects.prefetch_related("lines"), token=token)
    cfg = StoreSettings.load()
    steps = [OnlineOrder.NEW, OnlineOrder.ACCEPTED, OnlineOrder.READY if order.mode == OnlineOrder.PICKUP else OnlineOrder.OUT, OnlineOrder.DONE]
    return render(request, "shop/track.html", {"o": order, "cfg": cfg, "slot": SH.slot_label(order.slot, cfg), "steps": steps,
                                               "step_names": dict(OnlineOrder.STATUS), "reached": steps.index(order.status) if order.status in steps else -1})


# ================================================================== staff
@require("bill")
def order_list(request):
    tab = request.GET.get("tab", "open")
    qs = OnlineOrder.objects.prefetch_related("lines")
    today = timezone.localdate()
    qs = {"open": qs.filter(status__in=OnlineOrder.OPEN_STATUSES).order_by("slot"),
          "done": qs.filter(status=OnlineOrder.DONE, done_at__date=today),
          "cancelled": qs.filter(status=OnlineOrder.CANCELLED).order_by("-updated_at")[:50],
          "all": qs.all()[:100]}.get(tab) or qs.none()
    cfg = StoreSettings.load()
    rows = [(o, SH.slot_label(o.slot, cfg)) for o in qs]
    counts = {k: OnlineOrder.objects.filter(status=k).count() for k in (OnlineOrder.NEW,)}
    return render(request, "shop/orders.html", {"nav": "orders", "rows": rows, "tab": tab, "counts": counts, "cfg": cfg})


@require("bill")
def order_detail(request, pk):
    from sales.whatsapp import links

    o = get_object_or_404(OnlineOrder.objects.prefetch_related("lines"), pk=pk)
    cfg = StoreSettings.load()
    wa = links(o.phone, SH.status_message(o, cfg))["web" if cfg.whatsapp_open == "web" else "app"]
    return render(request, "shop/order_detail.html", {"nav": "orders", "o": o, "slot": SH.slot_label(o.slot, cfg), "wa": wa, "cfg": cfg,
                                                      "print": request.GET.get("print") == "1"})


@require("bill")
@require_POST
def order_action(request, pk):
    o = get_object_or_404(OnlineOrder, pk=pk)
    act = request.POST.get("act")
    try:
        if act == "bill":
            SH.load_to_counter(o, request.user)
            messages.success(request, f"{o.number} is on the bill. Correct weighed items with F4 if needed, then take payment.")
            return redirect("pos")
        status = {"accept": OnlineOrder.ACCEPTED, "ready": OnlineOrder.READY, "out": OnlineOrder.OUT, "cancel": OnlineOrder.CANCELLED}.get(act)
        if not status:
            raise Http404
        SH.set_status(o, status, request.user, request.POST.get("note", ""))
        messages.success(request, f"{o.number}: {o.get_status_display()}. Send the customer a WhatsApp update.")
    except SH.OrderError as exc:
        messages.error(request, str(exc))
    return redirect("order_detail", pk=o.pk)


@require("bill")
def order_badge(request):
    """Polled by every staff page: number of new orders and the newest one (for the alert sound)."""
    new = OnlineOrder.objects.filter(status=OnlineOrder.NEW)
    last = OnlineOrder.objects.order_by("-pk").values_list("pk", flat=True).first() or 0
    return JsonResponse({"new": new.count(), "last": last})


@require("bill")
def order_poster(request):
    import segno

    cfg = StoreSettings.load()
    url = (cfg.public_url.rstrip("/") if cfg.public_url else request.build_absolute_uri("/").rstrip("/")) + "/shop/"
    svg = segno.make(url, error="m").svg_inline(scale=10, dark="#14213d", border=2)
    return render(request, "shop/poster.html", {"cfg": cfg, "url": url, "svg": svg, "lan": not cfg.public_url})
