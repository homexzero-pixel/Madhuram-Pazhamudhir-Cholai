"""Billing, payments, returns and cash closing.

Every function that changes money or stock runs in one database transaction:
the bill, its lines, lot allocations, stock ledger, payments, loyalty, customer
credit and audit rows are saved together or not at all.
"""
import math
from dataclasses import dataclass, field
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import PermissionDenied
from django.db import IntegrityError, transaction
from django.db.models import F, Q, Sum
from django.utils import timezone

from accounts.permissions import authorise
from catalog.models import Barcode, Item, TaxClass
from core.models import Sequence, StoreSettings, audit
from core.money import ZERO, D, allocate, financial_year, line_amount, money, parse_qty, qty, split_tax
from core.scale import ScaleLabelError, looks_like_scale_label, parse_scale_label
from customers.models import CreditEntry, Customer, LoyaltyEntry, Offer
from inventory import services as stock
from inventory.models import StockLot

from .models import (
    CashMovement, DraftBill, DraftLine, Payment, ReturnLine, Sale, SaleLine, SaleLineLot, SaleReturn, Shift,
)

COUNTER = "Counter 1"


class BillingError(ValueError):
    pass


# --------------------------------------------------------------------------- lookup
@dataclass
class Resolved:
    item: Item
    qty: Decimal | None  # None = cashier must enter weight / quantity
    source: str
    code: str
    note: str = ""


def resolve_code(code: str) -> Resolved | None:
    """Exact match only: barcode, then SKU, then PLU, then a scale label. Never a 'similar' product."""
    code = (code or "").strip()
    if not code:
        return None
    bc = Barcode.objects.select_related("item").filter(code=code).first()
    if bc:
        q = None if bc.item.weighed and bc.qty_per_scan == 1 else bc.qty_per_scan
        return Resolved(bc.item, q, "scan", code, f"{bc.qty_per_scan:f} per scan" if bc.qty_per_scan != 1 else "")
    item = Item.objects.filter(sku=code.upper()).first()
    if item:
        return Resolved(item, None if item.weighed else Decimal(1), "sku", code)
    item = Item.objects.filter(plu=code).first()
    if item:
        return Resolved(item, None if item.weighed else Decimal(1), "plu", code)
    cfg = StoreSettings.load()
    if looks_like_scale_label(code, cfg):
        label = parse_scale_label(code, cfg)  # raises ScaleLabelError for a bad check digit
        plu = label.item_code.lstrip("0") or "0"
        item = Item.objects.filter(plu__in=[label.item_code, plu]).first()
        if item is None:
            raise ScaleLabelError(f"Scale label item code {label.item_code} is not linked to any PLU.")
        if not item.weighed:
            raise ScaleLabelError(f"PLU {item.plu} ({item.name}) is not a weighed item.")
        if label.value_type == "weight":
            q = qty(label.value)
        else:
            if not item.price:
                raise ScaleLabelError(f"Set the price per kg of {item.name} first.")
            q = qty(label.value / item.price)
        return Resolved(item, q, "scale", code, f"scale label {label.value:f} {'kg' if label.value_type == 'weight' else '₹'}")
    return None


def search_items(q: str, limit=25, active_only=True):
    q = (q or "").strip()
    if not q:
        return []
    qs = Item.objects.all()
    if active_only:
        qs = qs.filter(is_active=True)
    exact = list(qs.filter(sku=q.upper())[:1]) + list(qs.filter(plu=q)[:1]) + [
        b.item for b in Barcode.objects.select_related("item").filter(code=q)[:1] if not active_only or b.item.is_active
    ]
    text = qs
    for w in q.split():
        text = text.filter(Q(name__icontains=w) | Q(name_ta__icontains=w) | Q(brand__icontains=w))
    seen, out = set(), []
    for it in exact + list(text.order_by("name")[:limit]):
        if it.pk not in seen:
            seen.add(it.pk)
            out.append(it)
    return out[:limit]


# --------------------------------------------------------------------------- shift
def open_shift():
    return Shift.objects.filter(counter=COUNTER, status=Shift.OPEN).first()


def require_shift():
    s = open_shift()
    if s is None:
        raise BillingError("No cashier shift is open. Open a shift in Cash Closing first.")
    return s


@transaction.atomic
def start_shift(user, opening_float):
    if not user.can("cash"):
        raise PermissionDenied("Your role cannot open a cashier shift.")
    if open_shift():
        raise BillingError("A shift is already open on this counter. Close it first.")
    amount = money(opening_float)
    if amount < 0:
        raise BillingError("Opening float cannot be negative.")
    last = Shift.objects.filter(counter=COUNTER, status=Shift.CLOSED).order_by("-closed_at").first()
    s = Shift.objects.create(counter=COUNTER, cashier=user, opening_float=amount)
    if last is not None and last.retained_cash is not None and last.retained_cash != amount:
        audit("float_mismatch", f"Opening float ₹{amount} differs from ₹{last.retained_cash} left by shift {last.pk}", user=user, obj=s)
    audit("shift_open", f"Shift {s.pk} opened with ₹{amount}", user=user, obj=s)
    return s


def cash_summary(shift):
    """Every cash movement of a shift. Only cash affects the drawer."""
    from expenses.models import Expense
    from purchasing.models import SupplierPayment

    def total(qs, fieldname="amount"):
        return money(qs.aggregate(s=Sum(fieldname))["s"] or ZERO)

    cash_sales = total(Payment.objects.filter(sale__shift=shift, method="cash"))
    # Credit-ledger payments are stored as negative amounts (the customer owes less); as drawer cash they come in.
    collections = -total(CreditEntry.objects.filter(shift=shift, kind="payment", method="cash"))
    pay_in = total(shift.cash_moves.filter(kind="pay_in"))
    refunds = total(SaleReturn.objects.filter(shift=shift, method="cash"), "total")
    expenses = total(Expense.objects.filter(shift=shift, method="cash"))
    pay_out = total(shift.cash_moves.filter(kind="pay_out"))
    deposits = total(shift.cash_moves.filter(kind="bank_deposit"))
    supplier = total(SupplierPayment.objects.filter(shift=shift, method="cash"))
    other_in = collections + pay_in
    removed = pay_out + deposits + supplier
    expected = shift.opening_float + cash_sales + other_in - refunds - expenses - removed
    tenders = {
        m: total(Payment.objects.filter(sale__shift=shift, method=m)) for m in ("cash", "upi", "card", "credit")
    }
    refunds_by = {m: total(SaleReturn.objects.filter(shift=shift, method=m), "total") for m in ("cash", "upi", "card", "credit")}
    return {
        "opening": shift.opening_float, "cash_sales": cash_sales, "collections": collections, "pay_in": pay_in,
        "other_in": other_in, "refunds": refunds, "expenses": expenses, "pay_out": pay_out, "deposits": deposits,
        "supplier_payments": supplier, "removed": removed, "expected": expected, "tenders": tenders,
        "refunds_by": refunds_by, "bills": shift.sales.count(),
        "non_cash_expenses": total(Expense.objects.filter(shift=shift).exclude(method="cash")),
    }


@transaction.atomic
def close_shift(shift, user, counted, *, denominations=None, retained=None, note=""):
    shift = Shift.objects.select_for_update().get(pk=shift.pk)
    if shift.status != Shift.OPEN:
        raise BillingError("This shift is already closed.")
    if shift.cashier_id != user.pk and not user.can("reopen_shift"):
        raise PermissionDenied("Only the shift's cashier or a manager can close it.")
    if DraftBill.objects.filter(cashier=shift.cashier, status=DraftBill.OPEN, lines__isnull=False).exists():
        raise BillingError("A bill is still open on the counter. Complete, hold or cancel it first.")
    counted = money(counted)
    if counted < 0:
        raise BillingError("Counted cash cannot be negative.")
    summary = cash_summary(shift)
    shift.expected = summary["expected"]
    shift.counted = counted
    shift.variance = counted - summary["expected"]
    shift.denominations = denominations or {}
    shift.retained_cash = money(retained) if retained not in (None, "") else counted
    if shift.retained_cash > counted:
        raise BillingError("Cash left in the drawer cannot be more than the cash counted.")
    shift.status = Shift.CLOSED
    shift.closed_at = timezone.now()
    shift.closed_by = user
    shift.close_note = note[:200]
    shift.save()
    audit("shift_close", f"Shift {shift.pk} closed: expected ₹{shift.expected}, counted ₹{counted}, variance ₹{shift.variance}", user=user, obj=shift)
    return shift


@transaction.atomic
def reopen_shift(shift, user, reason):
    if not user.can("reopen_shift"):
        raise PermissionDenied("Only an owner or manager can reopen a shift.")
    if not reason.strip():
        raise BillingError("Enter the reason for reopening.")
    if open_shift():
        raise BillingError("Another shift is open on this counter. Close it first.")
    shift = Shift.objects.select_for_update().get(pk=shift.pk)
    audit("shift_reopen", f"Shift {shift.pk} reopened: {reason}", user=user, obj=shift,
          previous_counted=shift.counted, previous_variance=shift.variance)
    shift.status = Shift.OPEN
    shift.reopen_count += 1
    shift.closed_at = shift.counted = shift.variance = shift.expected = None
    shift.save()
    return shift


@transaction.atomic
def cash_move(user, kind, amount, reason, reference=""):
    shift = require_shift()
    amount = money(amount)
    if amount <= 0 or not reason.strip():
        raise BillingError("Enter an amount above zero and a reason.")
    if kind not in dict(CashMovement.KINDS):
        raise BillingError("Unknown cash movement.")
    if kind != "pay_in" and amount > cash_summary(shift)["expected"]:
        raise BillingError("That is more cash than the drawer should hold.")
    mv = CashMovement.objects.create(shift=shift, kind=kind, amount=amount, reason=reason, reference=reference, user=user)
    audit("cash_" + kind, f"{mv.get_kind_display()} ₹{amount}: {reason}", user=user, obj=mv)
    return mv


# --------------------------------------------------------------------------- draft bill
def current_draft(user):
    draft = DraftBill.objects.filter(cashier=user, status=DraftBill.OPEN).first()
    if draft is None:
        draft = DraftBill.objects.create(cashier=user)
    return draft


@transaction.atomic
def add_item(draft, item, quantity, *, source="scan", code=""):
    if draft.status != DraftBill.OPEN:
        raise BillingError("This bill is not open.")
    if not item.is_active:
        raise BillingError(f"{item.name} is not active for sale. A manager must verify it in Products.")
    if item.price is None:
        raise BillingError(f"{item.name} has no selling price yet.")
    quantity = parse_qty(quantity, weighed=item.weighed)
    in_bill = draft.lines.filter(item=item).aggregate(s=Sum("qty"))["s"] or ZERO
    have = stock.available(item)
    if in_bill + quantity > have:
        msg = f"Only {have.normalize():f} {item.unit_label} of {item.name} in stock"
        msg += f" ({in_bill.normalize():f} already on this bill)." if in_bill else "."
        exp = stock.expired_qty(item)
        if exp:
            msg += f" {exp.normalize():f} {item.unit_label} is past expiry and blocked."
        raise BillingError(msg + " Nothing was added.")
    line = draft.lines.filter(item=item, price_override__isnull=True, manual_discount=0).first()
    if line and not item.weighed:
        line.qty += quantity
        line.save(update_fields=["qty"])
    else:
        pos = (draft.lines.aggregate(m=models_max("position"))["m"] or 0) + 1
        line = DraftLine.objects.create(draft=draft, item=item, qty=quantity, source=source, scan_code=code[:40], position=pos)
    draft.save(update_fields=["updated_at"])
    return line


def models_max(f):
    from django.db.models import Max

    return Max(f)


@transaction.atomic
def set_line_qty(line, quantity):
    if D(quantity) == 0:
        line.delete()
        return None
    new = parse_qty(quantity, weighed=line.item.weighed)
    others = line.draft.lines.filter(item=line.item).exclude(pk=line.pk).aggregate(s=Sum("qty"))["s"] or ZERO
    have = stock.available(line.item)
    if new + others > have:
        raise BillingError(f"Only {have.normalize():f} {line.item.unit_label} of {line.item.name} in stock.")
    line.qty = new
    line.save(update_fields=["qty"])
    return line


@transaction.atomic
def override_price(line, user, new_price, reason, approver="", pin=""):
    who = authorise(user, "price_override", approver, pin)
    new_price = money(new_price)
    if new_price < 0 or not reason.strip():
        raise BillingError("Enter a price and a reason.")
    if line.item.mrp and new_price > line.item.mrp:
        raise BillingError(f"Price cannot be above MRP ₹{line.item.mrp}.")
    old = line.price_override if line.price_override is not None else line.item.price
    line.price_override, line.override_by, line.override_reason = new_price, who, reason[:120]
    line.save()
    audit("price_override", f"{line.item.name}: ₹{old} → ₹{new_price} ({reason})", user=user, approved_by=who, obj=line.item,
          draft=line.draft.uuid)
    return line


@transaction.atomic
def line_discount(line, user, amount, reason, approver="", pin=""):
    who = authorise(user, "discount_approve", approver, pin)
    amount = money(amount)
    if amount < 0 or not reason.strip():
        raise BillingError("Enter a discount amount and reason.")
    line.manual_discount, line.discount_by, line.discount_reason = amount, who, reason[:120]
    line.save()
    audit("discount", f"₹{amount} off {line.item.name} ({reason})", user=user, approved_by=who, obj=line.item, draft=line.draft.uuid)
    return line


@transaction.atomic
def hold(draft, label):
    if not draft.lines.exists():
        raise BillingError("Nothing to hold.")
    draft.status, draft.label = DraftBill.HELD, (label or f"Held {timezone.localtime():%H:%M}")[:60]
    draft.save()


@transaction.atomic
def recall(user, draft_id):
    if DraftBill.objects.filter(cashier=user, status=DraftBill.OPEN, lines__isnull=False).exists():
        raise BillingError("Hold or finish the bill on screen before recalling another.")
    DraftBill.objects.filter(cashier=user, status=DraftBill.OPEN).delete()
    draft = DraftBill.objects.select_for_update().get(pk=draft_id, status=DraftBill.HELD)
    draft.status, draft.cashier = DraftBill.OPEN, user
    draft.save()
    return draft


@transaction.atomic
def cancel(draft, user, reason, approver="", pin=""):
    if not reason.strip():
        raise BillingError("Enter why the bill is cancelled.")
    who = authorise(user, "cancel_bill", approver, pin)
    lines = [f"{l.item.sku}×{l.qty:f}" for l in draft.lines.all()]
    value = quote(draft).total if lines else 0
    draft.status, draft.cancel_reason, draft.cancelled_by = DraftBill.CANCELLED, reason[:200], who
    draft.save()
    if lines:
        audit("bill_cancel", f"Bill cancelled before payment ({len(lines)} lines): {reason}", user=user, approved_by=who,
              obj=draft, lines=", ".join(lines), value=value)


# --------------------------------------------------------------------------- pricing
@dataclass
class QLine:
    draft_line: DraftLine
    item: Item
    qty: Decimal
    list_price: Decimal
    rate: Decimal
    gross: Decimal
    discount: Decimal = ZERO
    offer: Offer | None = None
    notes: list = field(default_factory=list)
    taxable: Decimal = ZERO
    cgst: Decimal = ZERO
    sgst: Decimal = ZERO

    @property
    def net(self):
        return self.gross - self.discount


@dataclass
class Quote:
    lines: list
    gross: Decimal
    discount: Decimal
    total: Decimal
    problems: list


def _apply_offers(qlines, on):
    offers = list(Offer.objects.filter(is_active=True, starts_on__lte=on, ends_on__gte=on).prefetch_related("items", "categories"))
    taken = set()
    for off in offers:
        item_ids = {i.pk for i in off.items.all()}
        cat_ids = {c.pk for c in off.categories.all()}

        def matches(ql):
            return ql.item.pk in item_ids or ql.item.category_id in cat_ids

        if off.kind == Offer.COMBO:
            members = {}
            for i, ql in enumerate(qlines):
                if i not in taken and ql.item.pk in item_ids:
                    members.setdefault(ql.item.pk, []).append(i)
            if not item_ids or set(members) != item_ids:
                continue
            sets = min(int(sum(qlines[i].qty for i in idx)) for idx in members.values())
            if sets < 1 or not off.amount:
                continue
            idxs = [i for idx in members.values() for i in idx]
            total_disc = min(money(off.amount * sets), sum(qlines[i].gross for i in idxs))
            for i, part in zip(idxs, allocate(total_disc, [qlines[i].gross for i in idxs])):
                qlines[i].discount += part
                qlines[i].offer = off
                taken.add(i)
            continue
        for i, ql in enumerate(qlines):
            if i in taken or not matches(ql):
                continue
            disc = ZERO
            if off.kind == Offer.PERCENT and off.percent:
                disc = money(ql.gross * off.percent / 100)
            elif off.kind == Offer.AMOUNT and off.amount:
                disc = money(off.amount * ql.qty)
            elif off.kind == Offer.QTY and off.min_qty and ql.qty >= off.min_qty:
                if off.deal_price is not None:
                    disc = money((ql.rate - off.deal_price) * ql.qty)
                elif off.percent:
                    disc = money(ql.gross * off.percent / 100)
            disc = min(max(disc, ZERO), ql.gross)
            if disc > 0:
                ql.discount += disc
                ql.offer = off
                taken.add(i)


def quote(draft, on=None) -> Quote:
    on = on or timezone.localdate()
    cfg = StoreSettings.load()
    problems, qlines = [], []
    for dl in draft.lines.select_related("item", "item__category").all():
        item = dl.item
        if item.price is None and dl.price_override is None:
            problems.append(f"{item.name} has no price.")
            continue
        rate = dl.price_override if dl.price_override is not None else item.price
        gross = line_amount(rate, dl.qty)
        qlines.append(QLine(dl, item, dl.qty, item.price or rate, rate, gross))
        if not item.is_active:
            problems.append(f"{item.name} is not active for sale.")
        if cfg.require_tax_setup and item.tax_class == TaxClass.UNSET:
            problems.append(f"{item.name}: GST treatment not set.")
    _apply_offers(qlines, on)
    for ql in qlines:
        dl = ql.draft_line
        if dl.manual_discount:
            ql.discount = min(ql.gross, ql.discount + dl.manual_discount)
            ql.notes.append(f"Manual ₹{dl.manual_discount} ({dl.discount_reason})")
        if ql.offer:
            ql.notes.insert(0, ql.offer.name)
        ql.taxable, ql.cgst, ql.sgst = split_tax(ql.net, ql.item.tax_rate())
    gross = sum((q.gross for q in qlines), ZERO)
    discount = sum((q.discount for q in qlines), ZERO)
    return Quote(qlines, gross, discount, gross - discount, problems)


# --------------------------------------------------------------------------- checkout
def _doc_type(cfg, qlines):
    if not cfg.gstin:
        return Sale.CASH_MEMO
    classes = {q.item.tax_class for q in qlines}
    taxable = TaxClass.TAXABLE in classes
    other = bool(classes - {TaxClass.TAXABLE})
    if taxable and other:
        return Sale.INVOICE_CUM_BOS
    return Sale.TAX_INVOICE if taxable else Sale.BILL_OF_SUPPLY


def checkout(draft_uuid, user, payments, *, customer_id=None, approver="", pin=""):
    """Turn a draft into a sale. Safe to retry: the same draft never makes two sales."""
    existing = Sale.objects.filter(draft_uuid=draft_uuid).first()
    if existing:
        return existing, False
    try:
        with transaction.atomic():
            return _checkout(draft_uuid, user, payments, customer_id, approver, pin), True
    except IntegrityError:
        # A parallel request (double click) committed first: return that sale.
        existing = Sale.objects.filter(draft_uuid=draft_uuid).first()
        if existing:
            return existing, False
        raise


def _checkout(draft_uuid, user, payments, customer_id, approver, pin):
    draft = DraftBill.objects.select_for_update().filter(uuid=draft_uuid).first()
    if draft is None:
        raise BillingError("Bill not found. Refresh the billing screen.")
    if draft.status != DraftBill.OPEN:
        raise BillingError("This bill is no longer open (it was held, cancelled or already paid).")
    shift = require_shift()
    cfg = StoreSettings.load()
    q = quote(draft)
    if not q.lines:
        raise BillingError("The bill is empty.")
    if q.problems:
        raise BillingError(" ".join(q.problems))
    customer = Customer.objects.filter(pk=customer_id).first() if customer_id else draft.customer

    # ---- payments: non-cash amounts are exact; cash covers the rest and gives change
    rows, noncash = [], ZERO
    cash_tendered = None
    for p in payments:
        method = p.get("method")
        if method not in ("cash", "upi", "card", "credit"):
            raise BillingError("Unknown payment method.")
        if method == "cash":
            cash_tendered = (cash_tendered or ZERO) + money(p.get("tendered") or p.get("amount") or 0)
            continue
        amount = money(p.get("amount") or 0)
        if amount <= 0:
            continue
        rows.append({"method": method, "amount": amount, "reference": (p.get("reference") or "")[:60]})
        noncash += amount
    if noncash > q.total:
        raise BillingError("UPI / card / credit amounts are more than the bill total.")
    cash_due = q.total - noncash
    change = ZERO
    if cash_due > 0:
        if cash_tendered is None or cash_tendered < cash_due:
            raise BillingError(f"Payment is short by ₹{cash_due - (cash_tendered or ZERO)}.")
        change = cash_tendered - cash_due
        rows.append({"method": "cash", "amount": cash_due, "tendered": cash_tendered, "change": change, "reference": ""})
    elif cash_tendered:
        raise BillingError("Cash was entered but the bill is already fully paid by other methods.")
    credit = sum((r["amount"] for r in rows if r["method"] == "credit"), ZERO)
    approved_credit_by = None
    if credit:
        if customer is None or not customer.credit_allowed:
            raise BillingError("Credit needs a customer with an approved credit account.")
        if customer.credit_balance + credit > customer.credit_limit:
            raise BillingError(f"Credit limit exceeded: owes ₹{customer.credit_balance}, limit ₹{customer.credit_limit}.")
        approved_credit_by = authorise(user, "credit_sale", approver, pin)

    # ---- the sale
    now = timezone.now()
    bdate = timezone.localdate(now)
    fy = financial_year(bdate)
    seq = Sequence.next(f"bill:{cfg.invoice_prefix}:{fy}")
    bill_no = f"{cfg.invoice_prefix}/{fy}/{seq:05d}"
    if len(bill_no) > 16:
        raise BillingError("Invoice prefix too long: bill numbers must be 16 characters or fewer.")
    sale = Sale.objects.create(
        bill_no=bill_no, draft_uuid=draft.uuid, business_date=bdate, created_at=now, shift=shift, cashier=user,
        customer=customer, gross=q.gross, discount=q.discount, total=q.total, doc_type=_doc_type(cfg, q.lines),
        identity=cfg.identity(),
    )
    for ql in q.lines:
        item = Item.objects.select_related("category", "department").get(pk=ql.item.pk)
        taken = stock.issue(item, ql.qty, kind="sale", ref=bill_no, user=user)
        cost = money(sum((t[1] * t[2] for t in taken), ZERO))
        line = SaleLine.objects.create(
            sale=sale, item=item, sku=item.sku, name=item.name, name_ta=item.name_ta, category=item.category.name,
            department=item.department.name, unit=item.unit_label, qty=ql.qty, list_price=ql.list_price, rate=ql.rate,
            mrp=item.mrp, gross=ql.gross, discount=ql.discount, offer=ql.offer, discount_note="; ".join(ql.notes)[:160],
            net=ql.net, tax_class=item.tax_class, hsn=item.hsn, gst_rate=item.tax_rate(), taxable=ql.taxable,
            cgst=ql.cgst, sgst=ql.sgst, cost=cost, override_by=ql.draft_line.override_by,
        )
        SaleLineLot.objects.bulk_create([SaleLineLot(line=line, lot=lot, qty=t, unit_cost=c) for lot, t, c in taken])
    for r in rows:
        Payment.objects.create(sale=sale, method=r["method"], amount=r["amount"], tendered=r.get("tendered", r["amount"]),
                               change=r.get("change", ZERO), reference=r["reference"])
    if credit:
        CreditEntry.objects.create(customer=customer, amount=credit, kind="sale", sale=sale, shift=shift, user=user,
                                   reference=bill_no)
        audit("credit_sale", f"₹{credit} on credit to {customer}", user=user, approved_by=approved_credit_by, obj=sale)
    if customer and customer.loyalty_enabled and cfg.loyalty_enabled and cfg.loyalty_rupees_per_point > 0:
        pts = Decimal(math.floor(q.total / cfg.loyalty_rupees_per_point))
        if pts > 0:
            LoyaltyEntry.objects.create(customer=customer, points=pts, kind="earn", sale=sale)
            sale.points_earned = pts
            sale.save(update_fields=["points_earned"])
    draft.status = DraftBill.DONE
    draft.customer = customer
    draft.save(update_fields=["status", "customer", "updated_at"])
    # Saved in the same transaction as the bill, payments and stock movements.
    audit("sale", f"Bill {bill_no} ₹{q.total} " + " + ".join(f"{r['method']} ₹{r['amount']}" for r in rows),
          user=user, obj=sale, lines=len(q.lines), change=change)
    return sale


@transaction.atomic
def record_print(sale, user, reprint):
    Sale.objects.filter(pk=sale.pk).update(print_count=F("print_count") + 1)
    if reprint:
        audit("reprint", f"Receipt {sale.bill_no} reprinted", user=user, obj=sale)


# --------------------------------------------------------------------------- returns
def refundable_left(sale):
    return sale.total - sale.refunded


def _return_amounts(sl, q):
    """Exact share of the original line for q units; the last return takes the remainder."""
    previous = sl.return_lines.aggregate(a=Sum("amount"), d=Sum("discount"), t=Sum("taxable"), c=Sum("cgst"),
                                         s=Sum("sgst"), k=Sum("cost"))
    prev = {k: v or ZERO for k, v in previous.items()}
    if q == sl.returnable_qty:
        return (sl.net - prev["a"], sl.discount - prev["d"], sl.taxable - prev["t"], sl.cgst - prev["c"],
                sl.sgst - prev["s"], sl.cost - prev["k"])
    share = q / sl.qty
    return tuple(money(v * share) for v in (sl.net, sl.discount, sl.taxable, sl.cgst, sl.sgst, sl.cost))


def process_return(sale, user, lines, *, method, reason, reference="", approver="", pin="", key=None):
    """lines: [{"line": SaleLine id, "qty": "1", "disposition": "sellable|quarantine|waste"}]"""
    if key and SaleReturn.objects.filter(idempotency_key=key).exists():
        return SaleReturn.objects.get(idempotency_key=key), False
    with transaction.atomic():
        return _process_return(sale, user, lines, method, reason, reference, approver, pin, key), True


def _process_return(sale, user, lines, method, reason, reference, approver, pin, key):
    who = authorise(user, "refund", approver, pin)
    if not reason.strip():
        raise BillingError("Enter the return reason.")
    if method not in ("cash", "upi", "card", "credit"):
        raise BillingError("Choose how the refund is paid.")
    sale = Sale.objects.select_for_update().get(pk=sale.pk)
    shift = open_shift()
    if method == "cash" and shift is None:
        raise BillingError("Open a cashier shift to pay a cash refund from the drawer.")
    if method == "credit" and sale.customer is None:
        raise BillingError("This bill has no customer account to credit.")
    cfg = StoreSettings.load()
    bdate = timezone.localdate()
    fy = financial_year(bdate)
    planned = []
    for row in lines:
        q = D(row.get("qty") or 0)
        if q <= 0:
            continue
        sl = SaleLine.objects.select_for_update().get(pk=row["line"], sale=sale)
        q = parse_qty(q, weighed=sl.unit == "kg")
        if q > sl.returnable_qty:
            raise BillingError(f"{sl.name}: only {sl.returnable_qty:f} {sl.unit} can still be returned.")
        disp = row.get("disposition") or "quarantine"
        if disp not in dict(ReturnLine.DISPOSITIONS):
            raise BillingError("Choose where the returned item goes.")
        planned.append((sl, q, disp))
    if not planned:
        raise BillingError("Choose at least one item and quantity to return.")
    amounts = [_return_amounts(sl, q) for sl, q, _ in planned]
    total = sum((a[0] for a in amounts), ZERO)
    if total > refundable_left(sale):
        raise BillingError(f"Refund ₹{total} is more than the ₹{refundable_left(sale)} still refundable on this bill.")
    seq = Sequence.next(f"cn:{cfg.credit_note_prefix}:{fy}")
    ret = SaleReturn.objects.create(
        number=f"{cfg.credit_note_prefix}/{fy}/{seq:05d}", sale=sale, business_date=bdate, shift=shift, user=user,
        approved_by=who if who != user else None, reason=reason[:200], method=method, reference=reference[:60],
        total=total, idempotency_key=key,
    )
    for (sl, q, disp), (amt, disc, taxable, cgst, sgst, cost) in zip(planned, amounts):
        ReturnLine.objects.create(ret=ret, sale_line=sl, qty=q, amount=amt, discount=disc, taxable=taxable, cgst=cgst,
                                  sgst=sgst, cost=cost, disposition=disp)
        SaleLine.objects.filter(pk=sl.pk).update(returned_qty=F("returned_qty") + q)
        _restock(sl, q, disp, ret, user)
    if method == "credit":
        CreditEntry.objects.create(customer=sale.customer, amount=-total, kind="return", sale_return=ret, user=user,
                                   shift=shift, reference=ret.number)
    if sale.points_earned and sale.customer:
        already = -(LoyaltyEntry.objects.filter(sale_return__sale=sale, kind="reverse").aggregate(s=Sum("points"))["s"] or ZERO)
        pts = min(money(sale.points_earned * total / sale.total), sale.points_earned - already)
        if sale.refunded + ZERO == sale.total:  # fully refunded: reverse every remaining point
            pts = sale.points_earned - already
        if pts > 0:
            LoyaltyEntry.objects.create(customer=sale.customer, points=-pts, kind="reverse", sale_return=ret,
                                        note=f"Return {ret.number}")
            ret.points_reversed = pts
            ret.save(update_fields=["points_reversed"])
    audit("refund", f"Return {ret.number} on {sale.bill_no}: ₹{total} by {method} ({reason})", user=user,
          approved_by=who, obj=ret)
    return ret


def _restock(sl, q, disposition, ret, user):
    """Put returned quantity back on the original lots (latest first) or into quarantine / waste."""
    remaining = q
    for sll in sl.lots.select_related("lot").order_by("-id"):
        if remaining <= 0:
            break
        take = min(sll.qty - sll.returned_qty, remaining)
        if take <= 0:
            continue
        SaleLineLot.objects.filter(pk=sll.pk).update(returned_qty=F("returned_qty") + take)
        lot = sll.lot
        if disposition == "sellable" and lot.status == StockLot.SELLABLE and not lot.is_expired():
            StockLot.objects.filter(pk=lot.pk).update(qty=F("qty") + take)
            stock._move(lot, "return_in", take, ret.number, "Customer return", user, unit_cost=sll.unit_cost)
            stock._sync_on_hand(lot.item_id)
        else:
            status = StockLot.QUARANTINE
            note = "Customer return" if disposition != "sellable" else "Customer return – original lot expired"
            new = stock.add_lot(lot.item, take, sll.unit_cost, kind="return_in", batch=lot.batch, expiry=lot.expiry,
                                ref=ret.number, user=user, status=status, origin=lot, reason=note)
            if disposition == "waste":
                stock.remove_from_lot(new, take, "waste", reason=f"Returned item wasted ({ret.reason})", user=user,
                                      ref=ret.number)
        remaining -= take
