from django.conf import settings
from django.db.utils import OperationalError, ProgrammingError

from accounts.roles import perms_for

from .models import StoreSettings


def _asset_version():
    """Changes whenever our CSS/JS changes, so Edge never keeps an old copy after an update."""
    import hashlib

    h = hashlib.sha1()
    for f in sorted((settings.BASE_DIR / "static").glob("[cj]s*/*.*")):
        h.update(f.read_bytes())
    return h.hexdigest()[:10]


ASSET_V = _asset_version()


def store(request):
    try:
        st = StoreSettings.load()
    except (OperationalError, ProgrammingError):
        st = None
    user = getattr(request, "user", None)
    return {
        "store": st,
        "mode": settings.MODE,
        "asset_v": ASSET_V,
        "can": perms_for(user) if user is not None and user.is_authenticated else set(),
    }
