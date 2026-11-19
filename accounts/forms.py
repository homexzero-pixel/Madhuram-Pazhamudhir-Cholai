from django import forms
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth.models import Group

from .models import User

from cholai.forms import BootstrapMixin


class StaffCreateForm(BootstrapMixin, UserCreationForm):
    role = forms.ModelChoiceField(queryset=Group.objects.order_by("name"))

    class Meta:
        model = User
        fields = ("username", "first_name", "last_name", "email", "phone")

    def save(self, commit=True):
        user = super().save(commit=commit)
        if commit:
            user.groups.set([self.cleaned_data["role"]])
        return user


class StaffEditForm(BootstrapMixin, forms.ModelForm):
    role = forms.ModelChoiceField(queryset=Group.objects.order_by("name"))

    class Meta:
        model = User
        fields = ("username", "first_name", "last_name", "email", "phone")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance.pk:
            self.fields["role"].initial = self.instance.groups.first()

    def save(self, commit=True):
        user = super().save(commit=commit)
        if commit:
            user.groups.set([self.cleaned_data["role"]])
        return user


class ProfileForm(BootstrapMixin, forms.ModelForm):
    class Meta:
        model = User
        fields = ("first_name", "last_name", "email", "phone")


class RoleForm(BootstrapMixin, forms.ModelForm):
    description = forms.CharField(max_length=200, required=False)

    class Meta:
        model = Group
        fields = ("name",)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance.pk and hasattr(self.instance, "profile"):
            self.fields["description"].initial = self.instance.profile.description

    def save(self, commit=True):
        group = super().save(commit=True)
        from .models import RoleProfile

        RoleProfile.objects.update_or_create(
            group=group, defaults={"description": self.cleaned_data.get("description", "")}
        )
        return group
