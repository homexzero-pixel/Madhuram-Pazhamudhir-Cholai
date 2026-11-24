"""Which counter (till) a request comes from, and which web addresses may reach the store server.

Each billing PC remembers its counter name in a long-lived cookie ("This PC is Counter 2"), set once on
/counter/. Shifts, the cash drawer and the billing screen follow that name, so five counters can bill at the
same time against one stock and one bill series.
"""
import contextvars
import ipaddress
import re

from django.conf import settings
from django.http import HttpResponseBadRequest

COOKIE = "mpc_counter"
DEFAULT = "Counter 1"
_current = contextvars.ContextVar("mpc_counter", default=DEFAULT)


def clean(name):
    name = " ".join(str(name or "").split())[:20]
    return name if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 \-]{0,19}", name or "") else ""


def current():
    return _current.get()


def use(name):
    """For scripts and tests: bill as this counter until reset(token)."""
    return _current.set(clean(name) or DEFAULT)


def reset(token):
    _current.reset(token)


def names():
    from core.models import StoreSettings

    try:
        raw = StoreSettings.load().counter_names
    except Exception:  # noqa: BLE001 – before the first migration
        raw = ""
    out = [clean(n) for n in (raw or "").split(",")]
    return [n for n in out if n] or [DEFAULT]


class CounterMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        token = _current.set(clean(request.COOKIES.get(COOKIE)) or DEFAULT)
        try:
            return self.get_response(request)
        finally:
            _current.reset(token)


# ------------------------------------------------------------------ which addresses may reach the server
def _private(host):
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_private or ip.is_loopback or ip.is_link_local


def host_allowed(host):
    from django.http.request import split_domain_port

    host = split_domain_port(host or "")[0].strip("[]").lower()
    if not host:
        return False
    if host in ("localhost", "testserver") or _private(host):
        return True
    if "." not in host:                      # a Windows PC name on the shop network, e.g. SHOP-SERVER
        return bool(re.fullmatch(r"[a-z0-9\-]{1,63}", host))
    if host.endswith(".local"):
        return True
    extra = [h.strip().lower() for h in settings.MPC_EXTRA_HOSTS]
    try:
        from core.models import StoreSettings

        pub = StoreSettings.load().public_url
    except Exception:  # noqa: BLE001
        pub = ""
    if pub:
        extra.append(re.sub(r"^https?://", "", pub).split("/")[0].split(":")[0].lower())
    return host in extra


class HostCheckMiddleware:
    """Replaces a fixed ALLOWED_HOSTS: the shop network, this PC and the owner's public address are allowed."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not host_allowed(request.META.get("HTTP_HOST", "") or request.META.get("SERVER_NAME", "")):
            return HttpResponseBadRequest("This address is not allowed for the Madhuram store system.")
        return self.get_response(request)
