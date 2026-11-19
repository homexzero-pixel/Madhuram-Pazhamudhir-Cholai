"""Parse barcodes printed by a weighing scale (price-embedded / weight-embedded EAN-13).

The layout differs between scale brands and how they are programmed, so every
position is configurable in Settings → Hardware. Test with a real label before use.
"""
from dataclasses import dataclass
from decimal import Decimal


@dataclass
class ScaleLabel:
    item_code: str
    value: Decimal
    value_type: str  # "weight" (kg) or "price" (₹)


class ScaleLabelError(ValueError):
    pass


def ean13_check_digit(first12: str) -> int:
    total = sum(int(d) * (3 if i % 2 else 1) for i, d in enumerate(first12))
    return (10 - total % 10) % 10


def looks_like_scale_label(code: str, cfg) -> bool:
    if not cfg.scale_enabled or not code.isdigit() or len(code) != cfg.scale_label_length:
        return False
    prefixes = [p.strip() for p in cfg.scale_prefixes.split(",") if p.strip()]
    return any(code.startswith(p) for p in prefixes)


def parse_scale_label(code: str, cfg) -> ScaleLabel:
    if not looks_like_scale_label(code, cfg):
        raise ScaleLabelError("Not a scale label for the configured format.")
    if cfg.scale_check_digit and cfg.scale_label_length == 13:
        if ean13_check_digit(code[:12]) != int(code[12]):
            raise ScaleLabelError("Scale label check digit is wrong. Rescan or enter the weight by hand.")
    item = code[cfg.scale_item_start: cfg.scale_item_start + cfg.scale_item_length]
    raw = code[cfg.scale_value_start: cfg.scale_value_start + cfg.scale_value_length]
    if len(item) != cfg.scale_item_length or len(raw) != cfg.scale_value_length or not raw.isdigit():
        raise ScaleLabelError("Scale label is shorter than the configured layout.")
    value = Decimal(int(raw)).scaleb(-cfg.scale_value_decimals)
    if value <= 0:
        raise ScaleLabelError("Scale label shows zero weight/price.")
    return ScaleLabel(item_code=item, value=value, value_type=cfg.scale_value_type)


def make_scale_label(item_code: str, value: Decimal, cfg) -> str:
    """Build a label in the configured layout (used for practice barcodes and tests)."""
    digits = ["0"] * cfg.scale_label_length
    prefix = [p.strip() for p in cfg.scale_prefixes.split(",") if p.strip()][0]
    for i, ch in enumerate(prefix):
        digits[i] = ch
    item_code = item_code.zfill(cfg.scale_item_length)
    raw = str(int(Decimal(value).scaleb(cfg.scale_value_decimals))).zfill(cfg.scale_value_length)
    for i, ch in enumerate(item_code):
        digits[cfg.scale_item_start + i] = ch
    for i, ch in enumerate(raw):
        digits[cfg.scale_value_start + i] = ch
    code = "".join(digits)
    if cfg.scale_label_length == 13:
        code = code[:12] + str(ean13_check_digit(code[:12]))
    return code
