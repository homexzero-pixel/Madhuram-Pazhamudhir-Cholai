from datetime import date, timedelta

from django import forms
from django.contrib import messages
from django.core.paginator import Paginator
from django.db import transaction
from django.db.models import Sum
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone

from accounts.permissions import require
from cholai.forms import BootstrapMixin
from core.models import audit
from core.money import ZERO

from .models import Expense, ExpenseCategory


class ExpenseForm(BootstrapMixin, forms.ModelForm):
    class Meta:
        model = Expense
        fields = ["spent_on", "category", "description", "amount", "method", "reference"]
        widgets = {"spent_on": forms.DateInput()}

    def clean_amount(self):
        a = self.cleaned_data["amount"]
        if a <= 0:
            raise forms.ValidationError("Amount must be more than zero.")
        return a


def _d(v, default):
    try:
        return date.fromisoformat(v)
    except (TypeError, ValueError):
        return default


@require("expenses")
def expense_list(request):
    today = timezone.localdate()
    start, end = _d(request.GET.get("start"), today.replace(day=1)), _d(request.GET.get("end"), today)
    qs = Expense.objects.select_related("category", "created_by").filter(spent_on__range=(start, end))
    if request.GET.get("category"):
        qs = qs.filter(category_id=request.GET["category"])
    by_cat = qs.values("category__name").annotate(t=Sum("amount")).order_by("-t")
    by_method = qs.values("method").annotate(t=Sum("amount")).order_by("-t")
    return render(request, "expenses/list.html", {"nav": "expenses", "page": Paginator(qs, 40).get_page(request.GET.get("page")),
                                                  "start": start, "end": end, "total": qs.aggregate(s=Sum("amount"))["s"] or ZERO,
                                                  "by_cat": by_cat, "by_method": by_method, "categories": ExpenseCategory.objects.all()})


@require("expenses")
def expense_edit(request, pk=None):
    from sales.services import cash_summary, open_shift

    e = get_object_or_404(Expense, pk=pk) if pk else None
    if e and e.shift_id and e.shift.status == "closed":
        messages.error(request, "This cash expense belongs to a closed shift. Reopen the shift first (manager).")
        return redirect("expense_list")
    form = ExpenseForm(request.POST or None, instance=e, initial={"spent_on": timezone.localdate()})
    if form.is_valid():
        obj = form.save(commit=False)
        with transaction.atomic():
            if obj.method == "cash":
                shift = open_shift()
                if shift is None:
                    form.add_error("method", "Cash from the drawer needs an open shift. Open one in Cash Closing, or choose Bank.")
                    return render(request, "form.html", {"nav": "expenses", "form": form, "title": "Expense", "back": "/expenses/"})
                if obj.amount > cash_summary(shift)["expected"] + (e.amount if e and e.method == "cash" else ZERO):
                    form.add_error("amount", "The drawer should not hold that much cash.")
                    return render(request, "form.html", {"nav": "expenses", "form": form, "title": "Expense", "back": "/expenses/"})
                obj.shift = shift
            else:
                obj.shift = None
            if not obj.pk:
                obj.created_by = request.user
            obj.save()
            audit("expense", f"{obj.category}: ₹{obj.amount} by {obj.method} – {obj.description}", user=request.user, obj=obj)
        messages.success(request, "Expense saved.")
        return redirect("expense_list")
    return render(request, "form.html", {"nav": "expenses", "form": form, "title": "Expense", "back": "/expenses/",
                                         "subtitle": "'Cash from drawer' reduces the expected cash in the open shift."})


@require("expenses")
def category_add(request):
    name = request.POST.get("name", "").strip()
    if request.method == "POST" and name:
        ExpenseCategory.objects.get_or_create(name=name)
        messages.success(request, "Category added.")
    return redirect("expense_list")
