from django import forms
from django.contrib import messages
from django.core.exceptions import PermissionDenied
from django.core.paginator import Paginator
from django.db import transaction
from django.db.models import Q, Sum
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from accounts.permissions import authorise, require
from cholai.forms import BootstrapMixin
from core.models import audit
from core.money import ZERO, money

from .models import CreditEntry, Customer, Offer


class CustomerForm(BootstrapMixin, forms.ModelForm):
    approver = forms.CharField(required=False, label="Approver user name (for credit changes)")
    pin = forms.CharField(required=False, widget=forms.PasswordInput, label="Approver PIN")

    class Meta:
        model = Customer
        fields = ["name", "name_ta", "phone", "address", "gstin", "loyalty_enabled", "credit_allowed", "credit_limit", "notes"]

    def clean_phone(self):
        p = (self.cleaned_data.get("phone") or "").strip()
        if p and (not p.isdigit() or len(p) != 10):
            raise forms.ValidationError("Enter a 10-digit mobile number.")
        return p or None


@require("customers")
def customer_list(request):
    qs = Customer.objects.all()
    q = request.GET.get("q", "").strip()
    if q:
        qs = qs.filter(Q(name__icontains=q) | Q(phone__startswith=q) | Q(name_ta__icontains=q))
    if request.GET.get("credit"):
        qs = qs.filter(credit_allowed=True)
    qs = qs.annotate(owed=Sum("credit_entries__amount"))
    return render(request, "customers/list.html", {"nav": "customers", "page": Paginator(qs.order_by("name"), 40).get_page(request.GET.get("page")), "q": q})


@require("customers")
def customer_edit(request, pk=None):
    c = get_object_or_404(Customer, pk=pk) if pk else None
    before = (c.credit_allowed, c.credit_limit) if c else (False, ZERO)
    form = CustomerForm(request.POST or None, instance=c)
    if form.is_valid():
        obj = form.save(commit=False)
        try:
            if (obj.credit_allowed, obj.credit_limit) != before:
                who = authorise(request.user, "credit_sale", form.cleaned_data.get("approver", ""), form.cleaned_data.get("pin", ""))
                obj.credit_approved_by = who
                audit("credit_limit", f"{obj.name}: credit {'allowed' if obj.credit_allowed else 'off'}, limit ₹{obj.credit_limit}", user=request.user, approved_by=who)
            obj.save()
            messages.success(request, "Customer saved.")
            return redirect("customer_detail", pk=obj.pk)
        except PermissionDenied as exc:
            form.add_error(None, str(exc))
    return render(request, "form.html", {"nav": "customers", "form": form, "title": c.name if c else "New customer",
                                         "subtitle": "Phone is optional. Walk-in billing never needs a customer.", "back": "/customers/"})


@require("customers")
def customer_detail(request, pk):
    c = get_object_or_404(Customer, pk=pk)
    sales = c.sales.order_by("-id")[:50]
    return render(request, "customers/detail.html", {"nav": "customers", "c": c, "sales": sales, "credit": c.credit_entries.all()[:50],
                                                     "loyalty": c.loyalty.order_by("-at")[:30],
                                                     "spent": c.sales.aggregate(s=Sum("total"))["s"] or ZERO})


@require("customers")
@require_POST
def collect_credit(request, pk):
    from sales.services import require_shift

    c = get_object_or_404(Customer, pk=pk)
    method = request.POST.get("method", "cash")
    try:
        amount = money(request.POST.get("amount"))
        if amount <= 0:
            raise ValueError("Enter an amount above zero.")
        if amount > c.credit_balance:
            raise ValueError(f"{c.name} owes only ₹{c.credit_balance}.")
        with transaction.atomic():
            shift = require_shift() if method == "cash" else None
            e = CreditEntry.objects.create(customer=c, amount=-amount, kind="payment", method=method, shift=shift, user=request.user,
                                           reference=request.POST.get("reference", ""))
            audit("credit_collect", f"₹{amount} received from {c} by {method}", user=request.user, obj=e)
        messages.success(request, f"₹{amount} received.{' Added to the cash drawer.' if method == 'cash' else ''}")
    except ValueError as exc:
        messages.error(request, str(exc))
    return redirect("customer_detail", pk=pk)


class OfferForm(BootstrapMixin, forms.ModelForm):
    item_codes = forms.CharField(required=False, label="Items (SKUs, comma-separated)", widget=forms.Textarea(attrs={"rows": 2}))

    class Meta:
        model = Offer
        fields = ["name", "kind", "priority", "is_active", "starts_on", "ends_on", "categories", "percent", "amount", "min_qty", "deal_price"]
        widgets = {"starts_on": forms.DateInput(), "ends_on": forms.DateInput(), "categories": forms.SelectMultiple(attrs={"size": 6})}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance.pk:
            self.fields["item_codes"].initial = ", ".join(self.instance.items.values_list("sku", flat=True))

    def clean(self):
        from catalog.models import Item

        c = super().clean()
        codes = [x.strip().upper() for x in (c.get("item_codes") or "").replace("\n", ",").split(",") if x.strip()]
        items = list(Item.objects.filter(sku__in=codes))
        missing = set(codes) - {i.sku for i in items}
        if missing:
            self.add_error("item_codes", f"Unknown SKUs: {', '.join(sorted(missing))}")
        c["items"] = items
        k = c.get("kind")
        if c.get("starts_on") and c.get("ends_on") and c["ends_on"] < c["starts_on"]:
            self.add_error("ends_on", "End date is before the start date.")
        if k == Offer.PERCENT and not c.get("percent"):
            self.add_error("percent", "Enter the % off.")
        if k == Offer.AMOUNT and not c.get("amount"):
            self.add_error("amount", "Enter ₹ off per unit.")
        if k == Offer.QTY and (not c.get("min_qty") or (c.get("deal_price") is None and not c.get("percent"))):
            self.add_error("min_qty", "Enter the minimum quantity and either a deal price or % off.")
        if k == Offer.COMBO and (len(items) < 2 or not c.get("amount")):
            self.add_error("item_codes", "A combo needs at least two SKUs and ₹ off the set.")
        if not items and not c.get("categories"):
            self.add_error("item_codes", "Choose items or categories for the offer.")
        return c


@require("offers")
def offer_list(request):
    from django.utils import timezone

    return render(request, "customers/offers.html", {"nav": "settings", "offers": Offer.objects.prefetch_related("items", "categories"),
                                                     "today": timezone.localdate()})


@require("offers")
def offer_edit(request, pk=None):
    o = get_object_or_404(Offer, pk=pk) if pk else None
    form = OfferForm(request.POST or None, instance=o)
    if form.is_valid():
        obj = form.save(commit=False)
        if not obj.pk:
            obj.created_by = request.user
        obj.save()
        form.save_m2m()
        obj.items.set(form.cleaned_data["items"])
        audit("offer", f"Offer '{obj.name}' saved ({obj.get_kind_display()}, {obj.starts_on}–{obj.ends_on}, priority {obj.priority})", user=request.user, obj=obj)
        messages.success(request, "Offer saved.")
        return redirect("offer_list")
    return render(request, "form.html", {"nav": "settings", "form": form, "title": "Offer", "back": "/customers/offers/",
                                         "subtitle": "Lower priority number is tried first. Each bill line gets at most one offer; a combo applies to the whole set."})
