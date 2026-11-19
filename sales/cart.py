"""Billing-counter cart kept in the user's session until checkout."""
from decimal import Decimal

from inventory.models import Product

SESSION_KEY = "pos_cart"
TWO = Decimal("0.01")


class Cart:
    def __init__(self, session):
        self.session = session
        self.data = session.setdefault(SESSION_KEY, {})

    def _save(self):
        self.session.modified = True

    def add(self, product: Product, quantity: Decimal):
        current = Decimal(self.data.get(str(product.pk), "0"))
        self.data[str(product.pk)] = str(current + quantity)
        self._save()

    def set(self, product_id, quantity: Decimal):
        if quantity <= 0:
            self.remove(product_id)
        else:
            self.data[str(product_id)] = str(quantity)
            self._save()

    def remove(self, product_id):
        self.data.pop(str(product_id), None)
        self._save()

    def clear(self):
        self.session[SESSION_KEY] = {}
        self.data = self.session[SESSION_KEY]
        self._save()

    def lines(self):
        products = Product.objects.in_bulk([int(k) for k in self.data])
        result = []
        for pid, qty in self.data.items():
            product = products.get(int(pid))
            if product is None:
                continue
            qty = Decimal(qty)
            result.append(
                {
                    "product": product,
                    "quantity": qty,
                    "line_total": (qty * product.selling_price).quantize(TWO),
                }
            )
        return result

    def subtotal(self):
        return sum((line["line_total"] for line in self.lines()), Decimal("0"))

    def __len__(self):
        return len(self.data)
