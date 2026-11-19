from django import forms
from django.utils import timezone

from .models import Category, Product, Purchase, Supplier

from cholai.forms import BootstrapMixin


class ProductForm(BootstrapMixin, forms.ModelForm):
    class Meta:
        model = Product
        fields = (
            "name", "tamil_name", "code", "category", "unit",
            "cost_price", "selling_price", "stock", "reorder_level", "is_active",
        )

    def clean_code(self):
        return self.cleaned_data.get("code") or None


class CategoryForm(BootstrapMixin, forms.ModelForm):
    class Meta:
        model = Category
        fields = ("name", "description")


class SupplierForm(BootstrapMixin, forms.ModelForm):
    class Meta:
        model = Supplier
        fields = ("name", "phone", "address", "notes")


class PurchaseForm(BootstrapMixin, forms.ModelForm):
    class Meta:
        model = Purchase
        fields = ("purchased_on", "supplier", "product", "quantity", "unit_cost", "invoice_no")
        widgets = {"purchased_on": forms.DateInput(attrs={"type": "date"})}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["product"].queryset = Product.objects.filter(is_active=True)
        if not self.instance.pk:
            self.fields["purchased_on"].initial = timezone.localdate()
