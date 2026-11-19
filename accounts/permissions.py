from functools import wraps

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.shortcuts import redirect

from .models import ROLE_ADMIN, ROLE_MANAGER

MANAGERS = (ROLE_ADMIN, ROLE_MANAGER)


def role_required(*roles):
    """Allow the view only for logged-in users that hold one of ``roles``."""

    def decorator(view):
        @login_required
        @wraps(view)
        def wrapped(request, *args, **kwargs):
            if request.user.has_role(*roles):
                return view(request, *args, **kwargs)
            messages.error(request, "You do not have permission to open that page.")
            return redirect("dashboard")

        return wrapped

    return decorator


admin_required = role_required(ROLE_ADMIN)
manager_required = role_required(*MANAGERS)
