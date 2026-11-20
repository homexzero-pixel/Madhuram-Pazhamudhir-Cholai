from functools import wraps

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.core.exceptions import PermissionDenied
from django.http import JsonResponse
from django.shortcuts import redirect

from .models import User
from .roles import PERMISSIONS


def require(perm):
    assert perm in PERMISSIONS, perm

    def decorator(view):
        @login_required
        @wraps(view)
        def wrapped(request, *args, **kwargs):
            if request.user.can(perm):
                return view(request, *args, **kwargs)
            if request.headers.get("Accept", "").startswith("application/json") or request.path.startswith("/api/"):
                return JsonResponse({"ok": False, "error": f"Not allowed: {PERMISSIONS[perm]}."}, status=403)
            messages.error(request, f"Your role cannot do this: {PERMISSIONS[perm]}.")
            return redirect("home")

        return wrapped

    return decorator


def authorise(user, perm, approver_username="", approver_pin=""):
    """Return the user who authorises ``perm``: the user themself, or a manager entering their PIN.

    Raises PermissionDenied with a message the cashier can act on.
    """
    if user.can(perm):
        return user
    if not approver_username:
        raise PermissionDenied(f"Needs approval: {PERMISSIONS[perm]}. Ask a manager to enter their user name and PIN.")
    from . import throttle

    name = approver_username.strip().lower()
    try:
        throttle.check("pin", name)
    except throttle.Locked as exc:
        raise PermissionDenied(str(exc)) from exc
    approver = User.objects.filter(username__iexact=name, is_active=True).first()
    if approver is None or not approver.check_pin(approver_pin):
        throttle.fail("pin", name)
        raise PermissionDenied("Approval user name or PIN is wrong.")
    throttle.clear("pin", name)
    if not approver.can(perm):
        raise PermissionDenied(f"{approver.username} cannot approve this.")
    return approver
