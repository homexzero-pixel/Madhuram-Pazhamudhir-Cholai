from decimal import Decimal

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from inventory.models import Product

from .models import Sale, SaleItem


class CheckoutError(Exception):
    pass


def next_bill_no():
    prefix = timezone.localdate().strftime("MPC%y%m%d-")
    last = Sale.objects.filter(bill_no__startswith=prefix).order_by("-bill_no").values_list("bill_no", flat=True).first()
    seq = int(last.rsplit("-", 1)[1]) + 1 if last else 1
    return f"{prefix}{seq:04d}"


@transaction.atomic
def checkout(cart, cashier, *, discount=Decimal("0"), payment_method="cash", amount_received=None,
             customer_name="", customer_phone=""):
    lines = cart.lines()
    if not lines:
        raise CheckoutError("The cart is empty.")

    # Lock product rows so two counters cannot oversell the same stock.
    products = Product.objects.select_for_update().in_bulk([line["product"].pk for line in lines])
    for line in lines:
        product = products[line["product"].pk]
        if line["quantity"] > product.stock:
            raise CheckoutError(f"Only {product.stock.normalize()} {product.unit} of {product.name} in stock.")

    subtotal = sum((line["line_total"] for line in lines), Decimal("0"))
    discount = min(max(discount, Decimal("0")), subtotal)
    total = subtotal - discount
    if amount_received is None or payment_method != "cash":
        amount_received = total
    if amount_received < total:
        raise CheckoutError("Amount received is less than the bill total.")

    sale = Sale.objects.create(
        bill_no=next_bill_no(),
        customer_name=customer_name,
        customer_phone=customer_phone,
        subtotal=subtotal,
        discount=discount,
        total=total,
        payment_method=payment_method,
        amount_received=amount_received,
        cashier=cashier,
    )
    for line in lines:
        product = products[line["product"].pk]
        SaleItem.objects.create(
            sale=sale,
            product=product,
            product_name=product.name,
            unit=product.unit,
            quantity=line["quantity"],
            unit_price=product.selling_price,
            unit_cost=product.cost_price,
            line_total=line["line_total"],
        )
        Product.objects.filter(pk=product.pk).update(stock=F("stock") - line["quantity"])
    cart.clear()
    return sale


@transaction.atomic
def void_sale(sale: Sale):
    if sale.status == Sale.STATUS_VOID:
        return sale
    for item in sale.items.all():
        Product.objects.filter(pk=item.product_id).update(stock=F("stock") + item.quantity)
    sale.status = Sale.STATUS_VOID
    sale.save(update_fields=["status"])
    return sale
