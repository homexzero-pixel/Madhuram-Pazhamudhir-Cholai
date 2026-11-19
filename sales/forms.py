from decimal import Decimal

from django import forms

from .models import Sale

from cholai.forms import BootstrapMixin


class AddToCartForm(BootstrapMixin, forms.Form):
    product = forms.IntegerField(widget=forms.HiddenInput)
    quantity = forms.DecimalField(min_value=Decimal("0.001"), decimal_places=3, initial=1)


class CheckoutForm(BootstrapMixin, forms.Form):
    customer_name = forms.CharField(max_length=80, required=False)
    customer_phone = forms.CharField(max_length=15, required=False)
    discount = forms.DecimalField(min_value=0, decimal_places=2, initial=0, required=False)
    payment_method = forms.ChoiceField(choices=Sale.PAYMENT_CHOICES, initial="cash")
    amount_received = forms.DecimalField(min_value=0, decimal_places=2, required=False)
