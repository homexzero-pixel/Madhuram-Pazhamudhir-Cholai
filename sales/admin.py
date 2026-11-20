from django.contrib import admin

from .models import Payment, Sale, SaleLine, SaleReturn, Settlement, Shift


class LineInline(admin.TabularInline):
    model = SaleLine
    extra = 0


class PaymentInline(admin.TabularInline):
    model = Payment
    extra = 0


@admin.register(Sale)
class SaleAdmin(admin.ModelAdmin):
    list_display = ("bill_no", "created_at", "cashier", "total")
    inlines = [LineInline, PaymentInline]


admin.site.register([Shift, SaleReturn, Settlement])
