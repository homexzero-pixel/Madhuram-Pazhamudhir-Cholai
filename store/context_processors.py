from django.db.utils import OperationalError, ProgrammingError

from accounts.models import ROLE_ADMIN, ROLE_MANAGER

from .models import StoreProfile


def store_profile(request):
    user = getattr(request, "user", None)
    authed = bool(user and user.is_authenticated)
    try:
        store = StoreProfile.load()
    except (OperationalError, ProgrammingError):  # before migrations
        store = None
    return {
        "store": store,
        "is_admin": authed and user.has_role(ROLE_ADMIN),
        "is_manager": authed and user.has_role(ROLE_ADMIN, ROLE_MANAGER),
    }
