"""All stock changes go through here so lots, Item.on_hand and the ledger never disagree."""
from decimal import Decimal

from django.db import transaction
from django.db.models import F, Sum
from django.utils import timezone

from catalog.models import Item
from core.models import audit
from core.money import ZERO, qty

from .models import StockLot, StockMove


class StockError(ValueError):
    pass


def _sync_on_hand(item_id):
    total = StockLot.objects.filter(item_id=item_id, status=StockLot.SELLABLE).aggregate(s=Sum("qty"))["s"] or ZERO
    Item.objects.filter(pk=item_id).update(on_hand=total)
    return total


def _move(lot, kind, q, ref="", reason="", user=None, approved_by=None, unit_cost=None):
    return StockMove.objects.create(
        item_id=lot.item_id, lot=lot, kind=kind, qty=q, unit_cost=lot.unit_cost if unit_cost is None else unit_cost,
        ref=ref[:60], reason=reason[:200], user=user if getattr(user, "pk", None) else None,
        approved_by=approved_by if getattr(approved_by, "pk", None) else None,
    )


@transaction.atomic
def add_lot(item, quantity, unit_cost, *, kind="purchase", batch="", expiry=None, ref="", supplier=None,
            grn_line=None, user=None, status=StockLot.SELLABLE, origin=None, reason=""):
    quantity = qty(quantity)
    if quantity <= 0:
        raise StockError("Quantity must be more than zero.")
    lot = StockLot.objects.create(
        item=item, batch=batch, expiry=expiry, received_qty=quantity, qty=quantity, unit_cost=unit_cost,
        status=status, source=ref[:60], supplier=supplier, grn_line=grn_line, origin=origin,
    )
    _move(lot, kind, quantity, ref, reason, user)
    _sync_on_hand(item.pk)
    return lot


def sellable_lots(item, on=None, lock=False):
    """Lots that may be sold, earliest expiry first (no-expiry lots last, then oldest)."""
    on = on or timezone.localdate()
    qs = StockLot.objects.filter(item=item, status=StockLot.SELLABLE, qty__gt=0).exclude(expiry__lt=on)
    if lock:
        qs = qs.select_for_update()
    return sorted(qs, key=lambda l: (l.expiry is None, l.expiry or on, l.received_at, l.id))


def available(item, on=None):
    return sum((l.qty for l in sellable_lots(item, on)), ZERO)


def expired_qty(item, on=None):
    on = on or timezone.localdate()
    return StockLot.objects.filter(item=item, status=StockLot.SELLABLE, qty__gt=0, expiry__lt=on).aggregate(s=Sum("qty"))["s"] or ZERO


def issue(item, quantity, *, kind="sale", ref="", user=None, reason=""):
    """Take stock out FEFO. Returns [(lot, qty, unit_cost)]. Must run inside a transaction."""
    assert transaction.get_connection().in_atomic_block
    quantity = qty(quantity)
    taken, remaining = [], quantity
    for lot in sellable_lots(item, lock=True):
        if remaining <= 0:
            break
        take = min(lot.qty, remaining)
        StockLot.objects.filter(pk=lot.pk).update(qty=F("qty") - take)
        _move(lot, kind, -take, ref, reason, user)
        taken.append((lot, take, lot.unit_cost))
        remaining -= take
    if remaining > 0:
        have = quantity - remaining
        exp = expired_qty(item)
        msg = f"Not enough stock of {item.name}: need {quantity:f}, sellable {have:f} {item.unit_label}."
        if exp:
            msg += f" ({exp:f} {item.unit_label} is past expiry and blocked.)"
        raise StockError(msg)
    _sync_on_hand(item.pk)
    return taken


@transaction.atomic
def remove_from_lot(lot, quantity, kind, *, reason, user=None, approved_by=None, ref=""):
    """Write-off, damage, expiry, supplier return or move to quarantine from a specific lot."""
    quantity = qty(quantity)
    lot = StockLot.objects.select_for_update().get(pk=lot.pk)
    if quantity <= 0:
        raise StockError("Quantity must be more than zero.")
    if quantity > lot.qty:
        raise StockError(f"Lot {lot.pk} only has {lot.qty:f}.")
    if not reason.strip():
        raise StockError("Enter a reason.")
    StockLot.objects.filter(pk=lot.pk).update(qty=F("qty") - quantity)
    mv = _move(lot, kind, -quantity, ref, reason, user, approved_by)
    _sync_on_hand(lot.item_id)
    if kind in ("waste", "damage", "expiry"):
        audit("write_off", f"{kind} {quantity:f} {lot.item.unit_label} of {lot.item.name} (lot {lot.pk}): {reason}",
              user=user, approved_by=approved_by, obj=lot)
    return mv


@transaction.atomic
def quarantine(lot, quantity, *, reason, user=None):
    """Move part of a sellable lot to a quarantine lot (same cost, batch and expiry)."""
    remove_from_lot(lot, quantity, "transfer_out", reason=reason, user=user)
    return add_lot(lot.item, quantity, lot.unit_cost, kind="transfer_in", batch=lot.batch, expiry=lot.expiry,
                   ref=f"Q-from-{lot.pk}", supplier=lot.supplier, user=user, status=StockLot.QUARANTINE,
                   origin=lot, reason=reason)


@transaction.atomic
def adjust_lot(lot, new_qty, *, reason, user=None, approved_by=None, ref=""):
    lot = StockLot.objects.select_for_update().get(pk=lot.pk)
    diff = qty(new_qty) - lot.qty
    if diff == 0:
        return None
    StockLot.objects.filter(pk=lot.pk).update(qty=F("qty") + diff)
    mv = _move(lot, "adjust", diff, ref, reason, user, approved_by)
    _sync_on_hand(lot.item_id)
    return mv


def ledger_balance(item):
    """On hand according to the ledger (for integrity checks)."""
    return StockMove.objects.filter(item=item, lot__status=StockLot.SELLABLE).aggregate(s=Sum("qty"))["s"] or Decimal("0")
