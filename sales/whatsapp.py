"""Free WhatsApp bills: the bill is written as a WhatsApp message and opened in the shop's own WhatsApp
(Desktop app or WhatsApp Web) with the customer's number filled in. The cashier presses Send.
No paid API, no account with Meta, nothing leaves the PC until WhatsApp sends it."""
import re
from decimal import Decimal
from urllib.parse import quote

from django.utils import timezone

from core.money import inr

MAX_LINES = 60  # keep the message (and the link) short enough for every phone


class PhoneError(ValueError):
    pass


def normalise_phone(raw):
    """Indian mobile number → '91XXXXXXXXXX'. Accepts 98765 43210, +91 98765-43210, 098765 43210, 919876543210."""
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if len(digits) != 10 or digits[0] not in "6789":
        raise PhoneError("Enter the customer's 10-digit mobile number (it starts with 6, 7, 8 or 9).")
    return "91" + digits


def mask(phone):
    return f"+{phone[:2]} {phone[2:4]}xxxxxx{phone[-2:]}"


def _q(v):
    v = Decimal(v).normalize()
    return f"{v:f}"


def bill_text(sale, cfg):
    ident = sale.identity or {}
    lines = list(sale.lines.all())
    when = timezone.localtime(sale.created_at).strftime("%d-%m-%Y %H:%M")
    out = [f"*{ident.get('legal_name') or ident.get('name') or cfg.name}*"]
    if cfg.name_ta:
        out.append(cfg.name_ta)
    out += [f"{sale.get_doc_type_display()} · *{sale.bill_no}*", when, ""]
    for i, l in enumerate(lines[:MAX_LINES], 1):
        name = l.name + (f" / {l.name_ta}" if cfg.whatsapp_tamil and l.name_ta else "")
        out.append(f"{i}. {name}")
        out.append(f"    {_q(l.qty)} {l.unit} × {inr(l.rate)} = {inr(l.gross)}")
        if l.discount:
            out.append(f"    {l.discount_note or 'Discount'}: -{inr(l.discount)}")
    if len(lines) > MAX_LINES:
        out.append(f"… and {len(lines) - MAX_LINES} more items (full bill on the printed receipt)")
    out.append("────────────")
    if sale.discount:
        out.append(f"Before discount: {inr(sale.gross)}")
        out.append(f"Discount: -{inr(sale.discount)}")
    out.append(f"*TOTAL: {inr(sale.total)}*  ({len(lines)} item{'s' if len(lines) != 1 else ''})")
    paid = []
    for p in sale.payments.all():
        paid.append(f"{p.get_method_display()} {inr(p.tendered if p.method == 'cash' and p.tendered else p.amount)}")
    if paid:
        out.append("Paid: " + ", ".join(paid) + (f" · Change {inr(sale.change)}" if sale.change else ""))
    saved = sum(((l.mrp or l.rate) * l.qty - l.net for l in lines if l.mrp), Decimal(0))
    if saved > 0:
        out.append(f"🎉 You saved {inr(saved)} on MRP")
    if sale.points_earned:
        out.append(f"Points earned: {_q(sale.points_earned)}")
    taxes = {}
    for l in lines:
        if l.gst_rate:
            taxes[l.gst_rate] = taxes.get(l.gst_rate, Decimal(0)) + l.cgst + l.sgst
    if taxes:
        out.append("GST included: " + ", ".join(f"{_q(r)}% {inr(v)}" for r, v in sorted(taxes.items())))
    out.append("")
    if cfg.whatsapp_message:
        out.append(cfg.whatsapp_message)
    tail = " · ".join(x for x in (ident.get("phone") and f"Ph {ident['phone']}", ident.get("gstin") and f"GSTIN {ident['gstin']}") if x)
    if tail:
        out.append(tail)
    return "\n".join(out)


def links(phone, text):
    t = quote(text, safe="")
    return {"app": f"whatsapp://send?phone={phone}&text={t}", "web": f"https://wa.me/{phone}?text={t}"}
