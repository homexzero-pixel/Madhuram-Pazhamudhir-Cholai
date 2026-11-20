from django.conf import settings
from django.db.utils import OperationalError, ProgrammingError

from accounts.roles import perms_for

from .models import StoreSettings


def store(request):
    try:
        st = StoreSettings.load()
    except (OperationalError, ProgrammingError):
        st = None
    user = getattr(request, "user", None)
    return {
        "store": st,
        "mode": settings.MODE,
        "can": perms_for(user) if user is not None and user.is_authenticated else set(),
    }
