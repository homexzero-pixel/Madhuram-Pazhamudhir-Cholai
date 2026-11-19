from django.db import transaction
from django.db.models import F

from .models import Product, Purchase


@transaction.atomic
def record_purchase(purchase: Purchase, update_cost_price=True):
    """Save a new purchase and add its quantity to stock."""
    purchase.save()
    updates = {"stock": F("stock") + purchase.quantity}
    if update_cost_price:
        updates["cost_price"] = purchase.unit_cost
    Product.objects.filter(pk=purchase.product_id).update(**updates)
    return purchase


@transaction.atomic
def update_purchase(purchase: Purchase, old_product_id, old_quantity):
    """Save an edited purchase, moving the stock difference to the right product."""
    Product.objects.filter(pk=old_product_id).update(stock=F("stock") - old_quantity)
    purchase.save()
    Product.objects.filter(pk=purchase.product_id).update(stock=F("stock") + purchase.quantity)


@transaction.atomic
def delete_purchase(purchase: Purchase):
    Product.objects.filter(pk=purchase.product_id).update(stock=F("stock") - purchase.quantity)
    purchase.delete()
