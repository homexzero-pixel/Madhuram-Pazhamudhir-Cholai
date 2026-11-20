from decimal import Decimal

from django.db import IntegrityError, transaction
from django.utils import timezone

from core.models import Sequence, audit
from core.money import ZERO, D, money, qty
from inventory import services as stock
from inventory.models import StockLot

from .models import GoodsReceipt, GRNLine, POLine, PurchaseOrder, PurchaseReturn, PurchaseReturnLine, Supplier, SupplierPayment


class PurchaseError(ValueError):
    pass


def _number(prefix):
    fy = timezone.localdate().strftime("%y")
    return f"{prefix}{fy}-{Sequence.next(f'{prefix}:{fy}'):05d}"


@transaction.atomic
def create_po(supplier, user, lines, *, expected_on=None, notes=""):
    """lines: [{"item": Item, "qty": purchase units, "unit_cost": per purchase unit}]"""
    rows = [l for l in lines if D(l.get("qty")) > 0]
    if not rows:
        raise PurchaseError("Add at least one item with a quantity.")
    po = PurchaseOrder.objects.create(number=_number("PO"), supplier=supplier, expected_on=expected_on, notes=notes,
                                      created_by=user)
    for l in rows:
        POLine.objects.create(order=po, item=l["item"], qty=qty(l["qty"]), unit_cost=money(l.get("unit_cost") or 0))
    audit("po_create", f"{po.number} to {supplier} ({len(rows)} items)", user=user, obj=po)
    return po


def receive(supplier, user, *, invoice_no, invoice_date, invoice_total, lines, order=None, notes=""):
    """Record a goods receipt. One supplier invoice may hold many items and lots, but is recorded once.

    lines: [{"item", "qty", "free_qty", "damaged_qty", "unit_cost" (per purchase unit), "batch", "expiry",
             "units_per_purchase" (optional; defaults to the item's conversion), "po_line" (optional)}]
    """
    invoice_no = (invoice_no or "").strip()
    if not invoice_no:
        raise PurchaseError("Enter the supplier invoice number.")
    if GoodsReceipt.objects.filter(supplier=supplier, invoice_no__iexact=invoice_no).exists():
        raise PurchaseError(f"Invoice {invoice_no} from {supplier} is already recorded. Add missing items to that GRN's supplier instead of entering it twice.")
    try:
        with transaction.atomic():
            return _receive(supplier, user, invoice_no, invoice_date, invoice_total, lines, order, notes)
    except IntegrityError as exc:
        raise PurchaseError(f"Invoice {invoice_no} from {supplier} is already recorded.") from exc


def _receive(supplier, user, invoice_no, invoice_date, invoice_total, lines, order, notes):
    rows = [l for l in lines if D(l.get("qty")) > 0 or D(l.get("free_qty")) > 0]
    if not rows:
        raise PurchaseError("Enter the received quantity for at least one item.")
    grn = GoodsReceipt.objects.create(
        number=_number("GRN"), supplier=supplier, order=order, invoice_no=invoice_no, invoice_date=invoice_date,
        invoice_total=money(invoice_total), received_by=user, notes=notes,
    )
    for l in rows:
        item = l["item"]
        billed, free, damaged = qty(l.get("qty") or 0), qty(l.get("free_qty") or 0), qty(l.get("damaged_qty") or 0)
        conv = qty(l.get("units_per_purchase") or item.units_per_purchase)
        if min(billed, free, damaged) < 0 or conv <= 0:
            raise PurchaseError(f"{item.name}: quantities cannot be negative.")
        if damaged > billed + free:
            raise PurchaseError(f"{item.name}: damaged quantity is more than received.")
        expiry = l.get("expiry") or None
        if item.track_expiry and not expiry:
            raise PurchaseError(f"{item.name}: enter the expiry date (this item tracks expiry).")
        if item.track_batch and not (l.get("batch") or "").strip():
            raise PurchaseError(f"{item.name}: enter the batch number.")
        if expiry and expiry < timezone.localdate():
            raise PurchaseError(f"{item.name}: expiry {expiry:%d-%m-%Y} is already past. Do not receive expired stock.")
        if not item.weighed and (billed + free - damaged) * conv != ((billed + free - damaged) * conv).to_integral_value():
            raise PurchaseError(f"{item.name}: received pieces must be a whole number.")
        po_line = l.get("po_line")
        if po_line is not None:
            if po_line.order_id != getattr(order, "pk", None) or po_line.item_id != item.pk:
                raise PurchaseError("Receipt line does not match the purchase order.")
            if billed + po_line.received_qty > po_line.qty:
                raise PurchaseError(f"{item.name}: more than the {po_line.outstanding:f} still outstanding on {order.number}.")
            POLine.objects.filter(pk=po_line.pk).update(received_qty=po_line.received_qty + billed)
        gl = GRNLine.objects.create(grn=grn, po_line=po_line, item=item, qty=billed, free_qty=free, damaged_qty=damaged,
                                    units_per_purchase=conv, unit_cost=money(l.get("unit_cost") or 0),
                                    batch=(l.get("batch") or "").strip()[:40], expiry=expiry)
        good_units = (billed + free - damaged) * conv
        all_units = (billed + free) * conv
        # Actual cost per sale unit: what we paid spread over everything that arrived (free goods lower it).
        unit_cost = (billed * gl.unit_cost / all_units) if all_units else Decimal(0)
        if good_units > 0:
            stock.add_lot(item, good_units, unit_cost.quantize(Decimal("0.0001")), kind="purchase", batch=gl.batch,
                          expiry=expiry, ref=grn.number, supplier=supplier, grn_line=gl, user=user,
                          reason=f"Invoice {invoice_no}")
            type(item).objects.filter(pk=item.pk).update(cost=unit_cost.quantize(Decimal("0.01")))
        if damaged > 0:
            dlot = stock.add_lot(item, damaged * conv, unit_cost.quantize(Decimal("0.0001")), kind="purchase",
                                 batch=gl.batch, expiry=expiry, ref=grn.number, supplier=supplier, grn_line=gl,
                                 user=user, status=StockLot.QUARANTINE, reason="Damaged on arrival")
            stock.remove_from_lot(dlot, damaged * conv, "damage", reason=f"Damaged on arrival, invoice {invoice_no}",
                                  user=user, ref=grn.number)
    if order is not None:
        order.refresh_status()
    audit("grn", f"{grn.number}: invoice {invoice_no} from {supplier}, ₹{grn.invoice_total}", user=user, obj=grn,
          difference=grn.invoice_difference)
    return grn


@transaction.atomic
def return_to_supplier(supplier, user, lots_qty, reason, grn=None):
    """lots_qty: [(StockLot, qty in sale units)]"""
    if not reason.strip():
        raise PurchaseError("Enter the reason for the return.")
    rows = [(lot, qty(q)) for lot, q in lots_qty if D(q) > 0]
    if not rows:
        raise PurchaseError("Choose the lots and quantities to return.")
    pr = PurchaseReturn.objects.create(number=_number("PR"), supplier=supplier, grn=grn, created_by=user, reason=reason)
    total = ZERO
    for lot, q in rows:
        if lot.supplier_id and lot.supplier_id != supplier.pk:
            raise PurchaseError(f"Lot {lot.pk} came from a different supplier.")
        stock.remove_from_lot(lot, q, "purchase_return", reason=reason, user=user, ref=pr.number)
        amount = money(q * lot.unit_cost)
        PurchaseReturnLine.objects.create(ret=pr, lot=lot, qty=q, unit_cost=lot.unit_cost, amount=amount)
        total += amount
    pr.total = total
    pr.save(update_fields=["total"])
    audit("purchase_return", f"{pr.number} to {supplier}: ₹{total} ({reason})", user=user, obj=pr)
    return pr


@transaction.atomic
def pay_supplier(supplier, user, amount, method, reference="", paid_on=None):
    amount = money(amount)
    if amount <= 0:
        raise PurchaseError("Enter an amount above zero.")
    shift = None
    if method == "cash":
        from sales.services import cash_summary, require_shift

        shift = require_shift()
        if amount > cash_summary(shift)["expected"]:
            raise PurchaseError("The drawer does not hold that much cash.")
    p = SupplierPayment.objects.create(supplier=supplier, amount=amount, method=method, reference=reference,
                                       paid_on=paid_on or timezone.localdate(), shift=shift, created_by=user)
    audit("supplier_payment", f"₹{amount} to {supplier} by {method} {reference}", user=user, obj=p)
    return p
