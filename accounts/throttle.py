"""Lock out repeated wrong passwords and approval PINs (5 tries, then 15 minutes)."""
from django.core.cache import cache

LIMIT, WINDOW = 5, 15 * 60


class Locked(Exception):
    pass


def _key(kind, ident):
    return f"fail:{kind}:{str(ident).lower()[:120]}"


def check(kind, ident):
    if cache.get(_key(kind, ident), 0) >= LIMIT:
        raise Locked("Too many wrong attempts. Wait 15 minutes, or ask the owner to check the account.")


def fail(kind, ident):
    k = _key(kind, ident)
    cache.add(k, 0, WINDOW)
    try:
        cache.incr(k)
    except ValueError:
        cache.set(k, 1, WINDOW)


def clear(kind, ident):
    cache.delete(_key(kind, ident))
