from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.core.paginator import Paginator
from django.db.models import F, ProtectedError, Q
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from accounts.permissions import manager_required

from . import services
from .forms import CategoryForm, ProductForm, PurchaseForm, SupplierForm
from .models import Category, Product, Purchase, Supplier


# ---------- products ----------
@login_required
def product_list(request):
    q = request.GET.get("q", "").strip()
    cat = request.GET.get("category", "")
    products = Product.objects.select_related("category")
    if q:
        products = products.filter(Q(name__icontains=q) | Q(tamil_name__icontains=q) | Q(code__iexact=q))
    if cat:
        products = products.filter(category_id=cat)
    if request.GET.get("low"):
        products = products.filter(stock__lte=F("reorder_level"))
    page = Paginator(products, 20).get_page(request.GET.get("page"))
    return render(
        request,
        "inventory/product_list.html",
        {"page": page, "q": q, "categories": Category.objects.all(), "cat": cat, "low": request.GET.get("low")},
    )


@manager_required
def product_edit(request, pk=None):
    product = get_object_or_404(Product, pk=pk) if pk else None
    form = ProductForm(request.POST or None, instance=product)
    if form.is_valid():
        form.save()
        messages.success(request, "Product saved.")
        return redirect("product_list")
    title = f"Edit {product.name}" if product else "Add product"
    return render(request, "form.html", {"form": form, "title": title, "back": "product_list"})


@manager_required
@require_POST
def product_delete(request, pk):
    product = get_object_or_404(Product, pk=pk)
    try:
        product.delete()
        messages.success(request, "Product deleted.")
    except ProtectedError:
        product.is_active = False
        product.save(update_fields=["is_active"])
        messages.warning(request, "Product has sales or purchases, so it was marked inactive instead.")
    return redirect("product_list")


# ---------- categories ----------
@manager_required
def category_list(request):
    return render(request, "inventory/category_list.html", {"categories": Category.objects.all()})


@manager_required
def category_edit(request, pk=None):
    category = get_object_or_404(Category, pk=pk) if pk else None
    form = CategoryForm(request.POST or None, instance=category)
    if form.is_valid():
        form.save()
        messages.success(request, "Category saved.")
        return redirect("category_list")
    return render(request, "form.html", {"form": form, "title": "Category", "back": "category_list"})


@manager_required
@require_POST
def category_delete(request, pk):
    try:
        get_object_or_404(Category, pk=pk).delete()
        messages.success(request, "Category deleted.")
    except ProtectedError:
        messages.error(request, "This category still has products.")
    return redirect("category_list")


# ---------- suppliers ----------
@manager_required
def supplier_list(request):
    return render(request, "inventory/supplier_list.html", {"suppliers": Supplier.objects.all()})


@manager_required
def supplier_edit(request, pk=None):
    supplier = get_object_or_404(Supplier, pk=pk) if pk else None
    form = SupplierForm(request.POST or None, instance=supplier)
    if form.is_valid():
        form.save()
        messages.success(request, "Supplier saved.")
        return redirect("supplier_list")
    return render(request, "form.html", {"form": form, "title": "Supplier", "back": "supplier_list"})


@manager_required
@require_POST
def supplier_delete(request, pk):
    try:
        get_object_or_404(Supplier, pk=pk).delete()
        messages.success(request, "Supplier deleted.")
    except ProtectedError:
        messages.error(request, "This supplier has purchases recorded.")
    return redirect("supplier_list")


# ---------- purchases ----------
@manager_required
def purchase_list(request):
    q = request.GET.get("q", "").strip()
    purchases = Purchase.objects.select_related("product", "supplier", "created_by")
    if q:
        purchases = purchases.filter(
            Q(product__name__icontains=q) | Q(supplier__name__icontains=q) | Q(invoice_no__icontains=q)
        )
    page = Paginator(purchases, 20).get_page(request.GET.get("page"))
    return render(request, "inventory/purchase_list.html", {"page": page, "q": q})


@manager_required
def purchase_create(request):
    form = PurchaseForm(request.POST or None)
    if form.is_valid():
        purchase = form.save(commit=False)
        purchase.created_by = request.user
        services.record_purchase(purchase)
        messages.success(request, f"Added {purchase.quantity} {purchase.product.unit} of {purchase.product} to stock.")
        return redirect("purchase_list")
    return render(request, "form.html", {"form": form, "title": "Record purchase", "back": "purchase_list"})


@manager_required
def purchase_edit(request, pk):
    purchase = get_object_or_404(Purchase, pk=pk)
    old_product_id, old_quantity = purchase.product_id, purchase.quantity
    form = PurchaseForm(request.POST or None, instance=purchase)
    if form.is_valid():
        services.update_purchase(form.save(commit=False), old_product_id, old_quantity)
        messages.success(request, "Purchase updated and stock adjusted.")
        return redirect("purchase_list")
    return render(request, "form.html", {"form": form, "title": "Edit purchase", "back": "purchase_list"})


@manager_required
@require_POST
def purchase_delete(request, pk):
    services.delete_purchase(get_object_or_404(Purchase, pk=pk))
    messages.success(request, "Purchase deleted and stock reduced.")
    return redirect("purchase_list")


# ---------- JSON API ----------
@login_required
def api_products(request):
    q = request.GET.get("q", "").strip()
    products = Product.objects.filter(is_active=True).select_related("category")
    if q:
        products = products.filter(Q(name__icontains=q) | Q(tamil_name__icontains=q) | Q(code__iexact=q))
    return JsonResponse({"results": [p.as_dict() for p in products[:50]]})


@login_required
def api_product_detail(request, pk):
    return JsonResponse(get_object_or_404(Product.objects.select_related("category"), pk=pk).as_dict())
