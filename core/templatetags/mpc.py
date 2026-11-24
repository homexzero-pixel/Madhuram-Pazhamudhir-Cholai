from django import template

from core.money import fmt_qty, inr

register = template.Library()


@register.filter
def money(value):
    if value is None or value == "":
        return "—"
    return inr(value)


@register.filter
def rupees(value):
    """Amount without the symbol, for receipt columns."""
    if value is None or value == "":
        return ""
    return inr(value, symbol="")


@register.filter
def q(value):
    if value is None or value == "":
        return ""
    return fmt_qty(value)


@register.simple_tag(takes_context=True)
def qs(context, **kwargs):
    params = context["request"].GET.copy()
    for k, v in kwargs.items():
        params[k] = v
    return params.urlencode()


@register.filter
def get(d, key):
    try:
        return d.get(key)
    except AttributeError:
        return None


@register.filter
def cell(value):
    """Report cell: links, money (2 dp) and quantities (3 dp)."""
    from decimal import Decimal

    from django.utils.html import format_html

    if isinstance(value, dict) and "href" in value:
        return format_html('<a href="{}">{}</a>', value["href"], value["v"])
    if isinstance(value, Decimal):
        if value.as_tuple().exponent == -3:
            return fmt_qty(value)
        return inr(value)
    return value


@register.filter
def short(name):
    """'Banganapalli mango · Conventional · Loose kg' → 'Banganapalli mango' (for price boards)."""
    return str(name or "").split(" · ")[0]


@register.filter
def get_item(d, key):
    try:
        return d.get(key, "")
    except AttributeError:
        return ""


@register.filter
def split_pairs(s):
    """'a:A,b:B' -> [('a','A'), ('b','B')] for small fixed menus in templates."""
    return [tuple(p.split(":", 1)) for p in str(s).split(",") if ":" in p]
