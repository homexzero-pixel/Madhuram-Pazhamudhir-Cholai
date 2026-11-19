"""Exact money and quantity arithmetic.

Money is Decimal rupees with 2 places (stored as DECIMAL in SQLite via Django,
never as float). Quantities are Decimal with 3 places (kg to the gram, pieces as
whole numbers). All rounding is ROUND_HALF_UP, the convention on Indian bills.
"""
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

PAISE = Decimal("0.01")
GRAM = Decimal("0.001")
ZERO = Decimal("0")
HUNDRED = Decimal("100")


def D(value) -> Decimal:
    if isinstance(value, Decimal):
        return value
    if value is None or value == "":
        return ZERO
    if isinstance(value, float):
        value = repr(value)
    try:
        d = Decimal(str(value).strip().replace(",", ""))
    except InvalidOperation as exc:
        raise ValueError(f"'{value}' is not a number.") from exc
    if not d.is_finite():
        raise ValueError(f"'{value}' is not a number.")
    return d


def money(value) -> Decimal:
    return D(value).quantize(PAISE, rounding=ROUND_HALF_UP)


def qty(value) -> Decimal:
    return D(value).quantize(GRAM, rounding=ROUND_HALF_UP)


def parse_qty(value, *, weighed: bool, allow_zero=False) -> Decimal:
    """Validate a cashier-entered quantity. Weighed items take up to 3 decimals."""
    d = D(value)
    if d < 0 or (d == 0 and not allow_zero):
        raise ValueError("Quantity must be more than zero.")
    if d != d.quantize(GRAM):
        raise ValueError("Weight can have at most 3 decimal places (grams).")
    if not weighed and d != d.to_integral_value():
        raise ValueError("This item is sold by the piece. Enter a whole number.")
    if d > Decimal("100000"):
        raise ValueError("Quantity is too large.")
    return qty(d)


def line_amount(rate, quantity) -> Decimal:
    return money(D(rate) * D(quantity))


def split_tax(inclusive_amount, rate_pct):
    """Split a GST-inclusive amount into taxable value, CGST and SGST (intra-state)."""
    amount = money(inclusive_amount)
    rate = D(rate_pct)
    if rate <= 0:
        return amount, ZERO, ZERO
    taxable = money(amount * HUNDRED / (HUNDRED + rate))
    tax = amount - taxable
    cgst = money(tax / 2)
    return taxable, cgst, tax - cgst


def allocate(total, weights):
    """Split ``total`` paise across ``weights`` so the parts add up exactly."""
    total = money(total)
    weights = [D(w) for w in weights]
    s = sum(weights)
    if not weights:
        return []
    if s == 0:
        parts = [ZERO] * len(weights)
        parts[-1] = total
        return parts
    parts = [money(total * w / s) for w in weights]
    parts[-1] += total - sum(parts)
    return parts


def inr(value, symbol="₹") -> str:
    """Indian digit grouping: 1234567.5 -> ₹12,34,567.50."""
    try:
        amount = money(value)
    except ValueError:
        return str(value)
    sign = "-" if amount < 0 else ""
    whole, frac = f"{abs(amount):.2f}".split(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join(groups + [tail])
    return f"{sign}{symbol}{whole}.{frac}"


def fmt_qty(value) -> str:
    text = f"{D(value):f}"
    return text.rstrip("0").rstrip(".") if "." in text else text


def financial_year(d: date) -> str:
    """Indian FY code, e.g. 1 Nov 2026 -> '2627'."""
    start = d.year if d.month >= 4 else d.year - 1
    return f"{start % 100:02d}{(start + 1) % 100:02d}"
