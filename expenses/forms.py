from django import forms
from django.utils import timezone

from .models import Expense, ExpenseCategory

from cholai.forms import BootstrapMixin


class ExpenseCategoryForm(BootstrapMixin, forms.ModelForm):
    class Meta:
        model = ExpenseCategory
        fields = ("name", "description")


class ExpenseForm(BootstrapMixin, forms.ModelForm):
    class Meta:
        model = Expense
        fields = ("spent_on", "category", "description", "amount")
        widgets = {"spent_on": forms.DateInput(attrs={"type": "date"})}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if not self.instance.pk:
            self.fields["spent_on"].initial = timezone.localdate()
