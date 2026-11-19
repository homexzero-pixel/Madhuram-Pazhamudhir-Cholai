from django.contrib import messages
from django.core.paginator import Paginator
from django.db.models import ProtectedError, Q, Sum
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from accounts.permissions import manager_required

from .forms import ExpenseCategoryForm, ExpenseForm
from .models import Expense, ExpenseCategory


@manager_required
def expense_list(request):
    q = request.GET.get("q", "").strip()
    expenses = Expense.objects.select_related("category", "created_by")
    if q:
        expenses = expenses.filter(Q(description__icontains=q) | Q(category__name__icontains=q))
    total = expenses.aggregate(s=Sum("amount"))["s"] or 0
    page = Paginator(expenses, 20).get_page(request.GET.get("page"))
    return render(request, "expenses/expense_list.html", {"page": page, "q": q, "total": total})


@manager_required
def expense_edit(request, pk=None):
    expense = get_object_or_404(Expense, pk=pk) if pk else None
    form = ExpenseForm(request.POST or None, instance=expense)
    if form.is_valid():
        obj = form.save(commit=False)
        if not obj.pk:
            obj.created_by = request.user
        obj.save()
        messages.success(request, "Expense saved.")
        return redirect("expense_list")
    return render(request, "form.html", {"form": form, "title": "Expense", "back": "expense_list"})


@manager_required
@require_POST
def expense_delete(request, pk):
    get_object_or_404(Expense, pk=pk).delete()
    messages.success(request, "Expense deleted.")
    return redirect("expense_list")


@manager_required
def category_list(request):
    categories = ExpenseCategory.objects.annotate(total=Sum("expenses__amount"))
    return render(request, "expenses/category_list.html", {"categories": categories})


@manager_required
def category_edit(request, pk=None):
    category = get_object_or_404(ExpenseCategory, pk=pk) if pk else None
    form = ExpenseCategoryForm(request.POST or None, instance=category)
    if form.is_valid():
        form.save()
        messages.success(request, "Expense category saved.")
        return redirect("expense_category_list")
    return render(request, "form.html", {"form": form, "title": "Expense category", "back": "expense_category_list"})


@manager_required
@require_POST
def category_delete(request, pk):
    try:
        get_object_or_404(ExpenseCategory, pk=pk).delete()
        messages.success(request, "Expense category deleted.")
    except ProtectedError:
        messages.error(request, "This category still has expenses.")
    return redirect("expense_category_list")
