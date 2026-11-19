from django import forms

from .models import StoreProfile

from cholai.forms import BootstrapMixin


class StoreProfileForm(BootstrapMixin, forms.ModelForm):
    class Meta:
        model = StoreProfile
        exclude = ("updated_at",)
        widgets = {"address": forms.Textarea(attrs={"rows": 3})}
