from decimal import Decimal, InvalidOperation

from django import template

register = template.Library()


def _indian_group(int_part: str) -> str:
    if len(int_part) <= 3:
        return int_part
    head, tail = int_part[:-3], int_part[-3:]
    groups = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    return ",".join(groups + [tail])


@register.filter
def money(value, symbol="₹"):
    """Format a number as Indian currency, e.g. 123456.5 -> ₹1,23,456.50."""
    try:
        amount = Decimal(value or 0).quantize(Decimal("0.01"))
    except (InvalidOperation, TypeError, ValueError):
        return value
    sign = "-" if amount < 0 else ""
    int_part, frac = f"{abs(amount):.2f}".split(".")
    return f"{sign}{symbol}{_indian_group(int_part)}.{frac}"


@register.filter
def qty(value):
    """Drop trailing zeros from a stock quantity: 2.500 -> 2.5, 3.000 -> 3."""
    try:
        d = Decimal(value)
    except (InvalidOperation, TypeError, ValueError):
        return value
    text = f"{d:f}"
    return text.rstrip("0").rstrip(".") if "." in text else text


@register.simple_tag(takes_context=True)
def query_with(context, **kwargs):
    """Return the current querystring with some keys replaced (for pagination)."""
    params = context["request"].GET.copy()
    for key, val in kwargs.items():
        params[key] = val
    return params.urlencode()
