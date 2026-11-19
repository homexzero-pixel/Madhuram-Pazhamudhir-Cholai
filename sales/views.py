from decimal import Decimal, InvalidOperation

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.core.paginator import Paginator
from django.db.models import Q
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from accounts.permissions import MANAGERS, manager_required
from inventory.models import Product

from . import services
from .cart import Cart
from .forms import AddToCartForm, CheckoutForm
from .models import Sale


@login_required
def pos(request):
    cart = Cart(request.session)
    lines = cart.lines()
    subtotal = sum((line["line_total"] for line in lines), Decimal("0"))
    q = request.GET.get("q", "").strip()
    products = Product.objects.filter(is_active=True).select_related("category")
    if q:
        products = products.filter(Q(name__icontains=q) | Q(tamil_name__icontains=q) | Q(code__iexact=q))
    return render(
        request,
        "sales/pos.html",
        {
            "lines": lines,
            "subtotal": subtotal,
            "products": products[:60],
            "q": q,
            "checkout_form": CheckoutForm(),
        },
    )


@login_required
@require_POST
def cart_add(request):
    form = AddToCartForm(request.POST)
    if form.is_valid():
        product = get_object_or_404(Product, pk=form.cleaned_data["product"], is_active=True)
        Cart(request.session).add(product, form.cleaned_data["quantity"])
    else:
        messages.error(request, "Enter a valid quantity.")
    return redirect(request.POST.get("next") or "pos")


@login_required
@require_POST
def cart_update(request, product_id):
    try:
        qty = Decimal(request.POST.get("quantity", "0"))
    except InvalidOperation:
        messages.error(request, "Enter a valid quantity.")
        return redirect("pos")
    Cart(request.session).set(product_id, qty)
    return redirect("pos")


@login_required
@require_POST
def cart_clear(request):
    Cart(request.session).clear()
    return redirect("pos")


@login_required
@require_POST
def checkout(request):
    form = CheckoutForm(request.POST)
    if not form.is_valid():
        messages.error(request, "Please check the payment details.")
        return redirect("pos")
    data = form.cleaned_data
    try:
        sale = services.checkout(
            Cart(request.session),
            request.user,
            discount=data.get("discount") or Decimal("0"),
            payment_method=data["payment_method"],
            amount_received=data.get("amount_received"),
            customer_name=data.get("customer_name", ""),
            customer_phone=data.get("customer_phone", ""),
        )
    except services.CheckoutError as exc:
        messages.error(request, str(exc))
        return redirect("pos")
    messages.success(request, f"Bill {sale.bill_no} saved.")
    return redirect("sale_receipt", pk=sale.pk)


def _visible_sales(user):
    sales = Sale.objects.select_related("cashier")
    return sales if user.has_role(*MANAGERS) else sales.filter(cashier=user)


@login_required
def sale_list(request):
    q = request.GET.get("q", "").strip()
    sales = _visible_sales(request.user)
    if q:
        sales = sales.filter(
            Q(bill_no__icontains=q) | Q(customer_name__icontains=q) | Q(customer_phone__icontains=q)
            | Q(items__product_name__icontains=q)
        ).distinct()
    page = Paginator(sales, 20).get_page(request.GET.get("page"))
    return render(request, "sales/sale_list.html", {"page": page, "q": q})


@login_required
def sale_detail(request, pk):
    sale = get_object_or_404(_visible_sales(request.user).prefetch_related("items"), pk=pk)
    return render(request, "sales/sale_detail.html", {"sale": sale})


@login_required
def sale_receipt(request, pk):
    sale = get_object_or_404(_visible_sales(request.user).prefetch_related("items"), pk=pk)
    return render(request, "sales/receipt.html", {"sale": sale})


@manager_required
@require_POST
def sale_void(request, pk):
    sale = services.void_sale(get_object_or_404(Sale, pk=pk))
    messages.success(request, f"Bill {sale.bill_no} voided and stock restored.")
    return redirect("sale_detail", pk=pk)
