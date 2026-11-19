from django.contrib import admin

from .models import Category, Product, Purchase, Supplier


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ("name", "category", "unit", "selling_price", "stock", "reorder_level", "is_active")
    list_filter = ("category", "is_active")
    search_fields = ("name", "tamil_name", "code")


@admin.register(Purchase)
class PurchaseAdmin(admin.ModelAdmin):
    list_display = ("purchased_on", "product", "supplier", "quantity", "unit_cost", "total_cost")


admin.site.register(Category)
admin.site.register(Supplier)
